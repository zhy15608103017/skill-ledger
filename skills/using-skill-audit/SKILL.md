---
name: using-skill-audit
description: Start and maintain a skill usage audit for the current task. Use at the beginning of any task where the user wants to know which skills were called or not called, when tuning skills, when comparing skill trigger behavior across Codex, OpenCode, Gemini, Kimi, Claude Code, Cursor, or similar coding agents, and before invoking other skills so each skill call can be recorded.
---

# Using Skill Ledger

## Overview

Start a local audit run that records discovered skills and skill calls for the current task. The generated report is Chinese Markdown by default.

## Workflow

1. Locate the plugin root: the directory that contains `scripts/skill-ledger.mjs`.
2. Start an audit run before using any other skill:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" start --harness "<tool-name>" --cwd "<workspace>"
```

The command prints a `runId`. Keep that value for the rest of the task.

3. Before invoking each skill, record it:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" call --run-id "<runId>" --skill "<skill-name>" --evidence self_reported --reason "<中文原因>"
```

Use `native_observed` only when the host adapter directly observed the call. Use `self_reported` when the model is following this skill. Use `log_inferred` only when reconstructing an audit from transcript or logs.

4. When the task ends, use the `generate-skill-audit-report` skill or run:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" finish --run-id "<runId>"
node "<plugin-root>/scripts/skill-ledger.mjs" report --run-id "<runId>"
```

## Skill Roots

If the host exposes skill directories, pass each one with repeated `--skills` flags during `start`. Without explicit roots, the CLI scans common local locations such as the plugin's own `skills/`, `.codex/skills`, `.opencode/skills`, `~/.codex/skills`, `~/.agents/skills`, and `~/.config/opencode/skills`.

Do not delay the main user task if a skill root is missing. Missing roots are skipped, and the report should mention that discovery depends on the roots available to the host.
