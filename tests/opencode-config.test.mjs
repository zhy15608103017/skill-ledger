import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("scripts", "update-opencode-config.mjs");

test("update-opencode-config preserves JSON and appends Skill Ledger plugin", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skill-ledger-opencode-config-"));
  const configPath = path.join(dir, "opencode.json");
  const original = {
    "$schema": "https://opencode.ai/config.json",
    plugin: ["oh-my-openagent@latest", "skill-audit"],
    provider: {
      gs: {
        name: "公司",
        options: {
          baseURL: "http://example.invalid/v1",
        },
      },
    },
  };
  await writeFile(configPath, JSON.stringify(original, null, 2), "utf8");

  const result = spawnSync(process.execPath, [
    script,
    "--config",
    configPath,
    "--plugin",
    "D:/github/skill-ledger",
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const updated = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(updated.plugin, ["oh-my-openagent@latest", "D:/github/skill-ledger"]);
  assert.equal(updated.provider.gs.name, "公司");
});
