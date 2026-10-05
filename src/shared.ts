/**
 * Config, thresholds, and per-session state shared by the server entry
 * (index.ts) and the TUI entry (tui.ts).
 */

import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// ─── Logging ──────────────────────────────────────────────────────────────────

/**
 * Verbose debug logging is opt-in via COST_GUARD_DEBUG=1.
 * Warnings and errors always print regardless of this flag.
 */
export const DEBUG = process.env.COST_GUARD_DEBUG === "1"

export interface Logger {
  info(msg: string): void
  warn(msg: string, err?: unknown): void
  error(msg: string, err?: unknown): void
  debug(msg: string): void
}

/** Console logger for the server process. The TUI must not write to the console. */
export const log: Logger = {
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
  /** "warn" sends an alert; "block" also rejects subsequent prompts once the limit is reached (V2 only). Default: "warn" */
  mode: "warn" | "block"
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS: CostGuardConfig = {
  maxCostUsd: 20.0,
  warnAtPercent: 80,
  mode: "warn",
}

export const CONFIG_FILENAME = "cost-guard.config.json"

// ─── Config loading ───────────────────────────────────────────────────────────

/**
 * Loads plugin config from disk.
 *
 * Priority order (first found wins):
 *   1. <project>/.opencode/cost-guard.config.json
 *   2. ~/.config/opencode/cost-guard.config.json
 *   3. Built-in defaults
 */
export function loadConfig(projectDirectory: string, logger: Logger = log): CostGuardConfig {
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

      logger.debug(`Config loaded from: ${configPath}`)
      return config
    } catch (err) {
      logger.warn(`Failed to read ${configPath}:`, err)
    }
  }

  logger.debug(`No config file found (checked: ${candidates.join(", ")}), using defaults.`)
  return { ...DEFAULTS }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const fmt = (usd: number) => `$${usd.toFixed(4)}`
export const pct = (cost: number, max: number) => Math.round((cost / max) * 100)

/**
 * Events that mark the end of a V2 turn. Hosts up to at least 2.0.19 emit
 * session.execution.* rather than session.idle; failed and interrupted turns
 * can still have spent money, so they trigger a check too. session.idle is
 * kept for hosts that emit it.
 */
export const TURN_END_EVENTS = [
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.idle",
] as const

// ─── Cost check ───────────────────────────────────────────────────────────────

export type AlertKind = "warning" | "limit"

/**
 * Tracks per-session state and sends each alert at most once per session.
 * `format` builds the surface-specific payload (chat text, toast, …) and
 * `send` delivers it. A session is only marked once `send` succeeds, so a
 * failed delivery is retried on the next check.
 */
export function createCostGuard<Payload>(
  cfg: CostGuardConfig,
  logger: Logger,
  format: (kind: AlertKind, cost: number) => Payload,
  send: (sessionId: string, payload: Payload) => Promise<unknown> | void
) {
  const warnedSessions = new Set<string>()
  const limitNotifiedSessions = new Set<string>()

  // Errors are logged and swallowed — a failed notification must never
  // crash the event handler or suppress future cost checks.
  async function notify(sessionId: string, payload: Payload): Promise<boolean> {
    try {
      await send(sessionId, payload)
      return true
    } catch (err) {
      logger.warn(`Failed to send message to session ${sessionId}:`, err)
      return false
    }
  }

  return {
    /** True once the limit alert was delivered; later checks can be skipped. */
    isDone: (sessionId: string) => limitNotifiedSessions.has(sessionId),

    async check(sessionId: string, cost: number): Promise<void> {
      const { maxCostUsd, warnAtPercent } = cfg
      logger.debug(`session ${sessionId} — cost: ${fmt(cost)}, limit: ${fmt(maxCostUsd)}`)

      // ── Limit reached ──────────────────────────────────────────────────────
      if (cost >= maxCostUsd) {
        if (await notify(sessionId, format("limit", cost))) limitNotifiedSessions.add(sessionId)
        return
      }

      // ── Early warning (fired once per session) ─────────────────────────────
      if (
        warnAtPercent > 0 &&
        cost >= maxCostUsd * (warnAtPercent / 100) &&
        !warnedSessions.has(sessionId)
      ) {
        if (await notify(sessionId, format("warning", cost))) warnedSessions.add(sessionId)
      }
    },
  }
}
