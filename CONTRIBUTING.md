# Contributing to opencode-cost-guard

Thank you for taking the time to contribute! This document covers everything you need to know to report bugs, suggest features, and submit pull requests.

---

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Reporting a bug](#reporting-a-bug)
- [Requesting a feature](#requesting-a-feature)
- [Submitting a pull request](#submitting-a-pull-request)
- [Development setup](#development-setup)
- [Commit conventions](#commit-conventions)
- [Release process](#release-process)

---

## Code of conduct

Be respectful. Constructive criticism is welcome; personal attacks are not. Issues and PRs that are abusive or off-topic will be closed without comment.

---

## Reporting a bug

Before opening an issue, please:

1. **Search existing issues** — your bug may already be reported or fixed.
2. **Check the OpenCode version** — make sure you are running a recent release of OpenCode, as the plugin API evolves.

If it is genuinely new, open a **Bug report** issue using the template provided (see [`.github/ISSUE_TEMPLATE/bug_report.md`](.github/ISSUE_TEMPLATE/bug_report.md)).

Include at minimum:
- `opencode-cost-guard` version (from `package.json` or `npm list opencode-cost-guard`)
- OpenCode version (`opencode --version`)
- Node.js version (`node -v`)
- Your `cost-guard.config.json` (redact any sensitive values)
- The full startup log lines from `[cost-guard]`
- What you expected vs. what happened

---

## Requesting a feature

Open a **Feature request** issue using the template in [`.github/ISSUE_TEMPLATE/feature_request.md`](.github/ISSUE_TEMPLATE/feature_request.md).

Good feature requests explain:
- The problem you are trying to solve (not just the solution)
- How you currently work around it
- Whether you would be willing to implement it yourself

---

## Submitting a pull request

### Before you start

- For non-trivial changes, **open an issue first** and discuss the approach. This avoids wasted effort if the direction does not fit the project.
- For small fixes (typos, docs, trivial bugs), feel free to go straight to a PR.

### Step-by-step

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/opencode-cost-guard.git
cd opencode-cost-guard

# 2. Create a feature branch (never work directly on main)
git checkout -b fix/session-id-undefined
# or
git checkout -b feat/slack-notification

# 3. Install dependencies
make install

# 4. Make your changes in src/
# Run the TypeScript compiler in watch mode while you work
make dev

# 5. Type-check and build
make check   # fast type-check, no output files
make build   # full compile → dist/

# 6. Commit using the Conventional Commits format (see below)
git commit -m "fix: handle undefined sessionId in session.idle event"

# 7. Push your branch and open a PR on GitHub
git push origin fix/session-id-undefined
```

### PR checklist

Before submitting, make sure:

- [ ] `make check` passes with no type errors
- [ ] `make build` produces a clean `dist/`
- [ ] The change is covered by a description in the PR body
- [ ] README / docs are updated if the behaviour or config schema changed
- [ ] The PR targets the `main` branch

### What to expect

- A maintainer will review your PR, usually within a few days.
- You may be asked to make changes before it is merged.
- Once merged, the change will be released in the next version tag.

---

## Development setup

**Requirements:** Node.js ≥ 20 (the project uses `.tool-versions` to pin Node 24 via [asdf](https://asdf-vm.com))

The project ships a `Makefile` that covers the full workflow. Run `make` with no arguments to see all available targets:

```
make env            # install pinned Node via asdf + npm deps
make install        # install npm deps only (npm ci / npm install)

make check          # type-check sources without emitting files
make build          # compile TypeScript → dist/
make rebuild        # clean then build from scratch
make dev            # watch mode — recompiles on every save
make clean          # remove dist/

make info           # show local and published package versions
make pack-preview   # dry-run npm pack — shows what will be published

make bump BUMP=minor  # bump minor version, update lockfile, write CHANGELOG (no push)
make bump BUMP=major  # bump major version, update lockfile, write CHANGELOG (no push)

make release-patch  # bump patch version and push tag
make release-minor  # bump minor version, write CHANGELOG, and push tag
make release-major  # bump major version, write CHANGELOG, and push tag
```

If you prefer to invoke npm scripts directly:

```bash
npm install          # install deps
npm run build:check  # type-check
npm run build        # compile
npm run dev          # watch
npm run clean        # remove dist/
```

### Testing the plugin locally

Point OpenCode at your local build instead of the npm package:

```jsonc
// .opencode/opencode.json  (in a test project)
{
  "plugins": ["/absolute/path/to/opencode-cost-guard/dist"]                   // V2: must be a directory
  // "plugin": ["file:///absolute/path/to/opencode-cost-guard/dist/index.js"] // V1
}
```

On V2 the directory loads both the server and TUI entries. On V1 the server entry posts alerts into the chat; its TUI entry does nothing. Then open OpenCode in that project and check the server startup log for:

```
[cost-guard] Active — limit: $20.0000 | warn at: 80% | mode: warn
```

To trigger alerts quickly, set a small positive `maxCostUsd` in `.opencode/cost-guard.config.json` and use a model that reports cost. Verify a warning and a limit alert after a turn. In V2 `block` mode, verify that the next prompt is rejected; on V1, block mode only sends the limit alert. V2 toasts require the TUI. A build or a fake-host check does not replace testing in a real OpenCode installation.

### Project structure

```
opencode-cost-guard/
├── src/
│   ├── index.ts          ← V1 server alerts + V2 prompt blocking
│   ├── tui.ts            ← V2 toast alerts + V1 no-op TUI entry
│   └── shared.ts         ← config loader, thresholds + alert tracking
├── dist/                 ← compiled output (git-ignored, npm-published)
├── .github/
│   ├── ISSUE_TEMPLATE/   ← bug & feature request templates
│   └── workflows/
│       └── publish.yml   ← CI + npm publish on tag
├── Makefile              ← developer workflow (env → build → bump → release)
├── package.json
├── package-lock.json
├── tsconfig.json
├── CHANGELOG.md          ← generated by make bump / make release-minor/major
├── cost-guard.config.example.json
├── CONTRIBUTING.md       ← you are here
└── README.md
```

---

## Commit conventions

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

| Prefix | When to use |
|--------|-------------|
| `feat:` | A new feature |
| `fix:` | A bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `chore:` | Build scripts, CI, dependencies |

Examples:

```
feat: add per-project config override support
fix: handle undefined sessionId in session.idle event
docs: add Portkey gateway alternative to README
chore: upgrade @opencode-ai/plugin to 0.3.0
```

Commit prefixes also control how entries are grouped in `CHANGELOG.md`:

| Prefix                                   | CHANGELOG section |
| ---------------------------------------- | ----------------- |
| `feat`                                     | Added             |
| `fix`                                      | Fixed             |
| `refactor`, `perf`                           | Changed           |
| `revert`                                   | Removed           |
| `docs`, `chore`, `build`, `ci`, `style`          | Maintenance       |

---

## Release process

Releases are driven by git tags. The `Makefile` provides two levels of automation:

### `make bump` — prepare a release locally (no push)

```bash
make bump BUMP=minor   # 1.0.0 → 1.1.0
make bump BUMP=major   # 1.0.0 → 2.0.0
```

Each call:
1. Aborts if the working tree has uncommitted changes
2. Runs `npm version <bump> --no-git-tag-version` to update `package.json` without creating a git commit
3. Runs `npm install --package-lock-only` to sync `package-lock.json`
4. Generates a new section in `CHANGELOG.md` from commits since the last tag, grouped by conventional prefix
5. Stages `package.json`, `package-lock.json`, and `CHANGELOG.md`
6. Creates a single commit (`chore(release): vX.Y.Z`) and an annotated tag

Use `bump` when you want to review `CHANGELOG.md` before the tag goes public.

### `make release-*` — bump and push in one step

```bash
make release-patch   # 1.0.0 → 1.0.1  (no CHANGELOG section)
make release-minor   # 1.0.0 → 1.1.0  (runs make bump then pushes)
make release-major   # 1.0.0 → 2.0.0  (runs make bump then pushes)
```

After pushing, the GitHub Actions workflow (`publish.yml`) automatically builds and publishes to npm when a `v*` tag is detected. No manual `npm publish` needed.
