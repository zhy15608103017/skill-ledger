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
3. If no active run exists, start one before doing task work:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" start --harness "<tool-name>" --cwd "<workspace>"
```

Keep the returned `runId` for the rest of the task.

## Before Other Skills

Before using any other skill, record it:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" call --run-id "<runId>" --skill "<skill-name>" --evidence self_reported --reason "<Chinese reason>"
```

Use `native_observed` only when the host adapter directly observed the skill call. Use `self_reported` when the model records the call because this skill required it. Use `log_inferred` only when reconstructing an audit from logs or a transcript.

## Finish

At the end of the task, use `generate-skill-audit-report` or run:

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" finish --run-id "<runId>"
node "<plugin-root>/scripts/skill-ledger.mjs" report --run-id "<runId>"
```

## Skill Roots

If the host exposes skill directories, pass each one with repeated `--skills` flags during `start`. Without explicit roots, the CLI scans common local locations such as the plugin's own `skills/`, `.codex/skills`, `.opencode/skills`, `~/.codex/skills`, `~/.agents/skills`, and `~/.config/opencode/skills`.

Missing roots must not block the user's main task. The report should explain that skill discovery depends on which roots the host environment exposed.

## Red Flags

These mean stop and record the audit event first:

| Thought | Reality |
|---|---|
| "This is just a quick answer" | Starting a task is the trigger. Start or reuse the audit run first. |
| "I need to read files before deciding" | Reading files is task work. Start or reuse the audit run first. |
| "I will log the skill later" | Later logs lose evidence. Record before the skill call. |
| "Another skill is more important" | Other skills come after Skill Ledger when auditing is installed. |
