# Skill Ledger

Skill Ledger records which skills are discovered and called during an agent task, then writes a Chinese Markdown report.

## Install From Git

OpenCode can load the repository directly:

```json
{
  "plugin": ["skill-ledger@git+https://github.com/<owner>/skill-ledger.git"]
}
```

For Codex local installation after cloning:

```powershell
git clone https://github.com/<owner>/skill-ledger.git "$HOME\plugins\skill-ledger"
cd "$HOME\plugins\skill-ledger"
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
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

Non-interactive shortcuts are also available:

```powershell
npx skill-ledger install-codex
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
skill-ledger report --run-id <runId>
```

Reports are written to `.skill-ledger/reports/` in Chinese Markdown.

## Strong Startup Workflow

Skill Ledger now follows a Superpowers-style startup pattern:

- Codex loads the bundled skills through `.codex-plugin/plugin.json`. The `using-skill-audit` skill is written as a session-start discipline skill, so hosts that honor skill metadata should select it at the beginning of a conversation or task.
- OpenCode registers the bundled skills and injects a superpowers-style resident bootstrap into the first user message. The bootstrap is wrapped in `<EXTREMELY_IMPORTANT>`, starts with `You have Skill Ledger.`, includes the `ALREADY LOADED` warning, carries the active `runId` and CLI commands, includes the full `using-skill-audit` skill body with frontmatter stripped, and appends `Tool Mapping for OpenCode`.
- Gemini loads `GEMINI.md`, which references the bundled audit skills.
- Kimi uses `sessionStart` plus `skillInstructions` in `.kimi-plugin/plugin.json`.

Codex plugins currently expose skills through metadata rather than an OpenCode-style message transform, so Codex persistence depends on the host's skill-selection mechanism. OpenCode receives an explicit injected bootstrap.
