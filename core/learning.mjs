import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { readEvents } from "./audit-log.mjs";
import { skillNameKey } from "./skill-name.mjs";

const DEFAULT_MODEL_PATH = "skill-ledger/learned-model.json";
const MIN_RUNS_FOR_LEARNING = 3;
const MIN_AVG_DF_RATIO_FOR_STOPWORD = 0.35;
const MIN_COOCCURRENCE_FOR_SYNONYM = 8;
const MIN_COOCCURRENCE_RATIO_FOR_SYNONYM = 0.75;

const DEFAULT_MODEL = {
  version: 1,
  updatedAt: "",
  stats: {
    runsAnalyzed: 0,
    skillsSeen: 0,
  },
  learnedStopwords: [],
  learnedSynonyms: [],
  feedback: {
    confirmed: [],
    rejected: [],
  },
  thresholds: {
    minMissScore: null,
    highMissScore: null,
    maxDfRatio: null,
  },
};

export function defaultLearnedModelPath(cwd = process.cwd()) {
  return path.resolve(cwd, DEFAULT_MODEL_PATH);
}

export async function loadLearnedModel(modelPath) {
  try {
    const content = await readFile(modelPath, "utf8");
    const parsed = JSON.parse(content);
    return mergeWithDefaults(parsed);
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(DEFAULT_MODEL);
    throw error;
  }
}

export async function saveLearnedModel(modelPath, model) {
  await mkdir(path.dirname(modelPath), { recursive: true });
  const enriched = {
    ...model,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(modelPath, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

export async function learnFromRuns(auditHome, { existingModel = null } = {}) {
  const runsDir = path.join(auditHome, "runs");
  let entries = [];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const runFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl"));

  const completedRuns = [];
  for (const entry of runFiles) {
    const logFile = path.join(runsDir, entry.name);
    const events = await readEvents(logFile);
    if (events.some((e) => e.event === "task_end")) {
      completedRuns.push({ entry, logFile, events });
    }
  }

  if (completedRuns.length < MIN_RUNS_FOR_LEARNING) {
    return {
      model: existingModel || structuredClone(DEFAULT_MODEL),
      stats: { runsAnalyzed: 0, reason: `需要至少 ${MIN_RUNS_FOR_LEARNING} 个已完成运行才能学习（当前 ${completedRuns.length} 个）` },
    };
  }

  const model = existingModel ? structuredClone(existingModel) : structuredClone(DEFAULT_MODEL);
  const stopwordStats = new Map();
  const cooccurrence = new Map();
  const skillNames = new Set();
  let runsAnalyzed = 0;

  for (const { events } of completedRuns) {
    runsAnalyzed++;
    const discoveredSkills = [];
    let taskContext = "";

    for (const event of events) {
      if (event.event === "task_start" && event.taskContext) {
        taskContext = event.taskContext;
      }
      if (event.event === "task_context" && event.text) {
        taskContext = `${taskContext} ${event.text}`.trim();
      }
      if (event.event === "skill_discovered" && event.skill?.name) {
        discoveredSkills.push(event.skill);
        skillNames.add(event.skill.name);
      }
    }

    // 停用词学习：统计关键词在本次运行中出现在多少个 skill 的描述中（per-run DF），
    // 再跨运行取平均比例。高平均比例意味着该词对区分 skill 缺乏判别力。
    const perRunDf = new Map();
    for (const skill of discoveredSkills) {
      const keywords = new Set(extractRawKeywords(`${skill.name} ${skill.description || ""}`));
      for (const kw of keywords) {
        perRunDf.set(kw, (perRunDf.get(kw) || 0) + 1);
      }
    }
    const perRunSkillCount = Math.max(discoveredSkills.length, 1);
    for (const [kw, df] of perRunDf) {
      if (!stopwordStats.has(kw)) stopwordStats.set(kw, { totalRatio: 0, runs: 0 });
      const stat = stopwordStats.get(kw);
      stat.totalRatio += df / perRunSkillCount;
      stat.runs += 1;
    }

    if (taskContext) {
      const contextKws = extractRawKeywords(taskContext);
      const seenPairs = new Set();
      for (const skill of discoveredSkills) {
        const skillKws = new Set(extractRawKeywords(`${skill.name} ${skill.description || ""}`));
        // Direct co-occurrence: pair context keywords with skill description keywords
        for (const ctxKw of contextKws) {
          for (const skillKw of skillKws) {
            if (ctxKw === skillKw) continue;
            const pair = [ctxKw, skillKw].sort().join("||");
            if (seenPairs.has(pair)) continue;
            seenPairs.add(pair);
            cooccurrence.set(pair, (cooccurrence.get(pair) || 0) + 1);
          }
        }
      }
    }
  }

  const learnedStopwords = [];
  for (const [word, stat] of stopwordStats) {
    const avgRatio = stat.totalRatio / stat.runs;
    if (avgRatio >= MIN_AVG_DF_RATIO_FOR_STOPWORD && stat.runs >= Math.ceil(runsAnalyzed * 0.5)) {
      learnedStopwords.push(word);
    }
  }
  learnedStopwords.sort();

  const learnedSynonyms = [];
  for (const [pair, count] of cooccurrence) {
    if (count < MIN_COOCCURRENCE_FOR_SYNONYM) continue;
    const [wordA, wordB] = pair.split("||");
    const ratio = count / runsAnalyzed;
    if (ratio < MIN_COOCCURRENCE_RATIO_FOR_SYNONYM) continue;
    const existing = learnedSynonyms.find(
      (group) => group.words.includes(wordA) || group.words.includes(wordB),
    );
    if (existing) {
      if (!existing.words.includes(wordA)) existing.words.push(wordA);
      if (!existing.words.includes(wordB)) existing.words.push(wordB);
    } else {
      learnedSynonyms.push({ canonical: wordA, words: [wordA, wordB], count });
    }
  }

  model.learnedStopwords = learnedStopwords;
  model.learnedSynonyms = learnedSynonyms;
  model.stats = { runsAnalyzed, skillsSeen: skillNames.size };
  model.thresholds = computeAdaptiveThresholds(model, existingModel, runsAnalyzed);

  return { model, stats: { runsAnalyzed, skillsSeen: skillNames.size, stopwordsLearned: learnedStopwords.length, synonymsLearned: learnedSynonyms.length } };
}

export function recordFeedback(model, { skillName, verdict, reason = "" }) {
  const feedback = model.feedback || (model.feedback = { confirmed: [], rejected: [] });
  const entry = { skillName, reason, time: new Date().toISOString() };

  if (verdict === "confirmed") {
    feedback.confirmed.push(entry);
  } else if (verdict === "rejected") {
    feedback.rejected.push(entry);
  }

  // Keep last verdict per skill for quick lookup, but preserve event history
  feedback.lastVerdict = feedback.lastVerdict || {};
  feedback.lastVerdict[skillName] = verdict;

  model.thresholds = computeAdaptiveThresholds(model, null, 0);
  return model;
}

export function getEffectiveStopwords(baseStopwords, learnedModel) {
  if (!learnedModel?.learnedStopwords?.length) return baseStopwords;
  const merged = new Set(baseStopwords);
  for (const word of learnedModel.learnedStopwords) {
    merged.add(word);
  }
  return merged;
}

export function getEffectiveSynonyms(baseSynonymGroups, learnedModel) {
  if (!learnedModel?.learnedSynonyms?.length) return baseSynonymGroups;
  const merged = [...baseSynonymGroups];
  for (const group of learnedModel.learnedSynonyms) {
    merged.push(group.words);
  }
  return merged;
}

export function getEffectiveThresholds(baseMinMissScore, baseHighMissScore, baseMaxDfRatio, learnedModel) {
  const t = learnedModel?.thresholds;
  return {
    minMissScore: t?.minMissScore ?? baseMinMissScore,
    highMissScore: t?.highMissScore ?? baseHighMissScore,
    maxDfRatio: t?.maxDfRatio ?? baseMaxDfRatio,
  };
}

function computeAdaptiveThresholds(model, previousModel, runsAnalyzed) {
  const feedback = model.feedback || { confirmed: [], rejected: [] };
  const rejectedCount = feedback.rejected.length;
  const confirmedCount = feedback.confirmed.length;
  const totalFeedback = rejectedCount + confirmedCount;
  const baseMin = 0.8;
  const baseHigh = 2;
  const baseRatio = 0.3;

  if (totalFeedback < 3) {
    return {
      minMissScore: previousModel?.thresholds?.minMissScore ?? null,
      highMissScore: previousModel?.thresholds?.highMissScore ?? null,
      maxDfRatio: previousModel?.thresholds?.maxDfRatio ?? null,
    };
  }

  const rejectRate = rejectedCount / totalFeedback;
  const adjustment = 1 + rejectRate * 0.5;

  return {
    minMissScore: Number((baseMin * adjustment).toFixed(2)),
    highMissScore: Number((baseHigh * adjustment).toFixed(2)),
    maxDfRatio: Number(Math.max(0.15, baseRatio - rejectRate * 0.1).toFixed(2)),
  };
}

function mergeWithDefaults(parsed) {
  return {
    ...structuredClone(DEFAULT_MODEL),
    ...parsed,
    stats: { ...DEFAULT_MODEL.stats, ...(parsed.stats || {}) },
    feedback: {
      confirmed: parsed.feedback?.confirmed || [],
      rejected: parsed.feedback?.rejected || [],
      lastVerdict: parsed.feedback?.lastVerdict || {},
    },
    thresholds: { ...DEFAULT_MODEL.thresholds, ...(parsed.thresholds || {}) },
    learnedStopwords: parsed.learnedStopwords || [],
    learnedSynonyms: parsed.learnedSynonyms || [],
  };
}

const SIMPLE_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "with", "by", "from", "at", "as", "is", "are",
  "be", "this", "that", "it", "you", "your", "they", "them", "any", "all", "each", "other", "than",
  "then", "so", "such", "also", "not", "no", "but", "if", "else", "before", "after", "how", "what",
  "which", "can", "should", "will", "do", "does", "has", "have", "into", "out", "up", "down", "via",
  "like", "etc", "new", "existing",
]);

function extractRawKeywords(text) {
  const source = String(text || "").toLowerCase();
  if (!source) return [];
  const tokens = new Set();
  for (const token of source.split(/[^a-z0-9]+/i)) {
    const trimmed = token.trim();
    if (!trimmed || trimmed.length < 2) continue;
    if (SIMPLE_STOPWORDS.has(trimmed)) continue;
    tokens.add(trimmed);
  }

  let segmenter = null;
  try {
    segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
  } catch {
    segmenter = null;
  }

  if (segmenter) {
    for (const seg of segmenter.segment(source)) {
      const word = seg.segment.trim();
      if (word.length < 2) continue;
      if (!/[\u4e00-\u9fff]/.test(word)) continue;
      if (SIMPLE_STOPWORDS.has(word)) continue;
      tokens.add(word);
    }
  } else {
    const cjkChars = Array.from(source).filter((char) => /[\u4e00-\u9fff]/.test(char));
    for (let i = 0; i < cjkChars.length - 1; i++) {
      const bigram = cjkChars[i] + cjkChars[i + 1];
      if (!SIMPLE_STOPWORDS.has(bigram)) tokens.add(bigram);
    }
  }
  return [...tokens];
}
