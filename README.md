# Skill Ledger

Skill Ledger records which agent skills were discovered and called during a task, attaches an explicit evidence level to every call, and writes a concise Chinese Markdown report.

## Support Levels

### Tier 1: verified

- **Codex App / Codex CLI**: the bundled `using-skill-audit` skill starts a run with redacted task context and records calls as `self_reported`. Codex support is intentionally honest: without a native Skill lifecycle event, model-recorded calls are never presented as native observations.
- **Claude Code**: `SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `SessionEnd` hooks provide session-scoped startup, redacted task context, native Skill-call observation, automatic report generation, and active-run cleanup.
- **OpenCode**: the plugin injects the resident bootstrap into the first user message, records the original task context, observes native `skill` tool calls, isolates concurrent sessions, and closes a run when the session is deleted or ended. The plugin owns the run lifecycle, so its bootstrap does not instruct the model to run the CLI `start` or `finish` commands.

Tier 1 means that installation assets, session isolation, evidence attribution, privacy defaults, and report generation are covered by automated integration tests in this repository.

### Experimental compatibility

Cursor, GitHub Copilot CLI, Kimi Code, Gemini, Pi, Antigravity, and Factory Droid artifacts remain available for compatibility testing. They are not described as Tier 1 until their lifecycle and native evidence paths have been verified in fresh live-host sessions.

## Trust Model

Evidence is never silently upgraded:

- `native_observed`: a host adapter directly observed a Skill tool call.
- `context_observed`: a host confirmed that Skill content entered model context.
- `self_reported`: the model recorded its own usage under the audit workflow.
- `log_inferred`: a call was reconstructed from logs or a transcript.

Concurrent sessions are keyed by host session ID. If a host provides no session ID and multiple runs are possible, Skill Ledger drops the ambiguous event instead of assigning it to the wrong conversation. Finished runs are removed from the active index and reject later writes.

## Install Tier 1 Hosts

### Codex on Windows

```powershell
git clone https://github.com/zhy15608103017/skill-ledger.git "$HOME\plugins\skill-ledger"
cd "$HOME\plugins\skill-ledger"
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

The bundled Codex quick installer is currently Windows only. On macOS/Linux, install the plugin through the host-owned Codex plugin flow or use the CLI commands directly.

### Claude Code

```powershell
git clone https://github.com/zhy15608103017/skill-ledger.git
cd skill-ledger
powershell -ExecutionPolicy Bypass -File scripts/install-claude.ps1
```

### OpenCode

From npm:

```json
{
  "plugin": ["skill-ledger"]
}
```

From Git:

```json
{
  "plugin": ["skill-ledger@git+https://github.com/zhy15608103017/skill-ledger.git"]
}
```

Or update the local OpenCode config with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-opencode.ps1
```

## CLI

```bash
skill-ledger start --harness codex --cwd . \
  --task-context "short redacted task summary" \
  --startup-skill using-skill-audit \
  --startup-evidence self_reported

skill-ledger call --run-id <runId> --skill <skill-name> \
  --evidence self_reported --reason "<Chinese reason>"

skill-ledger finish --run-id <runId>
```

The default report is written to `.skill-ledger/reports/<runId>.md`. It summarizes source coverage and possible misses without dumping every uncalled skill. Add `--full` to `finish` or `report` when a complete inventory is required.

Other useful commands:

```bash
skill-ledger status --harness claude-code --session-id <sessionId>
skill-ledger runs --limit 20
skill-ledger task-context --run-id <runId> --text "redacted context"
skill-ledger prune --days 30
```

## Privacy and Retention

`SKILL_LEDGER_PRIVACY` controls local data capture:

- `balanced` (default): stores redacted task context; stores tool names, input keys, and payload hashes, but not arbitrary tool input text.
- `strict`: stores no task or tool input text.
- `diagnostic`: stores redacted and truncated tool input text for adapter debugging.

Common credential patterns, bearer values, private keys, URL credentials, and known token formats are redacted before text is persisted.

Automatic retention is disabled by default. Set `SKILL_LEDGER_RETENTION_DAYS=30`, or another positive number, to prune expired inactive run logs and reports whenever a new run starts.

Disable the runtime adapter with:

```bash
SKILL_LEDGER=off
```

## Skill Discovery

Default discovery includes the plugin's skills, workspace and user skill directories, Codex plugin cache, and common local roots. Add roots with repeated `--skills` flags or `SKILL_LEDGER_SKILL_ROOTS`. Use `--only-skills` when a task should audit a deliberately restricted set.

## Development

```powershell
npm install
npm test
npm pack --dry-run
```

The package intentionally excludes repository-only `.agents` development assets.
