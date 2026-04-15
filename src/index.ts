/**
 * opencode-cost-guard
 *
 * OpenCode plugin that monitors session cost in real time and triggers
 * a warning or stop when a configurable threshold is reached.
 *
 * @see https://github.com/jjmartres/opencode-cost-guard
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { EventSessionIdle } from "@opencode-ai/sdk"
import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Verbose debug logging is opt-in via COST_GUARD_DEBUG=1.
 * Warnings and errors always print regardless of this flag.
 */
const DEBUG = process.env.COST_GUARD_DEBUG === "1"

const log = {
  /** Always printed — startup confirmation and real errors only. */
  info:  (msg: string) => console.info(`[cost-guard] ${msg}`),
  /** Always printed — something the user should act on. */
  warn:  (msg: string, err?: unknown) => err
    ? console.warn(`[cost-guard] ${msg}`, err)
    : console.warn(`[cost-guard] ${msg}`),
  /** Always printed — unexpected failures. */
  error: (msg: string, err?: unknown) => err
    ? console.error(`[cost-guard] ${msg}`, err)
    : console.error(`[cost-guard] ${msg}`),
  /** Printed only when COST_GUARD_DEBUG=1 — high-frequency / verbose lines. */
  debug: (msg: string) => { if (DEBUG) console.info(`[cost-guard] ${msg}`) },
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostGuardConfig {
  /** Cost limit in USD. Session triggers an alert when this is exceeded. Default: 20.0 */
  maxCostUsd: number
  /** Percentage of maxCostUsd at which an early warning fires. 0 to disable. Default: 80 */
  warnAtPercent: number
  /** "warn" sends a warning message; "block" additionally marks the session as stopped. Default: "warn" */
  mode: "warn" | "block"
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: CostGuardConfig = {
  maxCostUsd: 20.0,
  warnAtPercent: 80,
  mode: "warn",
}

const CONFIG_FILENAME = "cost-guard.config.json"

// ─── Config loading ───────────────────────────────────────────────────────────

/**
 * Loads plugin config from disk.
 *
 * Priority order (first found wins):
 *   1. <project>/.opencode/cost-guard.config.json
 *   2. ~/.config/opencode/cost-guard.config.json
 *   3. Built-in defaults
 */
export function loadConfig(projectDirectory: string): CostGuardConfig {
  const candidates = [
    join(projectDirectory, ".opencode", CONFIG_FILENAME),
    join(homedir(), ".config", "opencode", CONFIG_FILENAME),
  ]

  for (const configPath of candidates) {
    if (!existsSync(configPath)) continue

    try {
      const raw = readFileSync(configPath, "utf-8")
        .replace(/\/\/[^\n]*/g, "")        // strip // line comments
        .replace(/\/\*[\s\S]*?\*\//g, "")  // strip /* block comments */
      const parsed = JSON.parse(raw) as Partial<CostGuardConfig>
      const config: CostGuardConfig = { ...DEFAULTS }

      if (typeof parsed.maxCostUsd === "number" && parsed.maxCostUsd > 0)
        config.maxCostUsd = parsed.maxCostUsd

      if (
        typeof parsed.warnAtPercent === "number" &&
        parsed.warnAtPercent >= 0 &&
        parsed.warnAtPercent <= 100
      )
        config.warnAtPercent = parsed.warnAtPercent

      if (parsed.mode === "warn" || parsed.mode === "block")
        config.mode = parsed.mode

      log.debug(`Config loaded from: ${configPath}`)
      return config
    } catch (err) {
      log.warn(`Failed to read ${configPath}:`, err)
    }
  }

  log.debug(`No config file found (checked: ${candidates.join(", ")}), using defaults.`)
  return { ...DEFAULTS }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (usd: number) => `$${usd.toFixed(4)}`
const pct = (cost: number, max: number) => Math.round((cost / max) * 100)

/**
 * Injects a plain-text message into the session chat.
 * Errors are logged and swallowed — a failed notification must never
 * crash the event handler or suppress future cost checks.
 */
async function sendMessage(
  client: any,
  sessionId: string,
  text: string
): Promise<void> {
  try {
    await client.session.prompt({
      path: { id: sessionId },
      body: { noReply: true, parts: [{ type: "text", text }] },
    })
  } catch (err) {
    log.warn(`Failed to send message to session ${sessionId}:`, err)
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const CostGuardPlugin: Plugin = async ({ client, directory }) => {
  const cfg = loadConfig(directory)

  // Always printed — one line at startup so the user can confirm active config.
  log.info(
    `Active — limit: ${fmt(cfg.maxCostUsd)} | ` +
    `warn at: ${cfg.warnAtPercent}% | mode: ${cfg.mode}` +
    (DEBUG ? " | debug: on" : "")
  )

  // Track per-session state to avoid duplicate messages
  const warnedSessions  = new Set<string>()
  const blockedSessions = new Set<string>()

  return {
    event: async ({ event }) => {
      // Only act after the model has finished responding
      if (event.type !== "session.idle") return

      const sessionId = (event as EventSessionIdle).properties.sessionID

      log.debug(`session.idle received — sessionId: ${sessionId ?? "(none)"}`)

      if (!sessionId || blockedSessions.has(sessionId)) return

      try {
        // Sum cost across all assistant messages in the session
        let cost = 0
        try {
          const resp = await client.session.messages({ path: { id: sessionId } })
          const messages = resp.data ?? []
          for (const { info } of messages) {
            if (info.role === "assistant") cost += info.cost
          }
          log.debug(`session ${sessionId} — messages: ${messages.length}, cost: ${fmt(cost)}, limit: ${fmt(cfg.maxCostUsd)}`)
        } catch (err) {
          log.warn(`Could not fetch messages for session ${sessionId}:`, err)
          return
        }

        const { maxCostUsd, warnAtPercent, mode } = cfg
        const warnThreshold = maxCostUsd * (warnAtPercent / 100)

        // ── Limit reached ──────────────────────────────────────────────────────
        if (cost >= maxCostUsd) {
          blockedSessions.add(sessionId)

          const msg =
            mode === "block"
              ? [
                  `⛔ **COST LIMIT REACHED** — Session automatically stopped.`,
                  `Cost: ${fmt(cost)} / Limit: ${fmt(maxCostUsd)} (${pct(cost, maxCostUsd)}%)`,
                  ``,
                  `This session will no longer respond to new requests.`,
                  `Start a new session to continue working.`,
                ].join("\n")
              : [
                  `⛔ **COST LIMIT REACHED** — Cost: ${fmt(cost)} / ${fmt(maxCostUsd)} (${pct(cost, maxCostUsd)}%)`,
                  ``,
                  `Configured limit reached. Consider starting a new session or`,
                  `update "maxCostUsd" in ${CONFIG_FILENAME}.`,
                ].join("\n")

          await sendMessage(client, sessionId, msg)
          return
        }

        // ── Early warning (fired once per session) ─────────────────────────────
        if (
          warnAtPercent > 0 &&
          cost >= warnThreshold &&
          !warnedSessions.has(sessionId)
        ) {
          warnedSessions.add(sessionId)

          await sendMessage(client, sessionId, [
            `⚠️  **COST WARNING** — ${pct(cost, maxCostUsd)}% of budget used.`,
            `Cost: ${fmt(cost)} — Limit: ${fmt(maxCostUsd)} — Remaining: ${fmt(maxCostUsd - cost)}`,
          ].join("\n"))
        }
      } catch (err) {
        // Defensive catch — an unexpected error must not silence future events
        log.error(`Unexpected error in event handler (session ${sessionId}):`, err)
      }
    },
  }
}

// PluginModule shape required by the OpenCode plugin loader.
// The loader reads mod.default.server — a plain-object default export
// with a server property. Exporting CostGuardPlugin directly as the
// default causes the legacy fallback to call every named export as a
// plugin, including loadConfig(), which crashes with a type error.
// id is mandatory for file:// plugins; for npm plugins it falls back
// to package.json#name, but having it explicit covers both load paths.
const plugin: import("@opencode-ai/plugin").PluginModule = {
  id: "opencode-cost-guard",
  server: CostGuardPlugin,
}

export default plugin
