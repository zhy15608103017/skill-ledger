import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package metadata is ready for npm and git distribution", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const readme = await readFile("README.md", "utf8");

  assert.equal(pkg.name, "skill-ledger");
  assert.equal(pkg.bin["skill-ledger"], "./scripts/skill-ledger.mjs");
  assert.ok(pkg.files.includes(".codex-plugin"));
  assert.ok(pkg.files.includes(".opencode"));
  assert.ok(pkg.files.includes("skills"));
  assert.match(readme, /skill-ledger/);
  assert.match(readme, /npm/);
  assert.match(readme, /git\+https/);
});
