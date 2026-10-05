/**
 * opencode-cost-guard
 *
 * OpenCode plugin that checks session cost after each response and alerts
 * when a configurable threshold is reached. Supports both the V1
 * (@opencode-ai/plugin) and V2 (@opencode/plugin) hosts.
 *
 * This is the server entry. On V1 it also posts the alerts into the chat.
 * On V2 alerts are shown as TUI toasts by the TUI entry (tui.ts); this entry
 * only enforces block mode.
 *
 * @see https://github.com/jjmartres/opencode-cost-guard
 */

// Type-only imports: neither SDK is needed at runtime, so the package loads
// on either host without pulling in the other's dependencies.
import type { Plugin as PluginV1, PluginModule } from "@opencode-ai/plugin"
import type { Plugin as V2 } from "@opencode/plugin"
import {
  CONFIG_FILENAME,
  DEBUG,
  createCostGuard,
  fmt,
  loadConfig,
  log,
  pct,
  type AlertKind,
  type CostGuardConfig,
} from "./shared.js"

export { loadConfig, type CostGuardConfig } from "./shared.js"

/** Always printed — one line at startup so the user can confirm active config. */
function logActive(cfg: CostGuardConfig): void {
  log.info(
    `Active — limit: ${fmt(cfg.maxCostUsd)} | ` +
    `warn at: ${cfg.warnAtPercent}% | mode: ${cfg.mode}` +
    (DEBUG ? " | debug: on" : "")
  )
}

// ─── OpenCode V1 ──────────────────────────────────────────────────────────────

/** Chat text for V1. V1 cannot reject prompts, so block mode says so. */
function chatMessage(cfg: CostGuardConfig, kind: AlertKind, cost: number): string {
  const { maxCostUsd, mode } = cfg

  if (kind === "warning")
    return [
      `⚠️  **COST WARNING** — ${pct(cost, maxCostUsd)}% of budget used.`,
      `Cost: ${fmt(cost)} — Limit: ${fmt(maxCostUsd)} — Remaining: ${fmt(maxCostUsd - cost)}`,
    ].join("\n")

  if (mode === "warn")
    return [
      `⛔ **COST LIMIT REACHED** — Cost: ${fmt(cost)} / ${fmt(maxCostUsd)} (${pct(cost, maxCostUsd)}%)`,
      ``,
      `Configured limit reached. Consider starting a new session or`,
      `update "maxCostUsd" in ${CONFIG_FILENAME}.`,
    ].join("\n")

  return [
    `⛔ **COST LIMIT REACHED** — Stop using this session.`,
    `Cost: ${fmt(cost)} / Limit: ${fmt(maxCostUsd)} (${pct(cost, maxCostUsd)}%)`,
    ``,
    `Prompt blocking requires OpenCode V2; on V1 this is an alert only.`,
    `Start a new session to continue working.`,
  ].join("\n")
}

export const CostGuardPlugin: PluginV1 = async ({ client, directory }) => {
  const cfg = loadConfig(directory)
  logActive(cfg)

  const guard = createCostGuard(
    cfg,
    log,
    (kind, cost) => chatMessage(cfg, kind, cost),
    (sessionId, text) =>
      client.session.prompt({
        path: { id: sessionId },
        body: { noReply: true, parts: [{ type: "text", text }] },
      })
  )

  return {
    event: async ({ event }) => {
      // Only act after the model has finished responding
      if (event.type !== "session.idle") return

      const sessionId = event.properties.sessionID
      log.debug(`session.idle received — sessionId: ${sessionId ?? "(none)"}`)

      if (!sessionId || guard.isDone(sessionId)) return

      try {
        // Sum cost across all assistant messages in the session
        let cost = 0
        try {
          const resp = await client.session.messages({ path: { id: sessionId } })
          for (const { info } of resp.data ?? []) {
            if (info.role === "assistant") cost += info.cost
          }
        } catch (err) {
          log.warn(`Could not fetch messages for session ${sessionId}:`, err)
          return
        }

        await guard.check(sessionId, cost)
      } catch (err) {
        // Defensive catch — an unexpected error must not silence future events
        log.error(`Unexpected error in event handler (session ${sessionId}):`, err)
      }
    },
  }
}

// ─── OpenCode V2 ──────────────────────────────────────────────────────────────

/**
 * V2 server side: block-mode enforcement only. Alerts are TUI toasts (tui.ts)
 * because V2 has no server API that shows a message without it becoming
 * model input on the next turn.
 */
async function setupV2(ctx: V2.Context): Promise<V2.Cleanup | void> {
  const cfg = loadConfig(ctx.location.directory)
  logActive(cfg)

  if (cfg.mode !== "block") return

  // Check the durable session total, including after a plugin reload or service restart.
  const registration = await ctx.session.hook("prompt", async (event) => {
    let session
    try {
      session = await ctx.session.get({ sessionID: event.sessionID })
    } catch (err) {
      // Fail open: a transient lookup failure must not lock the user out.
      log.warn(`Could not check cost for session ${event.sessionID}; allowing prompt:`, err)
      return
    }
    // The hook can see sessions from other locations; only apply this
    // project's config to this project's sessions.
    if (session.location.directory !== ctx.location.directory) return
    if (session.cost < cfg.maxCostUsd) return

    log.debug(`session ${event.sessionID} — prompt rejected, cost: ${fmt(session.cost)}, limit: ${fmt(cfg.maxCostUsd)}`)
    throw new Error(`Cost limit reached (${fmt(session.cost)} / ${fmt(cfg.maxCostUsd)}). Start a new session to continue.`)
  })

  return () => registration.dispose()
}

// ─── Plugin module ────────────────────────────────────────────────────────────

// One default export serves both hosts: the V1 loader reads `server` and
// ignores `setup`; the V2 loader reads `setup` and ignores `server`.
// V1 requires a plain-object default export — exporting CostGuardPlugin
// directly makes its legacy fallback call every named export as a plugin,
// including loadConfig(). `id` is mandatory for file:// plugins on V1 and
// for every plugin on V2.
const plugin = {
  id: "opencode-cost-guard",
  server: CostGuardPlugin,
  setup: setupV2,
} satisfies PluginModule & V2.Plugin

export default plugin
