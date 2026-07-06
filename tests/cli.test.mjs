import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts", "skill-ledger.mjs");

test("CLI starts a run, records a skill call, and writes a Chinese report", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-"));
  const skillDir = path.join(cwd, "skills", "brainstorming");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );

  run(["start", "--run-id", "run-cli", "--harness", "codex", "--cwd", cwd, "--skills", path.join(cwd, "skills")], cwd);
  run(
    [
      "call",
      "--run-id",
      "run-cli",
      "--skill",
      "brainstorming",
      "--evidence",
      "self_reported",
      "--reason",
      "用户请求创建新功能",
    ],
    cwd,
  );
  const output = path.join(cwd, ".skill-ledger", "reports", "report.md");
  run(["report", "--run-id", "run-cli", "--output", output], cwd);

  const markdown = await readFile(output, "utf8");
  assert.match(markdown, /# Skills 调用审计报告/);
  assert.match(markdown, /模型自报告/);
  assert.match(markdown, /用户请求创建新功能/);
});

function run(args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, SKILL_LEDGER_HOME: path.join(cwd, ".skill-ledger") },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
