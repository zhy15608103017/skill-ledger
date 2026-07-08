# Multi Harness Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Skill Ledger beyond Codex and OpenCode by adding Superpowers-style compatibility artifacts for Claude Code, Cursor, Copilot CLI, Gemini, Kimi Code, Pi, Antigravity, Factory Droid, and existing Codex/OpenCode surfaces.

**Architecture:** Keep `skills/` as the single source of truth. Add a reusable shell-hook bootstrap for Claude/Cursor/Copilot-style hosts, strengthen existing manifest/in-process integrations, and document reuse-only hosts honestly rather than fabricating unverified runtime code.

**Tech Stack:** Node.js ESM CLI, PowerShell install helpers, JSON manifests, shell-hook bootstrap scripts, Pi TypeScript extension, node:test.

---

### Task 1: Add Shell-Hook Bootstrap For Claude/Cursor/Copilot

**Files:**
- Create: `hooks/session-start`
- Create: `hooks/run-hook.cmd`
- Create: `hooks/hooks.json`
- Create: `hooks/hooks-cursor.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `.cursor-plugin/plugin.json`
- Test: `tests/hooks.test.mjs`

- [ ] **Step 1: Write the failing hook test**

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const hook = path.resolve("hooks", "session-start");

test("session-start hook emits Claude, Cursor, and SDK bootstrap shapes", () => {
  const claude = runHook({ CLAUDE_PLUGIN_ROOT: path.resolve("."), SKILL_LEDGER_HARNESS: "claude-code" });
  assert.match(claude.hookSpecificOutput.additionalContext, /You have Skill Ledger/);
  assert.match(claude.hookSpecificOutput.additionalContext, /runId:/);

  const cursor = runHook({ CURSOR_PLUGIN_ROOT: path.resolve("."), SKILL_LEDGER_HARNESS: "cursor" });
  assert.match(cursor.additional_context, /You have Skill Ledger/);

  const sdk = runHook({ COPILOT_CLI: "1", CLAUDE_PLUGIN_ROOT: path.resolve("."), SKILL_LEDGER_HARNESS: "copilot-cli" });
  assert.match(sdk.additionalContext, /You have Skill Ledger/);
});

function runHook(env) {
  const result = spawnSync("bash", [hook], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...env, SKILL_LEDGER_HOME: path.join(process.cwd(), ".skill-ledger-test") },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/hooks.test.mjs`

Expected: FAIL because `hooks/session-start` does not exist.

- [ ] **Step 3: Implement the hook artifacts**

Create an extensionless `hooks/session-start` bash script that resolves the plugin root, starts a Skill Ledger run with `node scripts/skill-ledger.mjs start --harness <name> --cwd <cwd>`, reads `skills/using-skill-audit/SKILL.md`, builds bootstrap text using existing CLI semantics, escapes JSON safely, and emits exactly one shape:

```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "..." } }
```

for Claude Code, `{ "additional_context": "..." }` for Cursor, and `{ "additionalContext": "..." }` for Copilot CLI / SDK-style hosts.

Add `hooks/run-hook.cmd` as the Superpowers polyglot Windows/Unix dispatcher. Add hook config JSON files that point at the dispatcher. Add Claude and Cursor plugin manifests that expose `./skills/` and the proper hook config.

- [ ] **Step 4: Run the hook test to verify it passes**

Run: `node --test tests/hooks.test.mjs`

Expected: PASS with 1 test.

### Task 2: Strengthen Existing Manifest And Extension Support

**Files:**
- Modify: `package.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `.kimi-plugin/plugin.json`
- Modify: `.pi/extensions/skill-ledger.ts`
- Create: `skills/using-skill-audit/references/pi-tools.md`
- Create: `skills/using-skill-audit/references/antigravity-tools.md`
- Test: `tests/platform-assets.test.mjs`

- [ ] **Step 1: Write the failing platform-assets test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package publishes every platform artifact", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  for (const entry of [".claude-plugin", ".cursor-plugin", ".codex-plugin", ".kimi-plugin", ".opencode", ".pi", "hooks", "skills", "GEMINI.md"]) {
    assert.ok(pkg.files.includes(entry), `${entry} should be published`);
  }
});

test("platform manifests expose Skill Ledger skills and startup bootstrap", async () => {
  const codex = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
  const kimi = JSON.parse(await readFile(".kimi-plugin/plugin.json", "utf8"));
  const cursor = JSON.parse(await readFile(".cursor-plugin/plugin.json", "utf8"));
  assert.equal(codex.skills, "./skills/");
  assert.equal(kimi.sessionStart.skill, "using-skill-audit");
  assert.equal(cursor.hooks, "./hooks/hooks-cursor.json");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/platform-assets.test.mjs`

Expected: FAIL because `.claude-plugin`, `.cursor-plugin`, and `hooks` are not packaged yet.

- [ ] **Step 3: Implement manifest and mapping updates**

Add all platform artifact directories to `package.json.files`. Update platform manifests to the current package version and a long description that names the supported hosts. Enhance the Pi extension to inject a Skill Ledger bootstrap on `session_start` / `session_compact`, using the existing `buildBootstrapText` helper logic in TypeScript form. Add Pi and Antigravity mapping reference files that document native skill loading and fallback behavior.

- [ ] **Step 4: Run the platform-assets test**

Run: `node --test tests/platform-assets.test.mjs`

Expected: PASS with 2 tests.

### Task 3: Update CLI Quick Install And Documentation

**Files:**
- Modify: `scripts/skill-ledger.mjs`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/INSTALL.md`
- Modify: `.opencode/INSTALL.md`
- Test: `tests/cli.test.mjs`
- Test: `tests/package-publish.test.mjs`

- [ ] **Step 1: Write failing CLI/documentation assertions**

Add assertions that quick install menu output includes Claude Code, Cursor, Copilot CLI, Kimi Code, Gemini, Pi, Antigravity, Factory Droid, Codex, and OpenCode. Add package-publish assertions that README mentions the same platform list.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/cli.test.mjs tests/package-publish.test.mjs`

Expected: FAIL because the quick install menu and docs currently only emphasize Codex/OpenCode.

- [ ] **Step 3: Implement CLI/documentation updates**

Extend the quick install menu to show all supported hosts. Keep automatic installer commands only for Codex and OpenCode; for the other hosts, print the harness-owned install command or repo-local path guidance without editing user-owned config. Update docs to distinguish:

- native/runtime support: Codex, OpenCode, Kimi, Gemini, Pi, Claude Code, Cursor, Copilot CLI;
- reuse/install-route support: Factory Droid and Antigravity, pending live harness transcript.

- [ ] **Step 4: Run documentation tests**

Run: `node --test tests/cli.test.mjs tests/package-publish.test.mjs`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Review diff and status**

Run: `git diff --stat` and `git status --short`

Expected: only platform-support files, documentation, tests, and pre-existing uncommitted changes are present.
