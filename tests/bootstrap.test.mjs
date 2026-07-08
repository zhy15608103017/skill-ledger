import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { AUDIT_BOOTSTRAP_MARKER, buildBootstrapText, stripSkillFrontmatter } from "../core/bootstrap.mjs";

test("stripSkillFrontmatter removes YAML metadata like superpowers", () => {
  const text = stripSkillFrontmatter("---\nname: using-skill-audit\ndescription: test\n---\n\n# Using Skill Ledger\n");

  assert.equal(text, "# Using Skill Ledger\n");
});

test("buildBootstrapText returns a superpowers-style resident bootstrap", () => {
  const text = buildBootstrapText({
    runId: "run-1",
    pluginRoot: path.resolve("D:/github/skill-ledger"),
    logFile: "D:/repo/.skill-ledger/runs/run-1.jsonl",
    harness: "opencode",
    skillText: "---\nname: using-skill-audit\n---\n\n# Using Skill Ledger\n\nMUST start a Skill Ledger audit run.",
  });

  assert.match(text, new RegExp(AUDIT_BOOTSTRAP_MARKER));
  assert.match(text, /^<EXTREMELY_IMPORTANT>\nYou have Skill Ledger\./);
  assert.match(text, /The using-skill-audit skill content is included below/);
  assert.match(text, /ALREADY LOADED/);
  assert.match(text, /Tool Mapping for OpenCode/);
  assert.doesNotMatch(text, /<SKILL_AUDIT>/);
  assert.doesNotMatch(text, /^---$/m);
  assert.match(text, /# Using Skill Ledger/);
  assert.match(text, /runId: run-1/);
  assert.match(text, /skill-ledger\.mjs"? call --run-id run-1/);
  assert.match(text, /skill-ledger\.mjs"? finish --run-id run-1/);
  assert.match(text, /<\/EXTREMELY_IMPORTANT>\s*$/);
});
