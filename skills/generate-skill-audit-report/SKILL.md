---
name: generate-skill-audit-report
description: Generate a Chinese Markdown skill usage audit report from a Skill Ledger run. Use at the end of audited tasks, when the user asks which skills were called or not called, when tuning skill descriptions and triggers, or when exporting evidence from Codex, OpenCode, Gemini, Kimi, Claude Code, Cursor, or similar coding agents.
---

# Generate Skill Ledger Report

## Overview

Finalize the current skill audit run and write a Chinese Markdown report. The report lists discovered skills, called skills, not-called skills, and the evidence level for each call.

## Workflow

1. Locate the plugin root: the directory that contains `scripts/skill-ledger.mjs`.
2. Determine the `runId` from the earlier `using-skill-audit` start command or from the bootstrap message.
3. Mark the run as finished:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" finish --run-id "<runId>"
```

4. Generate the report:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" report --run-id "<runId>"
```

To choose an explicit path:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" report --run-id "<runId>" --output "<workspace>/.skill-ledger/reports/<name>.md"
```

## Report Rules

- The report must be Chinese Markdown.
- Preserve evidence labels: `native_observed`, `self_reported`, and `log_inferred`.
- If no skills were discovered, explain that the host did not expose skill roots or the roots were not passed to the audit start command.
- Do not infer perfect accuracy from self-reported calls; mention the evidence level instead.

After writing the report, tell the user the absolute report path.
