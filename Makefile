# =============================================================================
# opencode-cost-guard — developer workflow
# =============================================================================
# Usage: make <target>
#
# Targets are grouped into six stages:
#   env      — set up the local environment (Node via asdf, npm deps)
#   dev      — inner development loop (type-check, build, watch, clean)
#   info     — inspect current state (versions, package contents)
#   bump     — bump version, update lockfile, write CHANGELOG (no push)
#   release  — bump + push tag to trigger CI publish
#   help     — print this reference (default target)
# =============================================================================

# ── Meta ─────────────────────────────────────────────────────────────────────

PACKAGE_NAME  := $(shell node -p "require('./package.json').name"    2>/dev/null || echo "opencode-cost-guard")
PACKAGE_VER   := $(shell node -p "require('./package.json').version" 2>/dev/null || echo "unknown")
NODE_REQUIRED := $(shell node -p "require('./package.json').engines.node.replace('>=','')" 2>/dev/null || echo "20")
NODE_CURRENT  := $(shell node --version 2>/dev/null | tr -d 'v' || echo "not found")
NPM_CURRENT   := $(shell npm  --version 2>/dev/null || echo "not found")

# Colour helpers (degrade gracefully in non-TTY environments)
BOLD  := $(shell tput bold    2>/dev/null || echo "")
GREEN := $(shell tput setaf 2 2>/dev/null || echo "")
CYAN  := $(shell tput setaf 6 2>/dev/null || echo "")
YELLOW:= $(shell tput setaf 3 2>/dev/null || echo "")
RESET := $(shell tput sgr0    2>/dev/null || echo "")

.DEFAULT_GOAL := help

.PHONY: help env install build check dev clean rebuild info pack-preview \
        bump release-patch release-minor release-major \
        _do-release _require-clean-tree _require-node _require-asdf

# =============================================================================
# HELP
# =============================================================================

help: ## Show this help message
	@printf '\n$(BOLD)$(CYAN)opencode-cost-guard$(RESET) — developer workflow\n\n'
	@printf '$(BOLD)Usage:$(RESET)  make <target>  [BUMP=minor|major]\n\n'
	@printf '$(BOLD)Targets:$(RESET)\n'
	@awk 'BEGIN { FS = ":.*##" } \
	     /^[a-zA-Z_-]+:.*##/ { printf "  $(CYAN)%-18s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf '\n$(BOLD)Examples:$(RESET)\n'
	@printf '  make bump BUMP=minor     # 1.0.0 → 1.1.0, update lockfile + CHANGELOG\n'
	@printf '  make bump BUMP=major     # 1.0.0 → 2.0.0, update lockfile + CHANGELOG\n'
	@printf '  make release-minor       # bump minor + push tag (triggers CI publish)\n'
	@printf '  make release-major       # bump major + push tag (triggers CI publish)\n'
	@printf '  make release-patch       # bump patch + push tag (no CHANGELOG section)\n'
	@printf '\n'

# =============================================================================
# ENV — environment setup
# =============================================================================

env: _require-asdf ## Install the pinned Node.js version via asdf and npm deps
	@printf '$(BOLD)$(GREEN)» Installing Node.js $(shell awk "{print \$$2}" .tool-versions) via asdf…$(RESET)\n'
	asdf install
	@$(MAKE) --no-print-directory install

_require-asdf:
	@command -v asdf >/dev/null 2>&1 || { \
	  printf '$(BOLD)error:$(RESET) asdf is not installed.\n'; \
	  printf '  Install it from https://asdf-vm.com and re-run: make env\n'; \
	  exit 1; \
	}

install: ## Install npm dependencies (uses ci when package-lock exists)
	@if [ -f package-lock.json ]; then \
	  printf '$(BOLD)$(GREEN)» npm ci$(RESET)\n'; \
	  npm ci; \
	else \
	  printf '$(BOLD)$(GREEN)» npm install$(RESET)\n'; \
	  npm install; \
	fi

# =============================================================================
# DEV — inner development loop
# =============================================================================

check: _require-node ## Type-check sources without emitting files
	@printf '$(BOLD)$(GREEN)» Type-checking…$(RESET)\n'
	@npm run build:check

build: _require-node ## Compile TypeScript → dist/
	@printf '$(BOLD)$(GREEN)» Building…$(RESET)\n'
	@npm run build

dev: _require-node ## Start watch mode (recompiles on save)
	@printf '$(BOLD)$(GREEN)» Watch mode — Ctrl-C to stop$(RESET)\n'
	@npm run dev

clean: ## Remove compiled output (dist/)
	@printf '$(BOLD)$(GREEN)» Cleaning dist/…$(RESET)\n'
	@npm run clean

rebuild: clean build ## Clean then rebuild from scratch

# =============================================================================
# INFO — inspect current state
# =============================================================================

info: ## Show local and published package versions
	@printf '\n$(BOLD)Local$(RESET)\n'
	@printf '  package   %s\n' "$(PACKAGE_NAME)"
	@printf '  version   %s\n' "$(PACKAGE_VER)"
	@printf '  node      %s  (required ≥ %s)\n' "$(NODE_CURRENT)" "$(NODE_REQUIRED)"
	@printf '  npm       %s\n' "$(NPM_CURRENT)"
	@printf '\n$(BOLD)npm registry$(RESET)\n'
	@npm view $(PACKAGE_NAME) version 2>/dev/null \
	  || printf '  (not yet published)\n'
	@printf '\n'

pack-preview: build ## Dry-run pack — shows exactly what will be published
	@printf '$(BOLD)$(GREEN)» Previewing npm pack…$(RESET)\n'
	@npm pack --dry-run

# =============================================================================
# BUMP — bump version, update lockfile, write CHANGELOG (local only, no push)
# =============================================================================
# Usage: make bump BUMP=minor
#        make bump BUMP=major
#
# Steps performed:
#   1. Validate BUMP is "minor" or "major"
#   2. Abort if working tree is dirty
#   3. npm version <BUMP> --no-git-tag-version  (updates package.json only)
#   4. npm install --package-lock-only          (syncs package-lock.json)
#   5. Write/prepend a new section to CHANGELOG.md from git log
#   6. git add + git commit + git tag
# =============================================================================

bump: _require-node _require-clean-tree ## Bump version, update lockfile, write CHANGELOG  [BUMP=minor|major]
	@# ── 1. Validate BUMP value ───────────────────────────────────────────────
	@if [ "$(BUMP)" != "minor" ] && [ "$(BUMP)" != "major" ]; then \
	  printf '$(BOLD)error:$(RESET) BUMP must be "minor" or "major".\n'; \
	  printf '  Usage: make bump BUMP=minor\n'; \
	  printf '         make bump BUMP=major\n'; \
	  exit 1; \
	fi
	@# ── 2. Bump package.json without creating a git commit or tag ────────────
	@printf '$(BOLD)$(GREEN)» Bumping $(BUMP) version from $(PACKAGE_VER)…$(RESET)\n'
	@npm version $(BUMP) --no-git-tag-version --no-commit-hooks > /dev/null
	@# ── 3. Capture new version ───────────────────────────────────────────────
	$(eval NEW_VER := $(shell node -p "require('./package.json').version"))
	@printf '$(BOLD)$(GREEN)» New version: v$(NEW_VER)$(RESET)\n'
	@# ── 4. Sync package-lock.json ────────────────────────────────────────────
	@printf '$(BOLD)$(GREEN)» Updating package-lock.json…$(RESET)\n'
	@npm install --package-lock-only --ignore-scripts 2>/dev/null
	@# ── 5. Write CHANGELOG section ───────────────────────────────────────────
	@printf '$(BOLD)$(GREEN)» Writing CHANGELOG.md…$(RESET)\n'
	@$(MAKE) --no-print-directory _write-changelog NEW_VER=$(NEW_VER)
	@# ── 6. Commit and tag ────────────────────────────────────────────────────
	@printf '$(BOLD)$(GREEN)» Committing release v$(NEW_VER)…$(RESET)\n'
	@git add package.json package-lock.json CHANGELOG.md
	@git commit -m "chore(release): v$(NEW_VER)"
	@git tag -a "v$(NEW_VER)" -m "v$(NEW_VER)"
	@printf '\n$(BOLD)$(GREEN)✓ v$(NEW_VER) committed and tagged locally$(RESET)\n'
	@printf '  Run $(BOLD)git push && git push --tags$(RESET) to trigger CI publish.\n'
	@printf '  Or use $(BOLD)make release-$(BUMP)$(RESET) to bump and push in one step.\n\n'

# Internal: generate and prepend a CHANGELOG section.
# Reads commits since the previous vX.Y.Z tag; groups by conventional prefix.
_write-changelog:
	@# Determine the range of commits to include
	@PREV_TAG=$$(git describe --tags --abbrev=0 2>/dev/null || echo ""); \
	if [ -n "$$PREV_TAG" ]; then \
	  RANGE="$$PREV_TAG..HEAD"; \
	else \
	  RANGE="HEAD"; \
	fi; \
	TODAY=$$(date +%Y-%m-%d); \
	\
	# Collect commits grouped by conventional prefix ─────────────────────── \
	ADDED="";     \
	FIXED="";     \
	CHANGED="";   \
	MAINTENANCE="";\
	REMOVED="";   \
	while IFS= read -r line; do \
	  msg=$$(echo "$$line" | sed 's/^[a-f0-9]* //'); \
	  hash=$$(echo "$$line" | awk '{print $$1}'); \
	  prefix=$$(echo "$$msg" | sed -n 's/^\([a-z]*\)[:(].*/\1/p'); \
	  clean=$$(echo "$$msg" | sed 's/^[a-z]*([^)]*): //;s/^[a-z]*: //'); \
	  entry="- $$clean ($$hash)"; \
	  case "$$prefix" in \
	    feat)              ADDED="$$ADDED\n$$entry" ;; \
	    fix)               FIXED="$$FIXED\n$$entry" ;; \
	    refactor|perf)     CHANGED="$$CHANGED\n$$entry" ;; \
	    revert)            REMOVED="$$REMOVED\n$$entry" ;; \
	    docs|chore|build|ci|style) MAINTENANCE="$$MAINTENANCE\n$$entry" ;; \
	    *)                 MAINTENANCE="$$MAINTENANCE\n$$entry" ;; \
	  esac; \
	done < <(git log $$RANGE --pretty=format:"%h %s" 2>/dev/null); \
	\
	# Build the new section ──────────────────────────────────────────────── \
	SECTION="## [$(NEW_VER)] — $$TODAY"; \
	[ -n "$$ADDED" ]       && SECTION="$$SECTION\n\n### Added$$ADDED"; \
	[ -n "$$FIXED" ]       && SECTION="$$SECTION\n\n### Fixed$$FIXED"; \
	[ -n "$$CHANGED" ]     && SECTION="$$SECTION\n\n### Changed$$CHANGED"; \
	[ -n "$$REMOVED" ]     && SECTION="$$SECTION\n\n### Removed$$REMOVED"; \
	[ -n "$$MAINTENANCE" ] && SECTION="$$SECTION\n\n### Maintenance$$MAINTENANCE"; \
	\
	# Prepend to CHANGELOG.md (create with header if it does not exist) ──── \
	if [ ! -f CHANGELOG.md ]; then \
	  printf '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).\n\n' > CHANGELOG.md; \
	fi; \
	EXISTING=$$(cat CHANGELOG.md); \
	HEADER=$$(printf '%s' "$$EXISTING" | sed -n '1,/^## /{ /^## /!p }'); \
	REST=$$(printf '%s' "$$EXISTING" | sed -n '/^## /,$$p'); \
	printf '%s\n%b\n\n%s\n' "$$HEADER" "$$SECTION" "$$REST" > CHANGELOG.md

# =============================================================================
# RELEASE — bump + push tag to trigger CI publish
# =============================================================================
# CI (publish.yml) handles the actual `npm publish` when a v* tag is pushed.

release-patch: _require-clean-tree _require-node ## Bump patch version (1.0.0 → 1.0.1) and push tag
	@$(MAKE) --no-print-directory _do-release BUMP=patch

release-minor: _require-clean-tree _require-node ## Bump minor + CHANGELOG (1.0.0 → 1.1.0) and push tag
	@$(MAKE) --no-print-directory _do-release BUMP=minor

release-major: _require-clean-tree _require-node ## Bump major + CHANGELOG (1.0.0 → 2.0.0) and push tag
	@$(MAKE) --no-print-directory _do-release BUMP=major

_do-release:
	@if [ "$(BUMP)" = "patch" ]; then \
	  printf '$(BOLD)$(GREEN)» Bumping patch version from $(PACKAGE_VER)…$(RESET)\n'; \
	  npm version patch --no-git-tag-version --no-commit-hooks > /dev/null; \
	  NEW_VER=$$(node -p "require('./package.json').version"); \
	  npm install --package-lock-only --ignore-scripts 2>/dev/null; \
	  git add package.json package-lock.json; \
	  git commit -m "chore(release): v$$NEW_VER"; \
	  git tag -a "v$$NEW_VER" -m "v$$NEW_VER"; \
	else \
	  $(MAKE) --no-print-directory bump BUMP=$(BUMP); \
	  NEW_VER=$$(node -p "require('./package.json').version"); \
	fi; \
	printf '$(BOLD)$(GREEN)» Pushing v$$NEW_VER…$(RESET)\n'; \
	git push && git push --tags; \
	printf '\n$(BOLD)$(GREEN)✓ Released v$$NEW_VER$(RESET)\n'; \
	printf '  CI will publish to npm once the tag build passes.\n\n'

# =============================================================================
# GUARDS — internal prerequisite checks
# =============================================================================

_require-node:
	@command -v node >/dev/null 2>&1 || { \
	  printf '$(BOLD)error:$(RESET) node is not on PATH.\n'; \
	  printf '  Run: make env\n'; \
	  exit 1; \
	}

_require-clean-tree:
	@if [ -n "$$(git status --porcelain 2>/dev/null)" ]; then \
	  printf '$(BOLD)error:$(RESET) working tree has uncommitted changes.\n'; \
	  printf '  Commit or stash them before bumping or releasing.\n'; \
	  git status --short; \
	  exit 1; \
	fi
