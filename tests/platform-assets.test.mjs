import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package publishes every platform artifact", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  for (const entry of [
    ".claude-plugin",
    ".cursor-plugin",
    ".codex-plugin",
    ".kimi-plugin",
    ".opencode",
    ".pi",
    "hooks",
    "skills",
    "GEMINI.md",
    "gemini-extension.json",
  ]) {
    assert.ok(pkg.files.includes(entry), `${entry} should be published`);
  }
});

test("platform manifests expose Skill Ledger skills and startup bootstrap", async () => {
  const claude = JSON.parse(await readFile(".claude-plugin/plugin.json", "utf8"));
  const cursor = JSON.parse(await readFile(".cursor-plugin/plugin.json", "utf8"));
  const codex = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));
  const kimi = JSON.parse(await readFile(".kimi-plugin/plugin.json", "utf8"));
  const gemini = JSON.parse(await readFile("gemini-extension.json", "utf8"));
  const opencodePlugin = await readFile(".opencode/plugins/skill-ledger.js", "utf8");
  const piExtension = await readFile(".pi/extensions/skill-ledger.ts", "utf8");
  const pkg = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(claude.skills, "./skills/");
  assert.equal(claude.hooks, undefined);
  assert.match(await readFile("hooks/hooks.json", "utf8"), /observe-skill-call/);
  assert.equal(cursor.skills, "./skills/");
  assert.equal(cursor.hooks, "./hooks/hooks-cursor.json");
  assert.match(await readFile("hooks/hooks-cursor.json", "utf8"), /observe-skill-call/);
  assert.equal(codex.skills, "./skills/");
  assert.equal(kimi.sessionStart.skill, "using-skill-audit");
  assert.equal(gemini.contextFileName, "GEMINI.md");
  assert.match(opencodePlugin, /collectSkillRoots/);
  assert.match(piExtension, /context_observed/);
  assert.match(piExtension, /collectSkillRoots/);
  assert.match(piExtension, /resources_discover[\s\S]*collectSkillRoots/);
  assert.deepEqual(pkg.pi.skills, ["./skills"]);
  assert.deepEqual(pkg.pi.extensions, ["./.pi/extensions/skill-ledger.ts"]);
});

test("platform tool mapping references document fallback behavior", async () => {
  const pi = await readFile("skills/using-skill-audit/references/pi-tools.md", "utf8");
  const antigravity = await readFile("skills/using-skill-audit/references/antigravity-tools.md", "utf8");

  assert.match(pi, /SKILL\.md/);
  assert.match(pi, /session_start/);
  assert.match(antigravity, /view_file/);
  assert.match(antigravity, /IsSkillFile/);
});
