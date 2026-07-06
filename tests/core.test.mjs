import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { appendEvent, readEvents, summarizeRun } from "../core/audit-log.mjs";
import { renderChineseMarkdownReport } from "../core/report-md.mjs";
import { scanSkillRoots } from "../core/skill-scanner.mjs";

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
  assert.deepEqual(summary.notCalledSkills.map((item) => item.name), ["test-driven-development"]);
});

test("renderChineseMarkdownReport produces Chinese report sections and evidence labels", async () => {
  const markdown = renderChineseMarkdownReport({
    runId: "run-1",
    harness: "opencode",
    cwd: "D:/repo",
    startedAt: "2026-07-06T08:00:00.000Z",
    finishedAt: "2026-07-06T08:05:00.000Z",
    discoveredSkills: [
      { name: "brainstorming", description: "Use before creative work", source: "superpowers" },
      { name: "plugin-creator", description: "Create plugins", source: "codex" },
    ],
    calledSkills: [
      {
        name: "brainstorming",
        description: "Use before creative work",
        source: "superpowers",
        evidence: "native_observed",
        firstUsedAt: "2026-07-06T08:01:00.000Z",
        reason: "创建功能前需要澄清需求",
      },
    ],
    notCalledSkills: [{ name: "plugin-creator", description: "Create plugins", source: "codex" }],
    notes: ["报告默认使用中文输出。"],
  });

  assert.match(markdown, /^# Skills 调用审计报告/m);
  assert.match(markdown, /## 摘要/);
  assert.match(markdown, /## 已调用 Skills/);
  assert.match(markdown, /原生事件观测/);
  assert.match(markdown, /## 未调用 Skills/);
  assert.match(markdown, /报告默认使用中文输出。/);
});
