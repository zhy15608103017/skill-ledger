# Installing Skill Ledger for OpenCode

This file covers OpenCode only. The repository also ships compatibility
artifacts for Claude Code, Cursor, GitHub Copilot CLI, Codex App/CLI, Kimi Code,
Gemini, Pi, Antigravity, and Factory Droid; see `README.md` for the full matrix.

Add this plugin to the `plugin` array in your `opencode.json`:

```json
{
  "plugin": ["skill-ledger@git+https://github.com/<owner>/skill-ledger.git"]
}
```

For local development, point OpenCode at this checkout:

```json
{
  "plugin": ["D:/github/skill-ledger"]
}
```

Restart OpenCode. The plugin registers the bundled skills and injects a Skill Ledger startup bootstrap into each session. The bootstrap includes the active run ID, CLI commands, and the full `using-skill-audit` skill body.
