# Skill Ledger

Skill Ledger records which skills are discovered and called during an agent task, then writes a Chinese Markdown report.

## Supported Agents

Skill Ledger follows the Superpowers compatibility pattern and ships platform
artifacts for Claude Code, Antigravity, Codex App, Codex CLI, Cursor, Factory
Droid, GitHub Copilot CLI, Kimi Code, OpenCode, Pi, and Gemini.

Support has two levels:

- Native/runtime wiring in this repository: Codex App, Codex CLI, OpenCode,
  Claude Code, Cursor, GitHub Copilot CLI, Kimi Code, Gemini, and Pi.
- Install-route compatibility documented from the Superpowers pattern:
  Antigravity and Factory Droid. These should be verified in a fresh live host
  session before treating them as fully validated.

## Install From Git

OpenCode can load the repository directly:

```json
{
  "plugin": ["skill-ledger@git+https://github.com/<owner>/skill-ledger.git"]
}
```

Codex local installation after cloning:

Codex quick installer is currently Windows only because it uses the bundled
PowerShell script. On macOS/Linux, use the host-owned Codex plugin install flow
or run the audit CLI commands manually until a Node-based installer is added.

```powershell
git clone https://github.com/<owner>/skill-ledger.git "$HOME\plugins\skill-ledger"
cd "$HOME\plugins\skill-ledger"
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

Host-owned install routes:

```bash
# Claude Code
powershell -ExecutionPolicy Bypass -File scripts/install-claude.ps1

# Cursor
/add-plugin skill-ledger

# GitHub Copilot CLI
copilot plugin marketplace add <owner>/skill-ledger-marketplace
copilot plugin install skill-ledger@skill-ledger-marketplace

# Kimi Code
/plugins install https://github.com/<owner>/skill-ledger

# Gemini
gemini extensions install https://github.com/<owner>/skill-ledger

# Pi
pi install git:github.com/<owner>/skill-ledger

# Antigravity
agy plugin install https://github.com/<owner>/skill-ledger

# Factory Droid
droid plugin marketplace add https://github.com/<owner>/skill-ledger
droid plugin install skill-ledger@skill-ledger
```

## Install From npm

Publish:

```powershell
npm login --registry=https://registry.npmjs.org/
npm test
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org/
```

After publishing to npm, install the CLI globally:

```bash
npm install -g skill-ledger
skill-ledger start --harness codex --cwd .
```

Quick install a supported AI coding tool after npm publish:

```powershell
npx skill-ledger
```

This opens an interactive installer:

- `1. Codex`
- `2. OpenCode`
- `3. Claude Code`
- `4. Cursor`
- `5. GitHub Copilot CLI`
- `6. Kimi Code`
- `7. Gemini`
- `8. Pi`
- `9. Antigravity`
- `10. Factory Droid`

Non-interactive shortcuts are also available:

```powershell
npx skill-ledger install-codex
npx skill-ledger install-claude
npx skill-ledger install-opencode
```

For OpenCode, use the npm package name in `opencode.json`:

```json
{
  "plugin": ["skill-ledger"]
}
```

If you publish under a scope, replace `skill-ledger` with `@your-scope/skill-ledger` and run:

```powershell
npx @your-scope/skill-ledger
```

The OpenCode shortcut reads the package name from `package.json`, so scoped packages are written correctly.

## Basic Commands

```bash
skill-ledger start --harness codex --cwd .
skill-ledger call --run-id <runId> --skill <skill-name> --evidence self_reported --reason "<Chinese reason>"
skill-ledger finish --run-id <runId>
```

`finish` writes the default Chinese Markdown report to `.skill-ledger/reports/<local timestamp>.md`. Use `skill-ledger report --run-id <runId>` only when regenerating a report or writing it to a custom output path.

## Skill Discovery Roots

Skill Ledger now uses the same shared skill-root discovery across CLI starts,
OpenCode runtime injection, Claude/Cursor/Copilot session hooks, Pi context
injection, and any host that routes through the shared hooks.

Default discovery includes the bundled `skills/`, workspace skill directories,
user-level skill directories, Codex plugin cache, and common local skill roots
such as `.cc-switch` and `understand-anything`. Add more roots with repeated
`--skills` flags or with `SKILL_LEDGER_SKILL_ROOTS` / `SKILL_LEDGER_SKILLS`.
Explicit roots are appended to the defaults. Use `--only-skills` only when you
want to restrict discovery to the supplied roots only.

## Strong Startup Workflow

Skill Ledger now follows a Superpowers-style startup pattern:

- Codex loads the bundled skills through `.codex-plugin/plugin.json`. The `using-skill-audit` skill is written as a session-start discipline skill, so hosts that honor skill metadata should select it at the beginning of a conversation or task.
- Claude Code, Cursor, and GitHub Copilot CLI use `hooks/session-start` through host-specific hook JSON to inject the Skill Ledger bootstrap at session start.
- Claude Code also wires `hooks/observe-skill-call` through `PostToolUse`; native `Skill` tool calls are recorded as `native_observed`.
- Cursor and GitHub Copilot CLI can route tool-use payloads into `hooks/observe-skill-call` as probe events. If the host exposes a `Skill` or `skill` tool payload, the same hook records it as `native_observed`; otherwise it records `tool_observed` probe events for later adapter tuning.
- OpenCode registers the bundled skills and injects a superpowers-style resident bootstrap into the first user message. The bootstrap is wrapped in `<EXTREMELY_IMPORTANT>`, starts with `You have Skill Ledger.`, includes the `ALREADY LOADED` warning, carries the active `runId` and CLI commands, includes the full `using-skill-audit` skill body with frontmatter stripped, and appends `Tool Mapping for OpenCode`.
- Gemini loads `GEMINI.md`, which references the bundled audit skills. The shared observation hook can record `context_observed` when a Gemini hook payload includes bundled `SKILL.md` content.
- Kimi uses `sessionStart` plus `skillInstructions` in `.kimi-plugin/plugin.json`. If Kimi exposes tool or context hook payloads, pipe them to `hooks/observe-skill-call` to collect probe or context evidence.
- Pi registers `skills/` and injects the same bootstrap from `.pi/extensions/skill-ledger.ts`; the Pi context injection is recorded as `context_observed`.
- Antigravity and Factory Droid reuse the host plugin install routes documented above; Antigravity also has `skills/using-skill-audit/references/antigravity-tools.md` for tool mapping.

Codex plugins currently expose skills through metadata rather than an OpenCode-style message transform, so Codex persistence depends on the host's skill-selection mechanism. OpenCode, Pi, Claude Code, Cursor, and Copilot CLI receive explicit bootstrap injection.

Evidence levels:

- `native_observed`: host adapter directly observed a Skill tool call.
- `context_observed`: host hook confirmed Skill content entered model context.
- `self_reported`: model recorded its own skill usage by instruction.
- `log_inferred`: usage was reconstructed from logs or transcript.
