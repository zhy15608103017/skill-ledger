import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Codex quick install assets exist and document the shortcut command", async () => {
  const script = await readFile("scripts/install-codex.ps1", "utf8");
  const docs = await readFile("docs/INSTALL.md", "utf8");
  const readme = await readFile("README.md", "utf8");

  assert.match(script, /skill-ledger/);
  assert.match(script, /legacyPluginName = "skill-audit"/);
  assert.match(script, /\$legacy\.Delete\(\)/);
  assert.match(script, /UTF8Encoding\(\$false\)/);
  assert.match(script, /Get-Command codex\.cmd/);
  assert.match(script, /marketplace\.json/);
  assert.match(script, /codex plugin add skill-ledger@/);
  assert.match(docs, /快速安装/);
  assert.match(docs, /powershell -ExecutionPolicy Bypass -File scripts\/install-codex\.ps1/);
  assert.match(docs, /Codex quick installer is currently Windows only/);
  assert.match(readme, /Codex quick installer is currently Windows only/);
});

test("OpenCode quick install assets exist and document the shortcut command", async () => {
  const script = await readFile("scripts/install-opencode.ps1", "utf8");
  const docs = await readFile("docs/INSTALL.md", "utf8");

  assert.match(script, /opencode\.json/);
  assert.match(script, /skill-ledger/);
  assert.match(script, /plugin/);
  assert.match(script, /update-opencode-config\.mjs/);
  assert.match(docs, /OpenCode 快速安装/);
  assert.match(docs, /powershell -ExecutionPolicy Bypass -File scripts\/install-opencode\.ps1/);
});

test("install guide documents all supported host install commands", async () => {
  const docs = await readFile("docs/INSTALL.md", "utf8");

  for (const pattern of [
    /\/plugin marketplace add <owner>\/skill-ledger-marketplace/,
    /\/plugin install skill-ledger@skill-ledger-marketplace/,
    /\/add-plugin skill-ledger/,
    /copilot plugin marketplace add <owner>\/skill-ledger-marketplace/,
    /copilot plugin install skill-ledger@skill-ledger-marketplace/,
    /\/plugins install https:\/\/github\.com\/<owner>\/skill-ledger/,
    /gemini extensions install https:\/\/github\.com\/<owner>\/skill-ledger/,
    /pi install git:github\.com\/<owner>\/skill-ledger/,
    /agy plugin install https:\/\/github\.com\/<owner>\/skill-ledger/,
    /droid plugin marketplace add https:\/\/github\.com\/<owner>\/skill-ledger/,
    /droid plugin install skill-ledger@skill-ledger/,
  ]) {
    assert.match(docs, pattern);
  }
});

test("each supported host has a PowerShell install command entry point", async () => {
  const docs = await readFile("docs/INSTALL.md", "utf8");
  const scripts = [
    ["codex", /codex plugin add skill-ledger@/],
    ["opencode", /opencode\.json/],
    ["claude", /\/plugin install skill-ledger@skill-ledger-marketplace/],
    ["cursor", /\/add-plugin skill-ledger/],
    ["copilot", /copilot plugin install skill-ledger@skill-ledger-marketplace/],
    ["kimi", /\/plugins install https:\/\/github\.com\/<owner>\/skill-ledger/],
    ["gemini", /gemini extensions install https:\/\/github\.com\/<owner>\/skill-ledger/],
    ["pi", /pi install git:github\.com\/<owner>\/skill-ledger/],
    ["antigravity", /agy plugin install https:\/\/github\.com\/<owner>\/skill-ledger/],
    ["droid", /droid plugin install skill-ledger@skill-ledger/],
  ];

  for (const [name, scriptPattern] of scripts) {
    const scriptPath = `scripts/install-${name}.ps1`;
    const script = await readFile(scriptPath, "utf8");
    assert.match(script, /Skill Ledger/);
    assert.match(script, scriptPattern);
    assert.match(docs, new RegExp(`powershell -ExecutionPolicy Bypass -File scripts/install-${name}\\.ps1`));
  }
});
