/**
 * opencode-cost-guard — TUI entry
 *
 * On OpenCode V2 this shows the cost warning and limit alerts as TUI toasts.
 * Toasts appear right after the turn that crossed a threshold, and unlike a
 * synthetic session message they are never sent to the model.
 *
 * V1 also loads a package's `./tui` export, so the default export carries a
 * no-op V1 `tui()` as well; on V1 the server entry already posts the alerts
 * into the chat.
 */

// Type-only imports: the TUI provides everything at runtime.
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { Plugin as TuiV2 } from "@opencode/plugin/tui"
import {
  TURN_END_EVENTS,
  createCostGuard,
  fmt,
  loadConfig,
  pct,
  type AlertKind,
  type CostGuardConfig,
  type Logger,
} from "./shared.js"

type Toast = Parameters<TuiV2.Context["ui"]["toast"]["show"]>[0]

/** Toast for an alert. The block-mode limit toast is the only notice before prompts start failing. */
function toast(cfg: CostGuardConfig, kind: AlertKind, cost: number): Toast {
  const { maxCostUsd, mode } = cfg
  const usage = `${fmt(cost)} of ${fmt(maxCostUsd)} (${pct(cost, maxCostUsd)}%)`

  if (kind === "warning")
    return {
      title: "Cost warning",
      message: `${usage} used. Remaining: ${fmt(maxCostUsd - cost)}.`,
      variant: "warning",
      duration: 8000,
    }

  return mode === "block"
    ? {
        title: "Cost limit reached — prompts blocked",
        message: `${usage}. New prompts in this session will be rejected; start a new session to continue.`,
        variant: "error",
        duration: 15000,
      }
    : {
        title: "Cost limit reached",
        message: `${usage}. Consider starting a new session.`,
        variant: "error",
        duration: 15000,
      }
}

async function setupV2(ctx: TuiV2.Context): Promise<TuiV2.Cleanup> {
  // Writing to the console would corrupt the TUI, so problems surface as toasts.
  const logger: Logger = {
    info: () => {},
    debug: () => {},
    warn: (msg, err) => ctx.ui.toast.show({ title: "cost-guard", message: detail(msg, err), variant: "warning" }),
    error: (msg, err) => ctx.ui.toast.show({ title: "cost-guard", message: detail(msg, err), variant: "error" }),
  }

  const directory = (ctx.location ?? ctx.data.location.default()).directory
  const cfg = loadConfig(directory, logger)

  const guard = createCostGuard(
    cfg,
    logger,
    (kind, cost) => toast(cfg, kind, cost),
    (sessionId, options) => ctx.ui.toast.show({ ...options, sessionID: sessionId })
  )

  async function onTurnEnd(event: { location?: { directory: string }; data: unknown }): Promise<void> {
    if (event.location && event.location.directory !== directory) return
    const sessionId = (event.data as { sessionID?: string }).sessionID
    if (!sessionId || guard.isDone(sessionId)) return

    try {
      const session = await ctx.client.session.get({ sessionID: sessionId })
      // Only apply this project's config to this project's sessions.
      if (session.location.directory !== directory) return
      await guard.check(sessionId, session.cost)
    } catch (err) {
      logger.error(`Could not check cost for session ${sessionId}:`, err)
    }
  }

  const unsubscribe = TURN_END_EVENTS.map((type) =>
    ctx.data.on(type, (event) => void onTurnEnd(event))
  )

  return () => unsubscribe.forEach((off) => off())
}

function detail(msg: string, err: unknown): string {
  return err instanceof Error ? `${msg} ${err.message}` : msg
}

// V1 alerts are posted into the chat by the server entry; nothing to do here.
const tuiV1: TuiPlugin = async () => {}

// One default export serves both hosts: V1 reads `tui`, V2 reads `setup`.
const plugin = {
  id: "opencode-cost-guard",
  tui: tuiV1,
  setup: setupV2,
} satisfies TuiPluginModule & TuiV2.Definition

export default plugin
