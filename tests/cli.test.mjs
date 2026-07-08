import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { readEvents } from "../core/audit-log.mjs";

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

test("CLI start appends explicit skill roots to default discovery roots", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-roots-"));
  const extraSkillDir = path.join(cwd, "extra-skills", "extra-review");
  await mkdir(extraSkillDir, { recursive: true });
  await writeFile(
    path.join(extraSkillDir, "SKILL.md"),
    "---\nname: extra-review\ndescription: Extra review skill\n---\n# Extra Review\n",
  );

  run(
    [
      "start",
      "--run-id",
      "append-roots",
      "--harness",
      "codex",
      "--cwd",
      cwd,
      "--skills",
      path.join(cwd, "extra-skills"),
    ],
    cwd,
  );

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "append-roots.jsonl"));
  const discoveredNames = events
    .filter((event) => event.event === "skill_discovered")
    .map((event) => event.skill.name);

  assert.ok(discoveredNames.includes("extra-review"));
  assert.ok(discoveredNames.includes("using-skill-audit"));
});

test("CLI start discovers additional roots from SKILL_LEDGER_SKILL_ROOTS", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-env-roots-"));
  const envSkillDir = path.join(cwd, "env-skills", "env-review");
  await mkdir(envSkillDir, { recursive: true });
  await writeFile(
    path.join(envSkillDir, "SKILL.md"),
    "---\nname: env-review\ndescription: Env review skill\n---\n# Env Review\n",
  );

  run(["start", "--run-id", "env-roots", "--harness", "codex", "--cwd", cwd], cwd, {
    env: { SKILL_LEDGER_SKILL_ROOTS: path.join(cwd, "env-skills") },
  });

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "env-roots.jsonl"));
  const discoveredNames = events
    .filter((event) => event.event === "skill_discovered")
    .map((event) => event.skill.name);

  assert.ok(discoveredNames.includes("env-review"));
});

test("CLI start discovers additional roots from SKILL_LEDGER_SKILLS alias", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-env-alias-"));
  const envSkillDir = path.join(cwd, "alias-skills", "alias-review");
  await mkdir(envSkillDir, { recursive: true });
  await writeFile(
    path.join(envSkillDir, "SKILL.md"),
    "---\nname: alias-review\ndescription: Alias review skill\n---\n# Alias Review\n",
  );

  run(["start", "--run-id", "alias-roots", "--harness", "codex", "--cwd", cwd], cwd, {
    env: { SKILL_LEDGER_SKILLS: path.join(cwd, "alias-skills") },
  });

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "alias-roots.jsonl"));
  const discoveredNames = events
    .filter((event) => event.event === "skill_discovered")
    .map((event) => event.skill.name);

  assert.ok(discoveredNames.includes("alias-review"));
});

test("CLI start --only-skills restricts discovery to supplied roots", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-only-roots-"));
  const onlySkillDir = path.join(cwd, "only-skills", "only-review");
  const envSkillDir = path.join(cwd, "env-skills", "env-only-review");
  await mkdir(onlySkillDir, { recursive: true });
  await mkdir(envSkillDir, { recursive: true });
  await writeFile(
    path.join(onlySkillDir, "SKILL.md"),
    "---\nname: only-review\ndescription: Only review skill\n---\n# Only Review\n",
  );
  await writeFile(
    path.join(envSkillDir, "SKILL.md"),
    "---\nname: env-only-review\ndescription: Env only review skill\n---\n# Env Only Review\n",
  );

  run(
    [
      "start",
      "--run-id",
      "only-roots",
      "--harness",
      "codex",
      "--cwd",
      cwd,
      "--skills",
      path.join(cwd, "only-skills"),
      "--only-skills",
    ],
    cwd,
    {
      env: { SKILL_LEDGER_SKILL_ROOTS: path.join(cwd, "env-skills") },
    },
  );

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "only-roots.jsonl"));
  const discoveredNames = events
    .filter((event) => event.event === "skill_discovered")
    .map((event) => event.skill.name);

  assert.ok(discoveredNames.includes("only-review"));
  assert.ok(!discoveredNames.includes("env-only-review"));
  assert.ok(!discoveredNames.includes("using-skill-audit"));
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
  const reportOutput = JSON.parse(result.stdout).reportOutput;
  const output = path.resolve(reportOutput);
  const markdown = await readFile(output, "utf8");

  assert.match(path.basename(output), /^\d{4}-\d{2}-\d{2} \d{2} \d{2} \d{2}\.md$/);
  assert.notEqual(path.basename(output), "finish-report.md");
  assert.match(markdown, /finish-report/);
  assert.match(markdown, /auto report/);
  assert.match(markdown, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.doesNotMatch(markdown, /\d{4}-\d{2}-\d{2}T\d{2}:/);

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
      SKILL_LEDGER_HOME: path.join(cwd, ".skill-ledger"),
      SKILL_LEDGER_SKILL_ROOTS: "",
      SKILL_LEDGER_SKILLS: "",
      ...options.env,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
