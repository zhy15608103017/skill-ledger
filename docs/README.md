# Skill Ledger

Skill Ledger records which skills are discovered and called during an agent task, then writes a Chinese Markdown report under `.skill-ledger/reports/`.

## Commands

```bash
node scripts/skill-ledger.mjs start --harness codex --cwd .
node scripts/skill-ledger.mjs call --run-id <runId> --skill <skill-name> --evidence self_reported --reason "<中文原因>"
node scripts/skill-ledger.mjs finish --run-id <runId>
node scripts/skill-ledger.mjs report --run-id <runId>
```

## Evidence

- `native_observed`: host adapter directly observed the call.
- `self_reported`: the model recorded the call by instruction.
- `log_inferred`: the call was reconstructed from logs or transcript.

Reports are always Chinese Markdown.
