---
name: Bug report
about: Something is not working as expected
title: "bug: <short description>"
labels: bug
assignees: ""
---

## Description

<!-- A clear and concise description of what the bug is. -->

## Steps to reproduce

1. 
2. 
3. 

## Expected behavior

<!-- What did you expect to happen? -->

## Actual behavior

<!-- What happened instead? Include any error messages. -->

## Startup log

<!-- Paste the [cost-guard] lines printed when OpenCode starts. -->

```
[cost-guard] Config loaded from: ...
[cost-guard] Active — limit: ...
```

## Configuration

<!-- Paste your cost-guard.config.json (redact sensitive values). -->

```json
{
  "maxCostUsd": 20.0,
  "warnAtPercent": 80,
  "mode": "warn"
}
```

## Environment

- opencode-cost-guard version: <!-- e.g. 1.0.0 — run: npm list opencode-cost-guard -->
- OpenCode version: <!-- opencode --version -->
- Node.js version: <!-- node -v -->
- OS: <!-- e.g. macOS 15, Ubuntu 24.04 -->

## Additional context

<!-- Anything else that might be relevant. -->
