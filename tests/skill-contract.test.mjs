import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("using-skill-audit is a session-start discipline skill", async () => {
  const skill = await readFile("skills/using-skill-audit/SKILL.md", "utf8");

  assert.match(skill, /^description: Use when starting any conversation/m);
  assert.match(skill, /<EXTREMELY-IMPORTANT>/);
  assert.match(skill, /BEFORE any response or action/);
  assert.match(skill, /MUST start a Skill Ledger audit run/);
  assert.match(skill, /MUST record that skill call/);
});

test("Codex manifest exposes the strengthened startup skill package", async () => {
  const manifest = JSON.parse(await readFile(".codex-plugin/plugin.json", "utf8"));

  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.hooks, undefined);
  assert.ok(manifest.interface.defaultPrompt.some((prompt) => /skill audit/i.test(prompt)));
});
