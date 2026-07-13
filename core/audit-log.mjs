import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalSkillName, skillNameKey } from "./skill-name.mjs";

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
  // discoveredByName：按归一化后的小写 key 存储，值为原始 skill 对象（保留展示用名字）。
  const discoveredByKey = new Map();
  const discoveredByDisplay = new Map();
  // calledByKey：按归一化小写 key 去重合并。
  const calledByKey = new Map();
  const notes = [];
  const taskContextParts = [];
  const toolObservedTexts = [];
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
      if (event.taskContext) taskContextParts.push(String(event.taskContext));
    }
    if (event.event === "task_end") finishedAt = event.time || finishedAt;
    if (event.event === "audit_note" && event.note) notes.push(event.note);
    if (event.event === "task_context" && event.text) taskContextParts.push(String(event.text));
    if (event.event === "skill_discovered" && event.skill?.name) {
      const display = event.skill.name;
      const key = skillNameKey(display);
      // 保留首次发现的展示名与元信息，避免被后续大小写不同的同名覆盖。
      if (!discoveredByKey.has(key)) {
        discoveredByKey.set(key, display);
        discoveredByDisplay.set(key, {
          ...event.skill,
          name: display,
        });
      }
    }
    if (event.event === "tool_observed" && event.tool) {
      const fragments = [event.tool];
      if (event.toolInputText) fragments.push(String(event.toolInputText));
      if (event.toolName) fragments.push(String(event.toolName));
      toolObservedTexts.push(fragments.join(" "));
    }
    if (event.event === "skill_called") {
      const rawName = typeof event.skill === "string" ? event.skill : event.skill?.name;
      if (!rawName) continue;
      const key = skillNameKey(rawName);
      if (!key) continue;
      // 归一化到 discovered 里存在的展示名；否则使用去掉前缀的原始名。
      const name = canonicalSkillName(rawName, discoveredByKey);
      const discovered = discoveredByDisplay.get(key) || {};
      const current = {
        name,
        description: discovered.description || (typeof event.skill === "object" ? event.skill?.description : "") || "",
        source: discovered.source || (typeof event.skill === "object" ? event.skill?.source : "") || "",
        evidence: event.evidence || "self_reported",
        firstUsedAt: event.time || "",
        reason: event.reason || "",
      };
      if (!calledByKey.has(key)) {
        calledByKey.set(key, current);
        continue;
      }

      const existing = calledByKey.get(key);
      // 同一证据等级只保留首次记录，避免 hook 与模型自报重复堆积。
      if (current.evidence === existing.evidence) continue;
      if (evidenceRank(current.evidence) > evidenceRank(existing.evidence)) {
        existing.evidence = current.evidence;
        existing.reason = current.reason || existing.reason;
        existing.description = existing.description || current.description;
        existing.source = existing.source || current.source;
      }
    }
  }

  const discoveredSkills = [...discoveredByDisplay.values()].sort(compareSkills);
  const calledSkills = [...calledByKey.values()].sort(compareSkills);

  // 标记可疑自报：只有 self_reported/log_inferred 证据，没有宿主事件佐证。
  for (const skill of calledSkills) {
    skill.corroborated = evidenceRank(skill.evidence) >= evidenceRank("context_observed");
  }

  const calledNames = new Set(calledSkills.map((skill) => skillNameKey(skill.name)));
  const notCalledSkills = discoveredSkills.filter((skill) => !calledNames.has(skillNameKey(skill.name)));
  const possiblyMissedSkills = detectPossiblyMissedSkills({
    discoveredSkills,
    calledSkills,
    notes,
    taskContext: taskContextParts.join("\n"),
    toolObservedText: toolObservedTexts.join("\n"),
  });

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
    hasTaskContext: taskContextParts.length > 0,
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
  // 极度通用的过程动词（没有判别力）
  "use", "using", "used", "uses", "make", "making", "makes", "made", "work", "working", "works",
  "worked", "get", "gets", "getting", "got", "set", "sets", "setting", "let", "lets", "need",
  "needs", "needed", "want", "wants", "wanted", "ask", "asking", "asks", "asked", "help", "helping",
  "helps", "helped", "require", "requires", "required", "requiring", "support", "supports",
  "supported", "supporting", "provide", "provides", "provided", "providing", "include", "includes",
  "included", "including", "handle", "handles", "handled", "handling", "manage", "manages",
  "managed", "managing", "control", "controls", "controlled", "controlling", "expose", "exposes",
  "exposed", "exposing", "load", "loads", "loading", "loaded", "record", "recording", "recorded",
  "call", "calls", "calling", "called", "invoke", "invokes", "invoking", "invoked",
  // 极度通用的填充名词（没有判别力）
  "task", "tasks", "user", "users", "skill", "skills", "one", "two", "three", "first", "second",
  "third", "per", "form", "file", "files", "local", "output", "docs", "doc", "spec", "feature",
  "features", "comment", "comments", "feedback", "trigger", "triggers", "dev", "behavior",
  "functionality", "when", "while",
  // 中文虚词（由 Intl.Segmenter 分出的单字/双字虚词）
  "并", "的", "了", "在", "是", "我", "你", "他", "她", "它", "们", "这", "那", "和", "与", "或",
  "也", "都", "就", "还", "又", "把", "被", "给", "向", "从", "到", "对", "于", "以", "为", "而",
  "则", "若", "如", "且", "但", "只", "才", "会", "能", "可", "要", "需", "应", "该", "一", "个",
  "张", "条", "项", "次",
]);

// 轻量同义词映射：把任务上下文里的常见词归并到 skill 描述常用的规范词，
// 让"界面"能命中"ui"、"前端"能命中"frontend" 等。
const SYNONYM_GROUPS = [
  ["ui", "界面", "interface", "gui"],
  ["frontend", "前端", "front-end", "front end"],
  ["backend", "后端", "back-end", "back end"],
  ["review", "审查", "复核", "reviewing"],
  ["test", "测试", "testing"],
  ["design", "设计"],
  ["report", "报告", "审计"],
  ["audit", "审计", "审查"],
  ["image", "图片", "图像"],
  ["prototype", "原型", "wireframe", "mockup"],
  ["css", "样式"],
  ["typescript", "ts"],
  ["javascript", "js"],
  ["python", "py"],
  ["refactor", "重构"],
  ["bug", "缺陷", "错误"],
  ["optimize", "优化", "performance", "性能"],
  ["onboard", "onboarding", "入职", "上手"],
  ["dashboard", "仪表盘", "看板"],
  ["landing", "落地页", "首页"],
];

const SYNONYM_TO_CANONICAL = new Map();
for (const group of SYNONYM_GROUPS) {
  const canonical = group[0];
  for (const word of group) {
    const key = word.toLowerCase();
    if (!SYNONYM_TO_CANONICAL.has(key)) SYNONYM_TO_CANONICAL.set(key, canonical);
  }
}

function detectPossiblyMissedSkills({ discoveredSkills, calledSkills, notes, taskContext = "", toolObservedText = "" }) {
  const contextText = buildTaskContextText(calledSkills, notes, taskContext, toolObservedText);
  if (!contextText.trim()) return [];
  const contextKeywords = new Set(extractKeywords(contextText));

  const total = discoveredSkills.length;
  // 自适应：skill 数量越多，DF 上限越宽松；同时基础阈值随规模线性缩放。
  const maxDocumentFrequency = Math.max(2, Math.ceil(total * 0.3));
  const scale = total > 10 ? Math.log10(total) : 1;
  const minMissScore = MIN_MISS_SCORE * scale;
  const highMissScore = HIGH_MISS_SCORE * scale;

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

  const calledKeys = new Set(calledSkills.map((skill) => skillNameKey(skill.name)));
  const candidates = [];
  for (const skill of discoveredSkills) {
    if (calledKeys.has(skillNameKey(skill.name))) continue;
    const keywords = [...new Set(extractKeywords(`${skill.name} ${skill.description}`))].filter(isDiscriminative);
    if (keywords.length < 1) continue;
    const matched = keywords.filter((keyword) => contextKeywords.has(keyword));
    // 至少命中 2 个判别性关键词，或命中 1 个且该关键词 DF=1（独占词）时才标记，
    // 避免单个泛词误报，同时保留中文单一关键词命中的信号。
    const uniqueHit = matched.length === 1 && documentFrequency.get(matched[0]) === 1;
    if (matched.length < 2 && !uniqueHit) continue;

    const score = matched.reduce((sum, keyword) => sum + 1 / (documentFrequency.get(keyword) || 1), 0);
    if (score < minMissScore) continue;

    candidates.push({
      name: skill.name,
      reason: `任务上下文命中描述关键词：${matched.slice(0, 5).join("、")}`,
      confidence: score >= highMissScore && matched.length >= 3 ? "较高" : "中等",
      _score: score,
    });
  }

  return candidates
    .sort((left, right) => right._score - left._score)
    .map(({ _score, ...rest }) => rest);
}

const MIN_MISS_SCORE = 0.8;
const HIGH_MISS_SCORE = 2;

function buildTaskContextText(calledSkills, notes, taskContext = "", toolObservedText = "") {
  const parts = [];
  // 用户原始任务上下文权重最高，放在最前。
  if (taskContext) parts.push(taskContext);
  for (const skill of calledSkills) {
    parts.push(skill.name, skill.description || "", skill.reason || "");
  }
  parts.push(...notes);
  // tool_observed 探针事件提供"模型在做什么"的弱信号，作为补充上下文。
  if (toolObservedText) parts.push(toolObservedText);
  return parts.join(" ").toLowerCase();
}

// 关键词抽取：英文按非字母数字切分；中文用 Intl.Segmenter 做词级分词，
// 回退到 CJK 字符的 bigram，避免整段中文被当作单个 token。
let segmenter = null;
function getSegmenter() {
  if (segmenter !== null) return segmenter;
  try {
    segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
  } catch {
    segmenter = false;
  }
  return segmenter;
}

function extractKeywords(text) {
  const source = String(text || "").toLowerCase();
  if (!source) return [];

  const tokens = new Set();

  // 英文/数字 token：按非字母数字分隔。
  // 先做同义词归并，再按归并后的 canonical 词长度过滤，
  // 让 ui/js/ts/css 等 2 字母缩写经过同义词归并后保留下来。
  for (const token of source.split(/[^a-z0-9]+/i)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (STOPWORDS.has(trimmed)) continue;
    const canonical = canonicalizeWord(trimmed);
    if (canonical.length >= 2 && !STOPWORDS.has(canonical)) {
      tokens.add(canonical);
    }
  }

  // 中文分词。
  const segmenterInstance = getSegmenter();
  if (segmenterInstance) {
    for (const segment of segmenterInstance.segment(source)) {
      const word = segment.segment.trim();
      if (!word) continue;
      if (word.length < 2) continue;
      // 只对包含 CJK 字符的 segment 走中文路径；纯英文已被上面处理。
      if (!/[\u4e00-\u9fff]/.test(word)) continue;
      if (STOPWORDS.has(word)) continue;
      tokens.add(canonicalizeWord(word));
    }
  } else {
    // 回退：CJK 字符 bigram。
    const cjkChars = Array.from(source).filter((char) => /[\u4e00-\u9fff]/.test(char));
    for (let index = 0; index < cjkChars.length - 1; index += 1) {
      const bigram = cjkChars[index] + cjkChars[index + 1];
      if (!STOPWORDS.has(bigram)) tokens.add(canonicalizeWord(bigram));
    }
  }

  return [...tokens];
}

// 把同义词归并到规范形式，让"界面"和"ui"命中同一个关键词。
function canonicalizeWord(word) {
  const lower = word.toLowerCase();
  return SYNONYM_TO_CANONICAL.get(lower) || lower;
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