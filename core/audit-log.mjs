import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function appendEvent(logFile, event) {
  await mkdir(path.dirname(logFile), { recursive: true });
  const entry = {
    time: new Date().toISOString(),
    ...event,
  };
  await writeFile(logFile, `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}

export async function readEvents(logFile) {
  try {
    const content = await readFile(logFile, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function summarizeRun(events) {
  const discoveredByName = new Map();
  const calledByName = new Map();
  const notes = [];
  let runId = "";
  let harness = "";
  let cwd = "";
  let startedAt = "";
  let finishedAt = "";

  for (const event of events) {
    if (event.runId && !runId) runId = event.runId;
    if (event.event === "task_start") {
      harness = event.harness || harness;
      cwd = event.cwd || cwd;
      startedAt = event.time || startedAt;
    }
    if (event.event === "task_end") finishedAt = event.time || finishedAt;
    if (event.event === "audit_note" && event.note) notes.push(event.note);
    if (event.event === "skill_discovered" && event.skill?.name) {
      discoveredByName.set(event.skill.name, event.skill);
    }
    if (event.event === "skill_called") {
      const rawName = typeof event.skill === "string" ? event.skill : event.skill?.name;
      if (!rawName) continue;
      const name = canonicalSkillName(rawName, discoveredByName);
      const discovered = discoveredByName.get(name) || {};
      const current = {
        name,
        description: discovered.description || event.skill?.description || "",
        source: discovered.source || event.skill?.source || "",
        evidence: event.evidence || "self_reported",
        firstUsedAt: event.time || "",
        reason: event.reason || "",
      };
      if (!calledByName.has(name)) {
        calledByName.set(name, current);
        continue;
      }

      const existing = calledByName.get(name);
      if (evidenceRank(current.evidence) > evidenceRank(existing.evidence)) {
        existing.evidence = current.evidence;
        existing.reason = current.reason || existing.reason;
        existing.description = existing.description || current.description;
        existing.source = existing.source || current.source;
      }
    }
  }

  const discoveredSkills = [...discoveredByName.values()].sort(compareSkills);
  const calledSkills = [...calledByName.values()].sort(compareSkills);
  const calledNames = new Set(calledSkills.map((skill) => skill.name));
  const notCalledSkills = discoveredSkills.filter((skill) => !calledNames.has(skill.name));
  const possiblyMissedSkills = detectPossiblyMissedSkills({ discoveredSkills, calledSkills, notes });

  return {
    runId,
    harness,
    cwd,
    startedAt,
    finishedAt,
    discoveredSkills,
    calledSkills,
    notCalledSkills,
    possiblyMissedSkills,
    notes,
  };
}

const STOPWORDS = new Set([
  // articles, connectors, pronouns, prepositions
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "with", "without", "by", "from", "at",
  "as", "is", "are", "be", "been", "being", "this", "that", "these", "those", "it", "its", "you",
  "your", "they", "them", "their", "any", "all", "some", "more", "most", "each", "every", "other",
  "than", "then", "so", "such", "also", "not", "no", "but", "if", "else", "before", "after", "about",
  "how", "what", "which", "can", "should", "must", "will", "do", "does", "has", "have", "had", "into",
  "out", "up", "down", "over", "under", "via", "like", "etc", "new", "existing",
  // generic process verbs
  "use", "using", "used", "uses", "build", "builds", "building", "built", "implement", "implementing",
  "implements", "implemented", "create", "creating", "creates", "created", "generate", "generating",
  "generates", "generated", "develop", "developing", "developed", "write", "writing", "writes", "wrote",
  "add", "adding", "adds", "added", "run", "running", "runs", "ran", "make", "making", "makes", "made",
  "work", "working", "works", "worked", "fix", "fixing", "fixes", "fixed", "review", "reviewing",
  "reviews", "reviewed", "test", "testing", "tests", "tested", "design", "designing", "designs",
  "designed", "plan", "planning", "plans", "planned", "improve", "improving", "improves", "improved",
  "optimize", "optimizing", "optimizes", "optimized", "enhance", "enhancing", "enhances", "enhanced",
  "refactor", "refactoring", "refactors", "refactored", "check", "checking", "checks", "checked",
  "need", "needs", "needed", "want", "wants", "wanted", "ask", "asking", "asks", "asked", "help",
  "helping", "helps", "helped", "require", "requires", "required", "requiring", "support", "supports",
  "supported", "supporting", "provide", "provides", "provided", "providing", "include", "includes",
  "included", "including", "handle", "handles", "handled", "handling", "manage", "manages", "managed",
  "managing", "control", "controls", "controlled", "controlling", "expose", "exposes", "exposed",
  "exposing", "load", "loads", "loading", "loaded", "record", "recording", "recorded", "call", "calls",
  "calling", "called", "invoke", "invokes", "invoking", "invoked", "get", "gets", "getting", "got",
  "set", "sets", "setting", "let", "lets",
  // generic nouns / filler
  "task", "tasks", "user", "users", "code", "codes", "skill", "skills", "one", "two", "three", "first",
  "second", "third", "per", "form", "file", "files", "local", "output", "docs", "doc", "spec",
  "feature", "features", "comment", "comments", "feedback", "trigger", "triggers", "dev", "behavior",
  "component", "components", "creative", "function", "functions", "functionality", "workflow", "workflows",
  "when", "while",
]);

function detectPossiblyMissedSkills({ discoveredSkills, calledSkills, notes }) {
  const contextText = buildTaskContextText(calledSkills, notes);
  if (!contextText.trim()) return [];
  const contextKeywords = new Set(extractKeywords(contextText));

  const total = discoveredSkills.length;
  const maxDocumentFrequency = Math.max(2, Math.ceil(total * 0.25));
  const documentFrequency = new Map();
  for (const skill of discoveredSkills) {
    for (const keyword of new Set(extractKeywords(`${skill.name} ${skill.description}`))) {
      documentFrequency.set(keyword, (documentFrequency.get(keyword) || 0) + 1);
    }
  }

  const isDiscriminative = (keyword) => {
    const frequency = documentFrequency.get(keyword) || 0;
    return frequency > 0 && frequency <= maxDocumentFrequency;
  };

  const calledNames = new Set(calledSkills.map((skill) => skill.name));
  const candidates = [];
  for (const skill of discoveredSkills) {
    if (calledNames.has(skill.name)) continue;
    const keywords = [...new Set(extractKeywords(`${skill.name} ${skill.description}`))].filter(isDiscriminative);
    if (keywords.length < 2) continue;
    const matched = keywords.filter((keyword) => contextKeywords.has(keyword));
    if (matched.length < 2) continue;

    const score = matched.reduce((sum, keyword) => sum + 1 / (documentFrequency.get(keyword) || 1), 0);
    if (score < MIN_MISS_SCORE) continue;

    candidates.push({
      name: skill.name,
      reason: `任务上下文命中描述关键词：${matched.slice(0, 5).join("、")}`,
      confidence: score >= HIGH_MISS_SCORE && matched.length >= 3 ? "较高" : "中等",
      _score: score,
    });
  }

  return candidates
    .sort((left, right) => right._score - left._score)
    .map(({ _score, ...rest }) => rest);
}

const MIN_MISS_SCORE = 0.8;
const HIGH_MISS_SCORE = 2;

function buildTaskContextText(calledSkills, notes) {
  const parts = [];
  for (const skill of calledSkills) {
    parts.push(skill.name, skill.description || "", skill.reason || "");
  }
  parts.push(...notes);
  return parts.join(" ").toLowerCase();
}

function extractKeywords(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function evidenceRank(evidence) {
  const ranks = {
    log_inferred: 1,
    self_reported: 2,
    context_observed: 3,
    native_observed: 4,
  };
  return ranks[evidence] || 0;
}

function compareSkills(left, right) {
  const leftSource = left.source || "";
  const rightSource = right.source || "";
  if (leftSource !== rightSource) return leftSource.localeCompare(rightSource);
  return left.name.localeCompare(right.name);
}

function canonicalSkillName(name, discoveredByName) {
  if (discoveredByName.has(name)) return name;

  const suffix = String(name).includes(":") ? String(name).slice(String(name).lastIndexOf(":") + 1) : "";
  if (suffix && discoveredByName.has(suffix)) return suffix;

  return name;
}
