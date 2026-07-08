import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { appendEvent, readEvents, summarizeRun } from "../core/audit-log.mjs";
import { renderChineseMarkdownReport } from "../core/report-md.mjs";
import { scanSkillRoots } from "../core/skill-scanner.mjs";
import { collectSkillRoots } from "../core/skill-roots.mjs";

test("scanSkillRoots discovers SKILL.md frontmatter across roots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-scan-"));
  const first = path.join(root, "skills", "brainstorming");
  const second = path.join(root, "project-skills", "review");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(
    path.join(first, "SKILL.md"),
    "---\nname: brainstorming\ndescription: Use before creative work\n---\n# Brainstorming\n",
  );
  await writeFile(
    path.join(second, "SKILL.md"),
    "---\nname: review\ndescription: Use when reviewing code\n---\n# Review\n",
  );

  const skills = await scanSkillRoots([path.join(root, "skills"), path.join(root, "project-skills")]);

  assert.deepEqual(
    skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
    })),
    [
      {
        name: "brainstorming",
        description: "Use before creative work",
        source: "skills",
      },
      {
        name: "review",
        description: "Use when reviewing code",
        source: "project-skills",
      },
    ],
  );
});

test("scanSkillRoots parses YAML frontmatter descriptions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-yaml-scan-"));
  const skillDir = path.join(root, "skills", "yaml-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: yaml-skill",
      "description: |",
      "  Use when parsing \"quoted\" frontmatter:",
      "  handles escaped text and colons.",
      "---",
      "# YAML Skill",
      "",
    ].join("\n"),
  );

  const skills = await scanSkillRoots([path.join(root, "skills")]);

  assert.deepEqual(
    skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
    })),
    [
      {
        name: "yaml-skill",
        description: 'Use when parsing "quoted" frontmatter:\nhandles escaped text and colons.',
        source: "skills",
      },
    ],
  );
});

test("audit log records events and summarizes called versus not called skills", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-log-"));
  const logFile = path.join(root, "runs", "run-1.jsonl");
  const discovered = [
    { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
    { name: "test-driven-development", description: "Use before implementation", source: "superpowers" },
  ];

  await appendEvent(logFile, { event: "task_start", runId: "run-1", harness: "codex", cwd: root });
  await appendEvent(logFile, { event: "skill_discovered", skill: discovered[0] });
  await appendEvent(logFile, { event: "skill_discovered", skill: discovered[1] });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "brainstorming",
    evidence: "self_reported",
    reason: "用户请求创建插件方案",
  });

  const events = await readEvents(logFile);
  const summary = summarizeRun(events);

  assert.equal(events.length, 4);
  assert.deepEqual(summary.calledSkills.map((item) => item.name), ["brainstorming"]);
  assert.equal(summary.calledSkills[0].evidence, "self_reported");
  assert.deepEqual(summary.notCalledSkills.map((item) => item.name), ["test-driven-development"]);
});

test("audit summary upgrades repeated calls to strongest evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-evidence-"));
  const logFile = path.join(root, "runs", "run-1.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-1", harness: "opencode", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "brainstorming",
    evidence: "self_reported",
    reason: "模型按审计指令记录",
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "brainstorming",
    evidence: "native_observed",
    reason: "OpenCode 原生 skill 工具调用事件",
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.equal(summary.calledSkills[0].evidence, "native_observed");
  assert.equal(summary.calledSkills[0].reason, "OpenCode 原生 skill 工具调用事件");
});

test("audit summary matches plugin-prefixed skill calls to discovered bare skill names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-prefixed-call-"));
  const logFile = path.join(root, "runs", "run-1.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-1", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: {
      name: "generate-skill-audit-report",
      description: "Write reports",
      source: "skill-ledger",
    },
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "skill-ledger:generate-skill-audit-report",
    evidence: "self_reported",
    reason: "plugin-prefixed call from host skill list",
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.deepEqual(summary.calledSkills.map((item) => item.name), ["generate-skill-audit-report"]);
  assert.equal(summary.calledSkills[0].source, "skill-ledger");
  assert.deepEqual(summary.notCalledSkills.map((item) => item.name), []);
});

test("collectSkillRoots appends explicit and environment roots to default roots", () => {
  const cwd = path.resolve("D:/workspace/project");
  const pluginRoot = path.resolve("D:/plugins/skill-ledger");
  const home = path.resolve("D:/home/user");
  const explicit = path.resolve("D:/extra/skills");
  const envRoot = path.resolve("D:/env/skills");

  const roots = collectSkillRoots({
    cwd,
    pluginRoot,
    home,
    explicitRoots: [explicit],
    env: { SKILL_LEDGER_SKILL_ROOTS: envRoot },
  });

  assert.ok(roots.includes(path.join(pluginRoot, "skills")));
  assert.ok(roots.includes(path.join(cwd, ".codex", "skills")));
  assert.ok(roots.includes(path.join(home, ".codex", "plugins", "cache")));
  assert.ok(roots.includes(path.join(home, ".cc-switch", "skills")));
  assert.ok(roots.includes(path.join(home, ".understand-anything", "repo", "understand-anything-plugin", "skills")));
  assert.ok(roots.includes(explicit));
  assert.ok(roots.includes(envRoot));
});

test("collectSkillRoots can restrict discovery to explicitly supplied roots", () => {
  const cwd = path.resolve("D:/workspace/project");
  const pluginRoot = path.resolve("D:/plugins/skill-ledger");
  const explicit = path.resolve("D:/only/skills");

  const roots = collectSkillRoots({
    cwd,
    pluginRoot,
    explicitRoots: [explicit],
    includeDefaults: false,
    env: { SKILL_LEDGER_SKILL_ROOTS: path.resolve("D:/env/skills") },
  });

  assert.deepEqual(roots, [explicit]);
});

test("renderChineseMarkdownReport produces Chinese report sections and evidence labels", async () => {
  const markdown = renderChineseMarkdownReport({
    runId: "run-1",
    harness: "opencode",
    cwd: "D:/repo",
    startedAt: "2026-07-06T08:00:00",
    finishedAt: "2026-07-06T08:05:00",
    discoveredSkills: [
      { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
      { name: "plugin-creator", description: "Create plugins", source: "codex" },
      { name: "generate-skill-audit-report", description: "Write reports", source: "skill-ledger" },
    ],
    calledSkills: [
      {
        name: "brainstorming",
        description: "Use before creative work",
        source: "superpowers",
        evidence: "native_observed",
        firstUsedAt: "2026-07-06T08:01:00",
        reason: "创建功能前需要澄清需求",
      },
      {
        name: "generate-skill-audit-report",
        description: "Write reports",
        source: "skill-ledger",
        evidence: "context_observed",
        firstUsedAt: "2026-07-06T08:04:00",
        reason: "任务结束时生成审计报告",
      },
    ],
    notCalledSkills: [{ name: "plugin-creator", description: "Create plugins", source: "codex" }],
    notes: ["报告默认使用中文输出。"],
  });

  assert.match(markdown, /^# Skills 调用审计报告/m);
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /## 已调用 Skills/);
  assert.match(markdown, /原生事件观测/);
  assert.match(markdown, /上下文观测（较高置信度，确认 Skill 内容进入模型上下文）/);
  assert.match(markdown, /## 未调用 Skills/);
  assert.match(markdown, /报告默认使用中文输出。/);
});
test("renderChineseMarkdownReport formats report timestamps as local display time", async () => {
  const markdown = renderChineseMarkdownReport({
    runId: "run-time",
    harness: "codex",
    cwd: "D:/repo",
    startedAt: "2026-07-06T08:00:00",
    finishedAt: "2026-07-06T08:05:00",
    discoveredSkills: [],
    calledSkills: [
      {
        name: "using-skill-audit",
        source: "skill-ledger",
        evidence: "self_reported",
        firstUsedAt: "2026-07-06T08:01:00",
        reason: "time format",
      },
    ],
    notCalledSkills: [],
  });

  assert.match(markdown, /2026-07-06 08:00:00/);
  assert.match(markdown, /2026-07-06 08:05:00/);
  assert.match(markdown, /2026-07-06 08:01:00/);
  assert.doesNotMatch(markdown, /2026-07-06T08:/);
});
