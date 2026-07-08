# Pi Tool Mapping

Skill Ledger is loaded in Pi through `.pi/extensions/skill-ledger.ts`.

The extension registers the bundled `skills/` directory with `resources_discover`
and injects the `using-skill-audit` bootstrap on `session_start` and
`session_compact`. If Pi does not expose a native Skill tool, load an applicable
skill by reading that skill's `SKILL.md` file. In Pi, that file-read path is the
platform skill-loading mechanism rather than a bypass.

Use Pi's native tools for the matching actions:

| Skill Ledger action | Pi equivalent |
|---|---|
| Read a file | `read` |
| Create or edit files | `write` or `edit` |
| Run a shell command | `bash` |
| Search contents or paths | `grep`, `find`, or `ls` |
| Track tasks | Use an installed todo/task tool when available, otherwise maintain a short checklist in a plan file or conversation |
| Generate the final report | Run `node <plugin-root>/scripts/skill-ledger.mjs finish --run-id <runId>` |
