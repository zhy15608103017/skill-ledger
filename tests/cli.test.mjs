import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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

  assert.equal(path.basename(output), "finish-report.md");
  assert.match(markdown, /finish-report/);
  assert.match(markdown, /auto report/);
  assert.match(markdown, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.doesNotMatch(markdown, /\d{4}-\d{2}-\d{2}T\d{2}:/);
  assert.deepEqual(await readdir(path.join(cwd, ".skill-ledger", "active")), []);

  const rejectedCall = runFailure([
    "call", "--run-id", "finish-report", "--skill", "brainstorming", "--reason", "too late",
  ], cwd);
  assert.match(rejectedCall.stderr, /already finished/);

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

test("CLI call keeps reason values that start with -- and supports --key=value", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-dash-"));
  const skillDir = path.join(cwd, "skills", "brainstorming");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );

  run(
    ["start", "--run-id", "dash-run", "--harness", "codex", "--cwd", cwd, "--skills", path.join(cwd, "skills"), "--only-skills"],
    cwd,
  );
  run(
    ["call", "--run-id", "dash-run", "--skill", "brainstorming", "--evidence", "self_reported", "--reason", "--dash-value"],
    cwd,
  );

  const dashEvents = await readEvents(path.join(cwd, ".skill-ledger", "runs", "dash-run.jsonl"));
  const dashCall = dashEvents.find((event) => event.event === "skill_called");
  assert.equal(dashCall.reason, "--dash-value");

  run(
    ["call", "--run-id=dash-run", "--skill", "brainstorming", "--evidence", "self_reported", "--reason=inline --value"],
    cwd,
  );

  const inlineEvents = await readEvents(path.join(cwd, ".skill-ledger", "runs", "dash-run.jsonl"));
  const inlineCall = inlineEvents.filter((event) => event.event === "skill_called").at(-1);
  assert.equal(inlineCall.reason, "inline --value");
});

test("CLI status reports the active run and runs lists recorded runs", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-status-"));
  const skillDir = path.join(cwd, "skills", "brainstorming");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );

  run(
    ["start", "--run-id", "status-run", "--harness", "codex", "--cwd", cwd, "--skills", path.join(cwd, "skills"), "--only-skills"],
    cwd,
  );

  const statusResult = run(["status", "--harness", "codex", "--cwd", cwd], cwd);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.activeRun.runId, "status-run");
  assert.ok(status.allActive.some((entry) => entry.runId === "status-run"));

  run(
    ["call", "--run-id", "status-run", "--skill", "brainstorming", "--evidence", "self_reported", "--reason", "status check"],
    cwd,
  );

  const runsResult = run(["runs", "--cwd", cwd], cwd);
  const runs = JSON.parse(runsResult.stdout);
  assert.equal(runs.count, 1);
  assert.equal(runs.total, 1);
  assert.equal(runs.runs[0].runId, "status-run");
  assert.equal(runs.runs[0].calledCount, 1);
  assert.equal(runs.runs[0].discoveredCount, 1);
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

function runFailure(args, cwd, options = {}) {
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
  assert.notEqual(result.status, 0, result.stdout);
  return result;
}

test("CLI start accepts --task-context and it appears in the audit log", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-taskctx-"));
  const skillDir = path.join(cwd, "skills", "image-generation");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: image-generation\ndescription: Generate bitmap images and photos\n---\n# Image Generation\n",
  );

  run(
    [
      "start",
      "--run-id",
      "taskctx-run",
      "--harness",
      "codex",
      "--cwd",
      cwd,
      "--skills",
      path.join(cwd, "skills"),
      "--only-skills",
      "--task-context",
      "用户要求生成一张产品图片",
    ],
    cwd,
  );

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "taskctx-run.jsonl"));
  const startEvent = events.find((event) => event.event === "task_start");
  assert.ok(startEvent, "task_start should be recorded");
  assert.equal(startEvent.taskContext, "用户要求生成一张产品图片");
});

test("CLI start accepts task context over stdin without putting it in argv", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-taskctx-stdin-"));
  run(["start", "--run-id", "taskctx-stdin", "--harness", "codex", "--cwd", cwd, "--only-skills", "--task-context-stdin"], cwd, {
    input: "Fix auth with Authorization: Bearer secret-token",
  });
  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "taskctx-stdin.jsonl"));
  const context = events.find((event) => event.event === "task_start").taskContext;
  assert.match(context, /Authorization=\[REDACTED\]/);
  assert.doesNotMatch(context, /secret-token/);
});

test("CLI task-context subcommand appends a task_context event", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-taskctx-cmd-"));
  run(["start", "--run-id", "tc-cmd", "--harness", "codex", "--cwd", cwd, "--only-skills"], cwd);
  run(["task-context", "--run-id", "tc-cmd", "--text", "later task context from user"], cwd);

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "tc-cmd.jsonl"));
  const ctxEvent = events.find((event) => event.event === "task_context");
  assert.ok(ctxEvent, "task_context event should be recorded");
  assert.equal(ctxEvent.text, "later task context from user");
});

test("CLI call normalizes skill names with prefixes and paths", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-normalize-"));
  const skillDir = path.join(cwd, "skills", "brainstorming");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );

  run(
    [
      "start",
      "--run-id",
      "norm-run",
      "--harness",
      "codex",
      "--cwd",
      cwd,
      "--skills",
      path.join(cwd, "skills"),
      "--only-skills",
    ],
    cwd,
  );
  run(
    [
      "call",
      "--run-id",
      "norm-run",
      "--skill",
      "plugin:skills/Brainstorming/SKILL.md",
      "--evidence",
      "self_reported",
      "--reason",
      "prefixed path call",
    ],
    cwd,
  );

  const events = await readEvents(path.join(cwd, ".skill-ledger", "runs", "norm-run.jsonl"));
  const call = events.find((event) => event.event === "skill_called");
  assert.ok(call, "skill_called should be recorded");
  assert.equal(call.skill, "Brainstorming");
});

test("CLI rejects run ids that could escape the audit directory", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-cli-run-id-"));
  const result = runFailure(["start", "--run-id", "../escape", "--harness", "codex", "--cwd", cwd], cwd);
  assert.match(result.stderr, /Invalid --run-id/);
});
