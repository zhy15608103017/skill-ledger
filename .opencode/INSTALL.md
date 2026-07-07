# Installing Skill Ledger for OpenCode

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
