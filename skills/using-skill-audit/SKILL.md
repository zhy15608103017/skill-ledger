---
name: using-skill-audit
description: Use when starting any conversation, starting any task, before answering, or before invoking any other skill in an agent where Skill Ledger is installed or skill usage should be audited.
---

<SUBAGENT-STOP>
If you were dispatched as a subagent for a narrow implementation or review task, use an existing bootstrap run only when one is explicitly provided. Do not start a separate audit run unless the user asked the subagent to audit skills.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Skill Ledger is a session-start workflow.

BEFORE any response or action in a normal user-owned session, you MUST start a Skill Ledger audit run unless the current context already includes an active Skill Ledger bootstrap with a runId.

BEFORE invoking any other skill, you MUST record that skill call with the active runId.

If you think there is even a 1% chance another skill might apply to the task, this skill applies first.
</EXTREMELY-IMPORTANT>

# Using Skill Ledger

Start and maintain a local audit of which skills were discovered and which skills were actually called. The final report is Chinese Markdown.

## Startup Rule

1. Find the plugin root: the directory that contains `scripts/skill-ledger.mjs`.
2. If the prompt already contains an `Active Skill Ledger Audit` section with `runId`, `logFile`, and command examples, reuse that run.
3. If no active run exists, create a short redacted summary of the user's task and start one before doing task work. Do not paste secrets, tokens, or full confidential prompts into the shell command:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" start --harness "<tool-name>" --cwd "<workspace>" --task-context "<short redacted task summary>" --startup-skill using-skill-audit --startup-evidence self_reported
```

Keep the returned `runId` for the rest of the task.

## Before Other Skills

Before using any other skill, record it:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" call --run-id "<runId>" --skill "<skill-name>" --evidence self_reported --reason "<Chinese reason>"
```

Use `native_observed` only when the host adapter directly observed the skill call. Use `context_observed` when a host hook confirms the Skill content was loaded into model context but did not expose a native Skill tool call. Use `self_reported` when the model records the call because this skill required it. Use `log_inferred` only when reconstructing an audit from logs or a transcript.

Codex currently uses the guided `self_reported` workflow for skill calls. Do not relabel a Codex model-recorded call as `native_observed`. Claude Code and OpenCode adapters may emit `native_observed` only from their host tool lifecycle events.

## Finish

At the end of the task, finish the run. This automatically writes a Chinese Markdown report under `.skill-ledger/reports/`:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" finish --run-id "<runId>"
```

Use `--no-report` only when the caller explicitly wants to close the run without writing a report. Use the separate `report` command when regenerating a report or writing it to a custom output path.

The default report is concise. Use `finish --full` or `report --full` only when a complete list of every uncalled Skill is required.

## Privacy and Retention

- `SKILL_LEDGER_PRIVACY=balanced` is the default: redacted task context is retained, while arbitrary tool input text is not persisted.
- `strict` stores no task or tool input text.
- `diagnostic` stores redacted, truncated tool input text for adapter debugging.
- Set `SKILL_LEDGER_RETENTION_DAYS=<n>` to remove expired run logs and reports automatically when a new run starts. A value of `0` disables automatic deletion.

## Skill Roots

If the host exposes skill directories, pass each one with repeated `--skills` flags during `start`, or set `SKILL_LEDGER_SKILL_ROOTS` / `SKILL_LEDGER_SKILLS` for host adapters that start the run for you. Explicit roots are appended to the shared defaults. Use `--only-skills` only when you intentionally want to restrict discovery to the supplied roots only.

The shared defaults cover the plugin's own `skills/`, workspace skill directories, user-level skill directories, Codex plugin cache, and common local roots such as `.cc-switch` and `understand-anything`.

Missing roots must not block the user's main task. The report should explain that skill discovery depends on which roots the host environment exposed.

## Platform Tool Mapping

Some hosts load Skill Ledger through a native plugin or extension but do not expose a dedicated Skill tool. When that happens, use the host's documented skill-loading path instead of inventing a tool call.

- Pi: `references/pi-tools.md`
- Antigravity: `references/antigravity-tools.md`

## Red Flags

These mean stop and record the audit event first:

| Thought | Reality |
|---|---|
| "This is just a quick answer" | Starting a task is the trigger. Start or reuse the audit run first. |
| "I need to read files before deciding" | Reading files is task work. Start or reuse the audit run first. |
| "I will log the skill later" | Later logs lose evidence. Record before the skill call. |
| "Another skill is more important" | Other skills come after Skill Ledger when auditing is installed. |
