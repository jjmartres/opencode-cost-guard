# AGENTS.md — opencode-cost-guard

## What this repo is

A TypeScript OpenCode plugin supporting V1 and V2. `src/index.ts` is the server entry, `src/tui.ts` is the TUI entry, and `src/shared.ts` holds configuration and alert tracking. The compiled output (`dist/`) is what gets published to npm. There are no tests, no linter config, and no second package.

---

## Environment

- Node pinned to **24.14.1** via `.tool-versions` (asdf). Run `make env` on a fresh clone.
- `package-lock.json` is committed. Always use `npm ci`, not `npm install`, unless regenerating the lockfile.
- One optional runtime env var: `COST_GUARD_DEBUG=1` enables verbose per-event logs. Not required for normal use.

---

## Commands — use Make, not npm scripts directly

```bash
make check          # tsc --noEmit  (fast, no output)
make build          # tsc  (emits to dist/)
make rebuild        # clean + build
make dev            # tsc --watch
make clean          # rm -rf dist/
make info           # local version, node/npm versions, npm registry version
make pack-preview   # npm pack --dry-run  (verify publish contents before releasing)
```

`make` with no arguments prints all targets with descriptions.

---

## Verification order before any PR

```
make check   →   make build
```

There are no tests. `make check` catching type errors is the only automated quality gate beyond CI.

---

## Source of truth for defaults

The canonical defaults live in `src/shared.ts` in the `DEFAULTS` constant:

```typescript
const DEFAULTS: CostGuardConfig = {
  maxCostUsd: 20.0,   // ← $20, not $2
  warnAtPercent: 80,
  mode: "warn",
}
```

Any doc or comment that says `$2.00` is wrong. The config example file and all docs reflect `$20.00`.

---

## Module system quirk

`"type": "module"` + `"module": "NodeNext"` in tsconfig. Imports inside `src/` must use explicit `.js` extensions when referencing local files (even though the source files are `.ts`). This is a NodeNext resolution requirement, not a bug.

---

## Release workflow

**Never** run `npm version` or `git tag` by hand. The Makefile owns the entire release sequence.

```bash
# Prepare locally (no push) — review CHANGELOG.md before it goes public
make bump BUMP=minor   # or BUMP=major
# BUMP=patch is not accepted by bump; use release-patch instead

# Bump + push in one step (triggers CI publish)
make release-patch     # patch: no CHANGELOG section written
make release-minor     # minor: writes CHANGELOG, then pushes
make release-major     # major: writes CHANGELOG, then pushes
```

What `make bump` does internally (in order):
1. `npm version <bump> --no-git-tag-version` — updates `package.json` only, no git objects
2. `npm install --package-lock-only` — syncs `package-lock.json`
3. Generates and prepends a Keep-a-Changelog section to `CHANGELOG.md` from commits since the last `v*` tag
4. `git add package.json package-lock.json CHANGELOG.md`
5. `git commit -m "chore(release): vX.Y.Z"` + `git tag -a "vX.Y.Z"`

CI publishes to npm automatically when a `v*` tag is pushed. `NPM_TOKEN` must be set as a repository secret.

---

## CHANGELOG generation

`make bump` parses conventional commit prefixes to group entries:

| Prefix                                   | Section     |
| ---------------------------------------- | ----------- |
| `feat`                                   | Added       |
| `fix`                                    | Fixed       |
| `refactor`, `perf`                       | Changed     |
| `revert`                                 | Removed     |
| `docs`, `chore`, `build`, `ci`, `style`  | Maintenance |
| anything else                            | Maintenance |

Use conventional commit format. Commits without a recognised prefix still appear but land in Maintenance.

---

## What gets published to npm

Only `dist/`, `README.md`, and `LICENSE` (controlled by `files` in `package.json`). Verify with `make pack-preview` before releasing. The `src/`, `Makefile`, `tsconfig.json`, `CHANGELOG.md`, `.github/`, and `.tool-versions` are excluded via `.npmignore`.

---

## CI

`.github/workflows/publish.yml` runs on every push to `main` and every PR:
- `npm ci` → `npm run build:check` → `npm run build`

Publish job runs only on `v*` tags, uses npm provenance (`id-token: write` permission required).
