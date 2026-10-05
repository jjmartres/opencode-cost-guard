# opencode-cost-guard

An [OpenCode](https://opencode.ai) plugin that checks session cost after each response and alerts you when a configurable spending threshold is reached — as a TUI toast on [OpenCode V2](https://opencode.ai/v2/docs/), as a chat message on OpenCode V1. On V2 it can also block further prompts once the limit is hit.

> **Why?** OpenCode has no built-in per-session cost limit. This plugin fills that gap while a [native feature](https://github.com/sst/opencode/issues/4559) is still pending.

---

## Features

- ⚠️ **Early warning** at a configurable percentage of the budget (e.g. 80%)
- ⛔ **Limit alert** when the session cost reaches or exceeds the threshold
- 🛑 **Block mode (V2)** — rejects new prompts in a session once its limit is reached
- 🔇 **No spam** — each alert fires at most once per session
- 🤫 **Out of the model's context (V2)** — alerts are TUI toasts, never sent to the model
- 🗂️ **Per-project config** — override the global limit for individual repositories
- 🔌 **Zero friction** — install via npm, one line in `opencode.json`

---

## Installation

Add the package name to your OpenCode config — `plugins` on OpenCode V2, `plugin` on V1:

```jsonc
// ~/.config/opencode/opencode.json  (global)
// or .opencode/opencode.json        (per-project)
{
  "plugins": ["opencode-cost-guard"]   // OpenCode V2
  // "plugin": ["opencode-cost-guard"] // OpenCode V1
}
```

OpenCode resolves and installs the plugin from npm on startup.

---

## Configuration

Create a config file. It is read when the plugin loads; reload the plugin or restart OpenCode after changing it.

### Global config

```
~/.config/opencode/cost-guard.config.json
```

### Per-project override (takes priority over global)

```
<project-root>/.opencode/cost-guard.config.json
```

### Config reference

The file must be valid JSON — comments are stripped before parsing so `//` and `/* */` comments are accepted, but trailing commas are not.

| Key             | Type              | Default  | Description                                                    |
| --------------- | ----------------- | -------- | -------------------------------------------------------------- |
| `maxCostUsd`    | number (> 0)      | `20.0`   | Cost limit in USD. Alert fires when this is reached or exceeded. |
| `warnAtPercent` | number (0 – 100)  | `80`     | Early warning threshold as a % of `maxCostUsd`. `0` to disable.|
| `mode`          | `"warn"` \| `"block"` | `"warn"` | `warn` — alerts only. `block` — also rejects new prompts after the limit (V2 only; alert-only on V1). |

```json
{
  "maxCostUsd": 20.0,
  "warnAtPercent": 80,
  "mode": "warn"
}
```

If no config file is found, the built-in defaults above apply.

---

## How it works

The package has two entry points, and each works on both hosts:

| Entry | OpenCode V2 | OpenCode V1 |
| ----- | ----------- | ----------- |
| server (`.`) | In `block` mode, a prompt hook rejects new prompts once the session's cost has reached the limit | After each response, posts the warning or limit alert into the chat |
| TUI (`./tui`) | After each turn, shows the warning or limit alert as a toast | No-op |

After each turn — `session.execution.succeeded`, `.failed` or `.interrupted` on V2, `session.idle` on V1 — the plugin:

1. Reads the session ID from the event payload
2. Gets the cumulative session cost — V2 reports it directly; on V1 the plugin sums the cost of the session's assistant messages
3. Compares it against the configured thresholds
4. Shows the alert (V2: TUI toast; V1: chat message that doesn't trigger a model response)

```
User prompt → Model response → end of turn → cost-guard checks → ⚠️ or ⛔ if needed
```

Alerts arrive **after** a response: an in-flight response can exceed the limit.

On V2, alerts are TUI toasts rather than session messages because V2 only offers *synthetic* session messages, which wait until the next prompt and are then sent to the model. Other V2 clients (`opencode run`, the web and desktop apps) don't load TUI plugins, so they show no alerts; `block` mode is enforced on the server and still applies to them.

In `block` mode, the prompt hook reads the session's stored cost, so blocking survives restarts. If that lookup fails, the prompt is allowed rather than locking you out. V2 has no typed prompt-rejection API, so a blocked prompt shows up as a generic error (in the TUI: *Failed to send prompt — UnexpectedStatus: 500*); the limit toast shown after the previous turn explains why. V1 has no way for a plugin to reject a prompt, so `block` mode there sends the limit alert only.

### Deduplication

Each alert fires **at most once per session** while OpenCode is running. The state is in memory, so after a restart an existing session can be alerted again.

An alert is recorded only after delivery succeeds. If delivery fails, a later cost check can retry it. On V2, only sessions in the plugin's project directory use that project's configuration.

---

## Startup log

The server entry always prints one line at startup confirming the active configuration:

```
[cost-guard] Active — limit: $20.0000 | warn at: 80% | mode: warn
```

That is the only log line produced during normal operation. Warnings and errors always print regardless. On V2 these lines go to the OpenCode server's log (for example `opencode serve --print-logs`), not the TUI. The TUI entry never writes to the console; if it can't read the config file, it shows a toast instead.

### Debug logging

Set `COST_GUARD_DEBUG=1` to enable verbose server logs — useful when diagnosing why a threshold isn't firing:

```
[cost-guard] Active — limit: $20.0000 | warn at: 80% | mode: warn | debug: on
[cost-guard] Config loaded from: /Users/you/.config/opencode/cost-guard.config.json
[cost-guard] session.idle received — sessionId: abc123
[cost-guard] session abc123 — cost: $16.4000, limit: $20.0000
```

To set the variable for an OpenCode session launched from the terminal:

```bash
COST_GUARD_DEBUG=1 opencode
```

---

## Example alerts

### OpenCode V2 — TUI toasts

**Early warning** (warning toast)

```
Cost warning
$16.4000 of $20.0000 (82%) used. Remaining: $3.6000.
```

**Limit reached — `warn` mode** (error toast)

```
Cost limit reached
$20.0031 of $20.0000 (100%). Consider starting a new session.
```

**Limit reached — `block` mode** (error toast)

```
Cost limit reached — prompts blocked
$20.0031 of $20.0000 (100%). New prompts in this session will be rejected; start a new session to continue.
```

### OpenCode V1 — chat messages

**Early warning (at 80% of budget)**

```
⚠️  **COST WARNING** — 82% of budget used.
Cost: $16.4000 — Limit: $20.0000 — Remaining: $3.6000
```

**Limit reached — `warn` mode**

```
⛔ **COST LIMIT REACHED** — Cost: $20.0031 / $20.0000 (100%)

Configured limit reached. Consider starting a new session or
update "maxCostUsd" in cost-guard.config.json.
```

**Limit reached — `block` mode**

```
⛔ **COST LIMIT REACHED** — Stop using this session.
Cost: $20.0031 / Limit: $20.0000 (100%)

Prompt blocking requires OpenCode V2; on V1 this is an alert only.
Start a new session to continue working.
```

---

## Development

```bash
git clone https://github.com/jjmartres/opencode-cost-guard.git
cd opencode-cost-guard

make env      # install pinned Node (via asdf) + npm deps
make check    # type-check without emitting files
make build    # compile TypeScript → dist/
make dev      # watch mode — recompiles on save
make clean    # remove dist/
```

Run `make` with no arguments to see all available targets, including `bump` for version management and `release-*` for publishing. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

### Testing locally

Point OpenCode at your local build instead of the npm package:

```jsonc
// .opencode/opencode.json  (in a test project)
{
  "plugins": ["/absolute/path/to/opencode-cost-guard/dist"]                   // V2: must be a directory
  // "plugin": ["file:///absolute/path/to/opencode-cost-guard/dist/index.js"] // V1
}
```

On V2 the directory entry loads both `dist/index.js` (server) and `dist/tui.js` (TUI). Then open OpenCode in that project and verify the startup log appears. To trigger alerts quickly, set a tiny `maxCostUsd` in the project's `cost-guard.config.json` and use a model that reports cost — subscription models report $0, so they never cross a threshold.

---

## Known limitations

- The limit is **reactive**, not preventive. A single expensive response can push the cost over the threshold before the plugin fires.
- In-memory alert state is reset when OpenCode restarts, so an existing session may be alerted again. On V2, `block` mode still checks the stored cost before admitting new prompts.
- On V2, alerts appear only in the TUI; `opencode run` and the web and desktop apps get `block` mode but no alerts.
- On V2, a blocked prompt shows a generic error rather than the reason.
- On V1, `block` mode cannot reject prompts; it sends the limit alert only.
- Models billed by subscription report a cost of $0, so they never trigger alerts.
- For a hard preventive limit, consider routing through a gateway like [Portkey](https://portkey.ai) which supports budget enforcement at the API level.

---

## License

[MIT](./LICENSE)
