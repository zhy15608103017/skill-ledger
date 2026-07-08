# Skill Ledger

Skill Ledger records which skills are discovered and called during an agent task, then writes a Chinese Markdown report under `.skill-ledger/reports/`.

Supported host surfaces follow the Superpowers compatibility pattern:
Codex App, Codex CLI, OpenCode, Claude Code, Cursor, GitHub Copilot CLI,
Kimi Code, Gemini, Pi, Antigravity, and Factory Droid. Antigravity and Factory
Droid are documented as install-route compatibility surfaces and should be
verified in a fresh live host session before being treated as fully validated.

## Commands

```bash
node scripts/skill-ledger.mjs start --harness codex --cwd .
node scripts/skill-ledger.mjs call --run-id <runId> --skill <skill-name> --evidence self_reported --reason "<中文原因>"
node scripts/skill-ledger.mjs finish --run-id <runId>
```

## Evidence

- `native_observed`: host adapter directly observed the call.
- `self_reported`: the model recorded the call by instruction.
- `log_inferred`: the call was reconstructed from logs or transcript.

`finish` writes the default report to `.skill-ledger/reports/<runId>.md`. Reports are always Chinese Markdown. Use `report` when regenerating a report or writing it to a custom output path.
