# Skill Ledger

Skill Ledger records discovered and called skills, preserves the evidence level of each call, and writes a concise Chinese Markdown report under `.skill-ledger/reports/<runId>.md`.

## Support

Tier 1 support is limited to Codex, Claude Code, and OpenCode. Cursor, GitHub Copilot CLI, Kimi Code, Gemini, Pi, Antigravity, and Factory Droid are experimental compatibility surfaces.

## Commands

```bash
node scripts/skill-ledger.mjs start --harness codex --cwd . --task-context "redacted task summary"
node scripts/skill-ledger.mjs call --run-id <runId> --skill <skill-name> --evidence self_reported --reason "<中文原因>"
node scripts/skill-ledger.mjs finish --run-id <runId>
```

Use `finish --full` only when the report needs every uncalled skill. Use `prune --days <n>` for explicit cleanup, or set `SKILL_LEDGER_RETENTION_DAYS`.

## Privacy

- `balanced` is the default: redacted task context, tool metadata, and payload hashes.
- `strict` stores no task or tool input text.
- `diagnostic` stores redacted, truncated tool input text.

## Evidence

- `native_observed`: the host adapter directly observed the call.
- `context_observed`: the host confirmed Skill content entered model context.
- `self_reported`: the model recorded the call by instruction.
- `log_inferred`: the call was reconstructed from logs or transcript.
