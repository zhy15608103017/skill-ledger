import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Codex quick install assets exist and document the shortcut command", async () => {
  const script = await readFile("scripts/install-codex.ps1", "utf8");
  const docs = await readFile("docs/INSTALL.md", "utf8");

  assert.match(script, /skill-ledger/);
  assert.match(script, /legacyPluginName = "skill-audit"/);
  assert.match(script, /\$legacy\.Delete\(\)/);
  assert.match(script, /UTF8Encoding\(\$false\)/);
  assert.match(script, /Get-Command codex\.cmd/);
  assert.match(script, /marketplace\.json/);
  assert.match(script, /codex plugin add skill-ledger@/);
  assert.match(docs, /快速安装/);
  assert.match(docs, /powershell -ExecutionPolicy Bypass -File scripts\/install-codex\.ps1/);
});
