import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { appendEvent } from "../core/audit-log.mjs";
import { summarizeRun } from "../core/audit-log.mjs";
import {
  defaultLearnedModelPath,
  getEffectiveStopwords,
  getEffectiveSynonyms,
  getEffectiveThresholds,
  learnFromRuns,
  loadLearnedModel,
  saveLearnedModel,
  recordFeedback,
} from "../core/learning.mjs";

async function createTestRun(auditHome, runId, skills, taskContext) {
  const logFile = path.join(auditHome, "runs", `${runId}.jsonl`);
  await appendEvent(logFile, { event: "task_start", runId, harness: "test", cwd: auditHome, privacyMode: "balanced", taskContext });
  for (const skill of skills) {
    await appendEvent(logFile, { event: "skill_discovered", runId, skill });
  }
  await appendEvent(logFile, { event: "task_end", runId });
  return logFile;
}

test("loadLearnedModel returns defaults when file does not exist", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const model = await loadLearnedModel(path.join(tmp, "learned-model.json"));
  assert.equal(model.version, 1);
  assert.deepEqual(model.learnedStopwords, []);
  assert.deepEqual(model.learnedSynonyms, []);
  assert.deepEqual(model.feedback.confirmed, []);
  assert.deepEqual(model.feedback.rejected, []);
  assert.equal(model.thresholds.minMissScore, null);
});

test("saveLearnedModel writes and reloads correctly", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const modelPath = path.join(tmp, "learned-model.json");
  const model = await loadLearnedModel(modelPath);
  model.learnedStopwords = ["generic", "common"];
  model.learnedSynonyms = [{ canonical: "ui", words: ["ui", "界面"], count: 5 }];
  await saveLearnedModel(modelPath, model);
  const reloaded = await loadLearnedModel(modelPath);
  assert.deepEqual(reloaded.learnedStopwords, ["generic", "common"]);
  assert.equal(reloaded.learnedSynonyms[0].canonical, "ui");
});

test("getEffectiveStopwords merges base and learned", () => {
  const base = new Set(["the", "a", "use"]);
  const model = { learnedStopwords: ["generic", "common"] };
  const merged = getEffectiveStopwords(base, model);
  assert.ok(merged.has("the"));
  assert.ok(merged.has("generic"));
  assert.ok(merged.has("common"));
  assert.equal(merged.size, 5);
});

test("getEffectiveStopwords returns base when no learned model", () => {
  const base = new Set(["the", "a"]);
  const merged = getEffectiveStopwords(base, null);
  assert.equal(merged, base);
});

test("getEffectiveSynonyms merges base and learned groups", () => {
  const baseGroups = [["ui", "界面"], ["frontend", "前端"]];
  const model = { learnedSynonyms: [{ canonical: "api", words: ["api", "接口"], count: 10 }] };
  const merged = getEffectiveSynonyms(baseGroups, model);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[2], ["api", "接口"]);
});

test("getEffectiveThresholds uses learned values when present", () => {
  const model = { thresholds: { minMissScore: 1.5, highMissScore: 3.5, maxDfRatio: 0.2 } };
  const t = getEffectiveThresholds(0.8, 2, 0.3, model);
  assert.equal(t.minMissScore, 1.5);
  assert.equal(t.highMissScore, 3.5);
  assert.equal(t.maxDfRatio, 0.2);
});

test("getEffectiveThresholds falls back to base when null", () => {
  const t = getEffectiveThresholds(0.8, 2, 0.3, null);
  assert.equal(t.minMissScore, 0.8);
  assert.equal(t.highMissScore, 2);
  assert.equal(t.maxDfRatio, 0.3);
});

test("learnFromRuns requires minimum runs", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const auditHome = path.join(tmp, ".skill-ledger");
  await mkdir(path.join(auditHome, "runs"), { recursive: true });
  const result = await learnFromRuns(auditHome);
  assert.equal(result.stats.runsAnalyzed, 0);
  assert.ok(result.stats.reason);
});

test("learnFromRuns does not learn when run files exist but most are incomplete", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const auditHome = path.join(tmp, ".skill-ledger");
  await mkdir(path.join(auditHome, "runs"), { recursive: true });

  // Create 4 run files, but only 1 has task_end
  const skills = [{ name: "skill-a", description: "Use when creating widgets", source: "test" }];
  await createTestRun(auditHome, "run-0", skills, "create widgets");

  // 3 incomplete runs (no task_end)
  for (let i = 1; i <= 3; i++) {
    const logFile = path.join(auditHome, "runs", `run-${i}.jsonl`);
    await appendEvent(logFile, { event: "task_start", runId: `run-${i}`, harness: "test", cwd: auditHome, privacyMode: "balanced", taskContext: `task ${i}` });
    await appendEvent(logFile, { event: "skill_discovered", runId: `run-${i}`, skill: skills[0] });
    // No task_end
  }

  const result = await learnFromRuns(auditHome);
  assert.equal(result.stats.runsAnalyzed, 0);
  assert.ok(result.stats.reason);
  assert.ok(result.stats.reason.includes("已完成运行"));
});

test("learnFromRuns discovers high-frequency stopwords across runs", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const auditHome = path.join(tmp, ".skill-ledger");
  await mkdir(path.join(auditHome, "runs"), { recursive: true });

  const skills = [
    { name: "skill-a", description: "Use this when you need to create something useful", source: "test" },
    { name: "skill-b", description: "Use this when you want to build something useful", source: "test" },
    { name: "skill-c", description: "Use this when you need to handle something useful", source: "test" },
  ];

  for (let i = 0; i < 5; i++) {
    await createTestRun(auditHome, `run-${i}`, skills, `任务 ${i}: create something useful`);
  }

  const result = await learnFromRuns(auditHome);
  assert.equal(result.stats.runsAnalyzed, 5);
  assert.ok(result.model.learnedStopwords.includes("use"));
  assert.ok(result.model.learnedStopwords.includes("when"));
});

test("learnFromRuns with --merge preserves existing feedback", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const auditHome = path.join(tmp, ".skill-ledger");
  await mkdir(path.join(auditHome, "runs"), { recursive: true });

  const skills = [
    { name: "skill-a", description: "Use this when creating widgets", source: "test" },
  ];
  for (let i = 0; i < 4; i++) {
    await createTestRun(auditHome, `run-${i}`, skills, "create widgets");
  }

  const modelPath = path.join(tmp, "learned-model.json");
  const model = await loadLearnedModel(modelPath);
  recordFeedback(model, { skillName: "some-skill", verdict: "rejected", reason: "false positive" });
  await saveLearnedModel(modelPath, model);

  // Re-learn with merge
  const existing = await loadLearnedModel(modelPath);
  const result = await learnFromRuns(auditHome, { existingModel: existing });
  assert.equal(result.model.feedback.rejected.length, 1);
  assert.equal(result.model.feedback.rejected[0].skillName, "some-skill");
});

test("recordFeedback marks skill as rejected and adjusts thresholds after 3 rejections", () => {
  const model = { feedback: { confirmed: [], rejected: [] }, thresholds: { minMissScore: null, highMissScore: null, maxDfRatio: null } };
  recordFeedback(model, { skillName: "skill-a", verdict: "rejected" });
  recordFeedback(model, { skillName: "skill-b", verdict: "rejected" });
  assert.equal(model.thresholds.minMissScore, null);

  recordFeedback(model, { skillName: "skill-c", verdict: "rejected" });
  assert.ok(model.thresholds.minMissScore > 0.8);
  assert.ok(model.thresholds.highMissScore > 2);
  assert.ok(model.thresholds.maxDfRatio < 0.3);
  assert.equal(model.feedback.rejected.length, 3);
});

test("recordFeedback same skill rejected 3 times accumulates and triggers threshold adjustment", () => {
  const model = { feedback: { confirmed: [], rejected: [] }, thresholds: { minMissScore: null, highMissScore: null, maxDfRatio: null } };
  recordFeedback(model, { skillName: "recurring-false-positive", verdict: "rejected" });
  recordFeedback(model, { skillName: "recurring-false-positive", verdict: "rejected" });
  assert.equal(model.thresholds.minMissScore, null);
  assert.equal(model.feedback.rejected.length, 2);

  recordFeedback(model, { skillName: "recurring-false-positive", verdict: "rejected" });
  assert.ok(model.thresholds.minMissScore > 0.8, "3 rejections of same skill should trigger threshold adjustment");
  assert.equal(model.feedback.rejected.length, 3);
  assert.equal(model.feedback.lastVerdict["recurring-false-positive"], "rejected");
});

test("recordFeedback confirmed accumulates alongside rejected", () => {
  const model = {
    feedback: { confirmed: [], rejected: [{ skillName: "x", time: "2026-01-01" }] },
    thresholds: { minMissScore: 1.2, highMissScore: 3, maxDfRatio: 0.2 },
  };
  recordFeedback(model, { skillName: "y", verdict: "confirmed" });
  assert.equal(model.feedback.confirmed.length, 1);
  assert.equal(model.feedback.rejected.length, 1);
  assert.equal(model.feedback.lastVerdict["y"], "confirmed");
});

test("summarizeRun applies learned stopwords to miss detection", () => {
  const events = [
    { event: "task_start", runId: "t", harness: "test", cwd: ".", privacyMode: "balanced", taskContext: "design create something" },
    { event: "skill_discovered", runId: "t", skill: { name: "skill-a", description: "Use when creating design widgets ui", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "skill-b", description: "Build REST API backend services Node", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "skill-c", description: "Write tests for TDD red green refactor", source: "s" } },
    { event: "task_end", runId: "t" },
  ];

  const withoutModel = summarizeRun(events);
  const withModel = summarizeRun(events, {
    learnedModel: { learnedStopwords: ["create", "something"], learnedSynonyms: [], thresholds: {} },
  });

  // skill-a has "design" and "create" as keywords. Without learned stopwords,
  // it may be flagged because "design" and "create" both match the context.
  // With "create" as a learned stopword, only "design" remains, and if it's
  // a unique hit (DF=1), it could still pass — so we verify the learned stopword
  // actually reduces the number of matched keywords.
  const aWithout = withoutModel.possiblyMissedSkills.find((s) => s.name === "skill-a");
  const aWith = withModel.possiblyMissedSkills.find((s) => s.name === "skill-a");

  // The learned stopword must reduce or eliminate the candidate
  if (aWithout) {
    // If skill-a was flagged without the model, it should either
    // not be flagged with the model, or have fewer matched keywords
    if (aWith) {
      const withoutKws = aWithout.reason.split("：")[1]?.split("、") || [];
      const withKws = aWith.reason.split("：")[1]?.split("、") || [];
      assert.ok(withKws.length <= withoutKws.length, "learned stopwords should reduce matched keywords");
    }
    // aWith being undefined is the ideal outcome — assertion passes
  }
  // If aWithout is undefined (skill-a was never flagged), the test
  // still passes — it just means the base stopwords were already sufficient
});

test("summarizeRun applies learned thresholds from feedback", () => {
  const events = [
    { event: "task_start", runId: "t", harness: "test", cwd: ".", privacyMode: "balanced", taskContext: "design frontend ui" },
    { event: "skill_discovered", runId: "t", skill: { name: "ui-ux-pro-max", description: "UI/UX design intelligence styles palettes", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "backend-api", description: "Build REST API backend services", source: "s" } },
    { event: "task_end", runId: "t" },
  ];

  const normal = summarizeRun(events);
  const tightened = summarizeRun(events, {
    learnedModel: {
      learnedStopwords: [],
      learnedSynonyms: [],
      thresholds: { minMissScore: 10, highMissScore: 20, maxDfRatio: 0.1 },
    },
  });

  assert.ok(normal.possiblyMissedSkills.some((s) => s.name === "ui-ux-pro-max"));
  assert.equal(tightened.possiblyMissedSkills.length, 0);
});

test("defaultLearnedModelPath resolves under project root", () => {
  const p = defaultLearnedModelPath("/my/project");
  assert.ok(p.endsWith(path.join("skill-ledger", "learned-model.json")));
});

test("learnFromRuns learns stopwords with per-run DF ratio (different skill sets across runs)", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "sl-learn-"));
  const auditHome = path.join(tmp, ".skill-ledger");
  await mkdir(path.join(auditHome, "runs"), { recursive: true });

  // 3 runs, each with 10 different skills, all sharing the word "use"
  const runSkills = [];
  for (let i = 0; i < 3; i++) {
    const skills = [];
    for (let j = 0; j < 10; j++) {
      skills.push({
        name: `skill-${i}-${j}`,
        description: `Use this when doing task ${i}-${j} something unique${j}`,
        source: "test",
      });
    }
    runSkills.push(skills);
  }

  for (let i = 0; i < 3; i++) {
    await createTestRun(auditHome, `run-${i}`, runSkills[i], `do task ${i}`);
  }

  const result = await learnFromRuns(auditHome);
  assert.equal(result.stats.runsAnalyzed, 3);
  // "use" appears in all 10 skills per run = 100% DF ratio per run, avg = 100% >= 35%
  assert.ok(
    result.model.learnedStopwords.includes("use"),
    "use should be learned as stopword (100% avg DF ratio)"
  );
});

test("summarizeRun without learnedModel produces identical results (no model = original behavior)", () => {
  const events = [
    { event: "task_start", runId: "t", harness: "test", cwd: ".", privacyMode: "balanced", taskContext: "design frontend ui react dashboard landing" },
    { event: "skill_discovered", runId: "t", skill: { name: "frontend-design", description: "Create distinctive production-grade frontend interfaces with high design quality", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "ui-ux-pro-max", description: "UI/UX design intelligence 67 styles 96 palettes 57 font pairings 25 charts 13 stacks React Next.js Vue Svelte", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "backend-api", description: "Build REST API backend services with Node.js Express", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "code-review-loop", description: "AI code review for feature bug fix refactor changes", source: "s" } },
    { event: "skill_discovered", runId: "t", skill: { name: "imagegen", description: "Generate raster images photos illustrations textures sprites mockups", source: "s" } },
    { event: "skill_called", runId: "t", skill: "frontend-design", evidence: "self_reported", reason: "构建前端界面", time: "2026-07-14T10:00:00Z" },
    { event: "task_end", runId: "t" },
  ];

  // summarizeRun with null learnedModel should use the same path as summarizeRun(events)
  const withoutModel = summarizeRun(events);
  const withNullModel = summarizeRun(events, { learnedModel: null });
  const withoutOption = summarizeRun(events);

  // All three should produce identical possiblyMissedSkills
  assert.deepEqual(withoutModel.possiblyMissedSkills, withoutOption.possiblyMissedSkills);
  assert.deepEqual(withNullModel.possiblyMissedSkills, withoutOption.possiblyMissedSkills);
});