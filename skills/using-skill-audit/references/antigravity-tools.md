# Antigravity CLI Tool Mapping

Antigravity can install Skill Ledger through the same plugin repository shape
used by Superpowers. Treat this as an install-route compatibility surface until
a live Antigravity transcript verifies the full startup flow.

If Antigravity exposes installed skills but no native Skill invocation tool, load
an applicable Skill Ledger skill by reading its `SKILL.md` with `view_file` and
set `IsSkillFile` when the host supports that flag. That file-read path is the
platform skill-loading mechanism.

Use Antigravity's native tools for the matching actions:

| Skill Ledger action | Antigravity equivalent |
|---|---|
| Read a file or skill | `view_file`, with `IsSkillFile` for `SKILL.md` when available |
| Create a file | `write_to_file` |
| Edit a file | `replace_file_content` or `multi_replace_file_content` |
| Run a shell command | `run_command` |
| Search files | `grep_search` |
| Dispatch a subagent | `invoke_subagent`, using `self` for full-capability work and `research` for read-only exploration |
| Track tasks | Write or edit a task artifact instead of using background-process management tools |
| Generate the final report | Run `node <plugin-root>/scripts/skill-ledger.mjs finish --run-id <runId>` |
