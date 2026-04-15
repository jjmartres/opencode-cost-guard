# opencode-cost-guard

An [OpenCode](https://opencode.ai) plugin that monitors session cost in real time and fires a **warning** or **stop** message when a configurable spending threshold is reached.

> **Why?** OpenCode has no built-in per-session cost limit. This plugin fills that gap while a [native feature](https://github.com/sst/opencode/issues/4559) is still pending.

---

## Features

- ⚠️ **Early warning** at a configurable percentage of the budget (e.g. 80%)
- ⛔ **Limit alert** when the session cost exceeds the threshold
- 🔇 **No spam** — each message fires at most once per session
- 🗂️ **Per-project config** — override the global limit for individual repositories
- 🔌 **Zero friction** — install via npm, one line in `opencode.json`

---

## Installation

Add the package name to the `plugins` array in your OpenCode config:

```jsonc
// ~/.config/opencode/opencode.json  (global)
// or .opencode/opencode.json        (per-project)
{
  "plugins": ["opencode-cost-guard"]
}
```

OpenCode resolves and installs the plugin from npm on startup.

---

## Configuration

Create a config file — loaded once at plugin initialisation, no restart required.

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
| `maxCostUsd`    | number            | `20.0`   | Cost limit in USD. Alert fires when this is exceeded.          |
| `warnAtPercent` | number (0 – 100)  | `80`     | Early warning threshold as a % of `maxCostUsd`. `0` to disable.|
| `mode`          | `"warn"` \| `"block"` | `"warn"` | `warn` — injects a message. `block` — marks the session stopped. |

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

The plugin hooks into the `session.idle` event, which fires after every model response. It then:

1. Reads the session ID from the event payload
2. Fetches the current cumulative cost via the OpenCode SDK
3. Compares it against the configured thresholds
4. Injects a formatted warning or stop message into the chat if needed

Because it acts **after** each response (not before), it cannot intercept a request mid-flight — the limit is enforced reactively.

```
User prompt → Model response → session.idle → cost-guard checks → ⚠️ or ⛔ if needed
```

### Deduplication

Two in-memory `Set` objects track which sessions have already received a warning or been blocked. Each message fires **at most once per session**, regardless of how many subsequent responses occur.

---

## Startup log

The plugin always prints one line at startup confirming the active configuration:

```
[cost-guard] Active — limit: $20.0000 | warn at: 80% | mode: warn
```

That is the only log line produced during normal operation. Warnings and errors always print regardless.

### Debug logging

Set `COST_GUARD_DEBUG=1` to enable verbose per-event logs — useful when diagnosing why a threshold isn't firing:

```
[cost-guard] Active — limit: $2.0000 | warn at: 80% | mode: warn | debug: on
[cost-guard] Config loaded from: /Users/you/.config/opencode/cost-guard.config.json
[cost-guard] session.idle received — sessionId: abc123
[cost-guard] session abc123 — messages: 4, cost: $1.6400, limit: $2.0000
```

To set the variable for an OpenCode session launched from the terminal:

```bash
COST_GUARD_DEBUG=1 opencode
```

---

## Example messages

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
⛔ **COST LIMIT REACHED** — Session automatically stopped.
Cost: $20.0031 / Limit: $20.0000 (100%)

This session will no longer respond to new requests.
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
  "plugins": ["file:///absolute/path/to/opencode-cost-guard/dist/index.js"]
}
```

Then open OpenCode in that project and verify the startup log appears.

---

## Known limitations

- The limit is **reactive**, not preventive. A single expensive response can push the cost over the threshold before the plugin fires.
- The in-memory session state is reset when OpenCode restarts. A session that was already warned or blocked will be treated as fresh after a restart.
- For a hard preventive limit, consider routing through a gateway like [Portkey](https://portkey.ai) which supports budget enforcement at the API level.

---

## License

[MIT](./LICENSE)
