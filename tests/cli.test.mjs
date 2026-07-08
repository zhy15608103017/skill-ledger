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

test("CLI finish writes the default report unless disabled", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-finish-report-"));
  const skillDir = path.join(cwd, "skills", "brainstorming");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );

  run(["start", "--run-id", "finish-report", "--harness", "codex", "--cwd", cwd, "--skills", path.join(cwd, "skills")], cwd);
  run([
    "call",
    "--run-id",
    "finish-report",
    "--skill",
    "brainstorming",
    "--evidence",
    "self_reported",
    "--reason",
    "auto report",
  ], cwd);

  const result = run(["finish", "--run-id", "finish-report"], cwd);
  const output = path.join(cwd, ".skill-ledger", "reports", "finish-report.md");
  const markdown = await readFile(output, "utf8");

  assert.match(result.stdout, /finish-report\.md/);
  assert.match(markdown, /finish-report/);
  assert.match(markdown, /auto report/);

  const noReportCwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-finish-no-report-"));
  const noReportSkillDir = path.join(noReportCwd, "skills", "brainstorming");
  await mkdir(noReportSkillDir, { recursive: true });
  await writeFile(
    path.join(noReportSkillDir, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );

  run(
    [
      "start",
      "--run-id",
      "finish-no-report",
      "--harness",
      "codex",
      "--cwd",
      noReportCwd,
      "--skills",
      path.join(noReportCwd, "skills"),
    ],
    noReportCwd,
  );
  run(["finish", "--run-id", "finish-no-report", "--no-report"], noReportCwd);

  await assert.rejects(
    readFile(path.join(noReportCwd, ".skill-ledger", "reports", "finish-no-report.md"), "utf8"),
    { code: "ENOENT" },
  );
});

test("CLI install-opencode updates an OpenCode config file", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-install-opencode-"));
  const configPath = path.join(cwd, "opencode.json");
  await writeFile(configPath, JSON.stringify({ plugin: ["existing-plugin"] }, null, 2), "utf8");

  run([
    "install-opencode",
    "--config",
    configPath,
    "--plugin",
    "D:/github/skill-ledger",
  ], cwd);

  const config = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(config.plugin, ["existing-plugin", "D:/github/skill-ledger"]);
});

test("CLI without args shows quick install menu and runs selected OpenCode install", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-menu-"));
  const configDir = path.join(cwd, "opencode-config");

  const result = run([], cwd, {
    input: "2\n",
    env: { OPENCODE_CONFIG_DIR: configDir },
  });

  assert.match(result.stdout, /Skill Ledger/);
  assert.match(result.stdout, /Codex/);
  assert.match(result.stdout, /OpenCode/);
  for (const platform of ["Claude Code", "Cursor", "GitHub Copilot CLI", "Kimi Code", "Gemini", "Pi", "Antigravity", "Factory Droid"]) {
    assert.match(result.stdout, new RegExp(platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const config = JSON.parse(await readFile(path.join(configDir, "opencode.json"), "utf8"));
  assert.deepEqual(config.plugin, ["skill-ledger"]);
});

test("CLI quick install menu uses the published package name for OpenCode", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-menu-package-"));
  const configDir = path.join(cwd, "opencode-config");

  run([], cwd, {
    input: "2\n",
    env: {
      OPENCODE_CONFIG_DIR: configDir,
      SKILL_LEDGER_PACKAGE_NAME: "@example/skill-ledger",
    },
  });

  const config = JSON.parse(await readFile(path.join(configDir, "opencode.json"), "utf8"));
  assert.deepEqual(config.plugin, ["@example/skill-ledger"]);
});

function run(args, cwd, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    input: options.input,
    env: {
      ...process.env,
      ...options.env,
      SKILL_LEDGER_HOME: path.join(cwd, ".skill-ledger"),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
