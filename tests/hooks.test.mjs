import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const hook = path.resolve("hooks", "session-start");
const pluginRoot = path.resolve(".");

test("session-start hook emits Claude, Cursor, and SDK bootstrap shapes", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-hook-"));
  try {
    const claude = runHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
    });
    assert.match(claude.hookSpecificOutput.additionalContext, /You have Skill Ledger/);
    assert.match(claude.hookSpecificOutput.additionalContext, /runId:/);
    assert.match(claude.hookSpecificOutput.additionalContext, /finish --run-id/);

    const cursor = runHook({
      auditHome,
      env: { CURSOR_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "cursor" },
    });
    assert.match(cursor.additional_context, /You have Skill Ledger/);
    assert.equal(cursor.hookSpecificOutput, undefined);

    const sdk = runHook({
      auditHome,
      env: { COPILOT_CLI: "1", CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "copilot-cli" },
    });
    assert.match(sdk.additionalContext, /You have Skill Ledger/);
    assert.equal(sdk.additional_context, undefined);
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

function runHook({ auditHome, env }) {
  const result = spawnSync(process.execPath, [hook], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      SKILL_LEDGER_HOME: auditHome,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
