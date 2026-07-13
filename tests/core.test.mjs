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

test("summarizeRun flags possibly missed skills via description keyword overlap", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-miss-"));
  const logFile = path.join(root, "runs", "run-miss.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-miss", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: {
      name: "code-review-loop",
      description: "Run code review before finishing",
      source: "superpowers",
    },
  });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: {
      name: "verification-before-completion",
      description: "verification before completion requires running commands",
      source: "superpowers",
    },
  });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: {
      name: "image-generation",
      description: "Generate bitmap images and photos",
      source: "tools",
    },
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "code-review-loop",
    evidence: "self_reported",
    reason: "perform code review and verification before completion",
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.ok(Array.isArray(summary.possiblyMissedSkills));
  const flagged = summary.possiblyMissedSkills.find((skill) => skill.name === "verification-before-completion");
  assert.ok(flagged, "verification-before-completion should be flagged as possibly missed");
  assert.match(flagged.reason, /verification/);
  assert.ok(["较高", "中等"].includes(flagged.confidence));
  assert.ok(
    !summary.possiblyMissedSkills.some((skill) => skill.name === "image-generation"),
    "image-generation has no context overlap and must not be flagged",
  );
  assert.ok(
    !summary.possiblyMissedSkills.some((skill) => skill.name === "code-review-loop"),
    "already called skills must never appear in possibly missed",
  );
});

test("summarizeRun omits possiblyMissedSkills when there is no task context", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-miss-empty-"));
  const logFile = path.join(root, "runs", "run-miss-empty.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-miss-empty", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.deepEqual(summary.possiblyMissedSkills, []);
});

test("renderChineseMarkdownReport includes possibly missed skills section when present", () => {
  const markdown = renderChineseMarkdownReport({
    runId: "run-miss-report",
    harness: "codex",
    cwd: "D:/repo",
    startedAt: "2026-07-09T07:00:00",
    finishedAt: "2026-07-09T07:10:00",
    discoveredSkills: [],
    calledSkills: [],
    notCalledSkills: [],
    possiblyMissedSkills: [
      {
        name: "verification-before-completion",
        reason: "任务上下文命中描述关键词：verification、completion",
        confidence: "较高",
      },
    ],
    notes: [],
  });

  assert.match(markdown, /## 可能漏用的 Skills/);
  assert.match(markdown, /启发式匹配，仅供参考/);
  assert.match(markdown, /verification-before-completion/);
  assert.match(markdown, /\| 较高 \|/);
});

test("normalizeSkillName strips prefixes, namespaces, paths, and SKILL.md suffix", async () => {
  const { normalizeSkillName } = await import("../core/skill-name.mjs");
  assert.equal(normalizeSkillName("/brainstorming"), "brainstorming");
  assert.equal(normalizeSkillName("@brainstorming"), "brainstorming");
  assert.equal(normalizeSkillName("skill-ledger:generate-skill-audit-report"), "generate-skill-audit-report");
  assert.equal(normalizeSkillName("owner/skill-ledger:brainstorming"), "brainstorming");
  assert.equal(normalizeSkillName("skills\\brainstorming\\SKILL.md"), "brainstorming");
  assert.equal(normalizeSkillName("skills/brainstorming/SKILL.md"), "brainstorming");
  assert.equal(normalizeSkillName("Brainstorming"), "Brainstorming");
});

test("isSkillTool matches known and flexible skill tool names", async () => {
  const { isSkillTool } = await import("../core/skill-name.mjs");
  assert.ok(isSkillTool("Skill"));
  assert.ok(isSkillTool("skill"));
  assert.ok(isSkillTool("SkillTool"));
  assert.ok(isSkillTool("load-skill"));
  assert.ok(isSkillTool("invoke_skill"));
  assert.ok(isSkillTool("applySkill"));
  assert.ok(!isSkillTool("read_file"));
  assert.ok(!isSkillTool("bash"));
  assert.ok(!isSkillTool(""));
});

test("canonicalSkillName maps case-insensitive and prefixed calls to discovered names", async () => {
  const { canonicalSkillName, skillNameKey } = await import("../core/skill-name.mjs");
  const discoveredByKey = new Map([["brainstorming", "brainstorming"]]);

  assert.equal(canonicalSkillName("Brainstorming", discoveredByKey), "brainstorming");
  assert.equal(canonicalSkillName("plugin:brainstorming", discoveredByKey), "brainstorming");
  assert.equal(canonicalSkillName("skills/Brainstorming/SKILL.md", discoveredByKey), "brainstorming");
  assert.equal(canonicalSkillName("unknown-skill", discoveredByKey), "unknown-skill");
  assert.equal(skillNameKey("BrainStorming"), skillNameKey("brainstorming"));
});

test("summarizeRun matches case-insensitive and path-suffixed skill calls to discovered skills", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-normalize-"));
  const logFile = path.join(root, "runs", "run-norm.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-norm", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "skills/Brainstorming/SKILL.md",
    evidence: "self_reported",
    reason: "path-suffixed call",
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.deepEqual(summary.calledSkills.map((item) => item.name), ["brainstorming"]);
  assert.deepEqual(summary.notCalledSkills.map((item) => item.name), []);
});

test("summarizeRun dedups same-evidence skill_called events from hook and model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-dedup-"));
  const logFile = path.join(root, "runs", "run-dedup.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-dedup", harness: "opencode", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
  });
  // 两条相同证据等级的自报，应只保留第一条。
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "brainstorming",
    evidence: "self_reported",
    reason: "first self report",
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "brainstorming",
    evidence: "self_reported",
    reason: "second self report",
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.equal(summary.calledSkills.length, 1);
  assert.equal(summary.calledSkills[0].reason, "first self report");
});

test("summarizeRun marks self_reported-only calls as uncorroborated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-corrob-"));
  const logFile = path.join(root, "runs", "run-corrob.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-corrob", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
  });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "code-review", description: "Run code review", source: "superpowers" },
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "brainstorming",
    evidence: "self_reported",
    reason: "self report only",
  });
  await appendEvent(logFile, {
    event: "skill_called",
    skill: "code-review",
    evidence: "native_observed",
    reason: "hook observed",
  });

  const summary = summarizeRun(await readEvents(logFile));
  const brainstorming = summary.calledSkills.find((item) => item.name === "brainstorming");
  const codeReview = summary.calledSkills.find((item) => item.name === "code-review");

  assert.equal(brainstorming.corroborated, false);
  assert.equal(codeReview.corroborated, true);
});

test("summarizeRun uses task_context events for possibly-missed detection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-taskctx-"));
  const logFile = path.join(root, "runs", "run-taskctx.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-taskctx", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "image-generation", description: "Generate bitmap images and photos", source: "tools" },
  });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "code-review-loop", description: "Run code review before finishing", source: "superpowers" },
  });
  await appendEvent(logFile, {
    event: "task_context",
    runId: "run-taskctx",
    text: "用户要求生成一张产品图片并审查代码",
  });

  const summary = summarizeRun(await readEvents(logFile));

  assert.ok(summary.hasTaskContext);
  const flagged = summary.possiblyMissedSkills.find((item) => item.name === "image-generation");
  assert.ok(flagged, "image-generation should be flagged via task_context");
});

test("summarizeRun detects possibly missed skills via Chinese synonyms and segmentation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-cn-"));
  const logFile = path.join(root, "runs", "run-cn.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-cn", harness: "codex", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "frontend-design", description: "Build distinctive web UI and frontend interfaces", source: "skills" },
  });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "image-generation", description: "Generate bitmap images and photos", source: "tools" },
  });
  await appendEvent(logFile, {
    event: "task_context",
    runId: "run-cn",
    text: "帮我做一个好看的界面和前端样式",
  });

  const summary = summarizeRun(await readEvents(logFile));

  const flagged = summary.possiblyMissedSkills.find((item) => item.name === "frontend-design");
  assert.ok(flagged, "frontend-design should be flagged via Chinese 界面/前端 synonym matching UI/frontend");
  assert.ok(
    !summary.possiblyMissedSkills.some((item) => item.name === "image-generation"),
    "image-generation has no context overlap and must not be flagged",
  );
});

test("summarizeRun uses tool_observed probe text as weak signal for possibly-missed detection", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-toolobs-"));
  const logFile = path.join(root, "runs", "run-toolobs.jsonl");

  await appendEvent(logFile, { event: "task_start", runId: "run-toolobs", harness: "cursor", cwd: root });
  await appendEvent(logFile, {
    event: "skill_discovered",
    skill: { name: "frontend-design", description: "Build distinctive web UI and frontend interfaces", source: "skills" },
  });
  // 没有 task_context，没有 skill_called，只有 tool_observed 探针事件携带 UI 相关文本。
  await appendEvent(logFile, {
    event: "tool_observed",
    runId: "run-toolobs",
    tool: "read_file",
    toolInputText: "read components/Button.tsx ui frontend styles",
    observation: "probe",
  });

  const summary = summarizeRun(await readEvents(logFile));

  const flagged = summary.possiblyMissedSkills.find((item) => item.name === "frontend-design");
  assert.ok(flagged, "frontend-design should be flagged via tool_observed probe text");
});

test("scanSkillRoots falls back to heading and name line when frontmatter is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-scan-fallback-"));
  const skillDir = path.join(root, "skills", "no-frontmatter");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "# No Frontmatter Skill\n\nThis skill has no YAML frontmatter.\n",
  );

  const skills = await scanSkillRoots([path.join(root, "skills")]);

  assert.ok(skills.some((skill) => skill.name === "no-frontmatter-skill" || skill.name === "no-frontmatter"));
});

test("scanSkillRoots discovers skills from plugin.json skills array", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-scan-manifest-"));
  const pluginDir = path.join(root, "my-plugin");
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({
      skills: [
        { name: "manifest-skill-a", description: "Manifest skill A" },
        "manifest-skill-b",
      ],
    }),
  );

  const skills = await scanSkillRoots([pluginDir]);

  assert.ok(skills.some((skill) => skill.name === "manifest-skill-a"));
  assert.ok(skills.some((skill) => skill.name === "manifest-skill-b"));
});

test("scanSkillRoots discovers skills from package.json skills array", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-scan-pkg-"));
  const pkgDir = path.join(root, "my-pkg");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      skills: [
        { name: "pkg-skill-a", description: "Pkg skill A" },
        "pkg-skill-b",
      ],
    }),
  );

  const skills = await scanSkillRoots([pkgDir]);

  assert.ok(skills.some((skill) => skill.name === "pkg-skill-a"));
  assert.ok(skills.some((skill) => skill.name === "pkg-skill-b"));
});

test("scanSkillRoots deduplicates manifest-declared and SKILL.md-discovered skills", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-scan-dedup-"));
  const pluginDir = path.join(root, "my-plugin");
  const skillDir = path.join(pluginDir, "manifest-with-file");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify({
      skills: [{ name: "manifest-with-file", description: "Manifest entry" }],
    }),
  );
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: manifest-with-file\ndescription: SKILL.md entry\n---\n# Manifest With File\n",
  );

  const skills = await scanSkillRoots([pluginDir]);

  const matches = skills.filter((skill) => skill.name === "manifest-with-file");
  assert.equal(matches.length, 1, "should not return duplicate skill for manifest + SKILL.md");
  // 优先保留指向真实 SKILL.md 的记录（description 更完整）。
  assert.equal(matches[0].description, "SKILL.md entry");
});

test("scanSkillRoots falls back to body name line when frontmatter is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-audit-scan-nameline-"));
  const skillDir = path.join(root, "skills", "name-line-only");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "name: name-line-only\n\nNo heading and no frontmatter here.\n",
  );

  const skills = await scanSkillRoots([path.join(root, "skills")]);

  assert.ok(skills.some((skill) => skill.name === "name-line-only"));
});

test("renderChineseMarkdownReport marks uncorroborated self-reported skills", () => {
  const markdown = renderChineseMarkdownReport({
    runId: "run-corrob-report",
    harness: "codex",
    cwd: "D:/repo",
    startedAt: "2026-07-09T07:00:00",
    finishedAt: "2026-07-09T07:10:00",
    discoveredSkills: [],
    calledSkills: [
      {
        name: "brainstorming",
        source: "superpowers",
        evidence: "self_reported",
        firstUsedAt: "2026-07-09T07:01:00",
        reason: "self report",
        corroborated: false,
      },
    ],
    notCalledSkills: [],
    hasTaskContext: true,
  });

  assert.match(markdown, /可疑自报告/);
  assert.match(markdown, /任务上下文：已记录/);
});

test("renderChineseMarkdownReport does not mark non-self-reported skills without corroborated field", () => {
  const markdown = renderChineseMarkdownReport({
    runId: "run-no-corrob",
    harness: "codex",
    cwd: "D:/repo",
    startedAt: "2026-07-09T07:00:00",
    finishedAt: "2026-07-09T07:10:00",
    discoveredSkills: [],
    calledSkills: [
      {
        name: "brainstorming",
        source: "superpowers",
        evidence: "native_observed",
        firstUsedAt: "2026-07-09T07:01:00",
        reason: "hook observed",
      },
    ],
    notCalledSkills: [],
  });

  // 摘要里不应出现可疑自报告计数。
  assert.doesNotMatch(markdown, /可疑自报告 Skills：/);
  // 已调用 Skills 表格行不应追加可疑自报告标记。
  const tableRow = markdown.split("\n").find((line) => line.includes("brainstorming") && line.includes("|"));
  assert.ok(tableRow, "should find a table row for brainstorming");
  assert.doesNotMatch(tableRow, /可疑自报告/);
});
