import { formatLocalTimestamp } from "./time-format.mjs";

const EVIDENCE_LABELS = {
  native_observed: "原生事件观测（高置信度）",
  context_observed: "上下文观测（较高置信度，确认 Skill 内容进入模型上下文）",
  self_reported: "模型自报告（中等置信度，未由宿主事件确认）",
  log_inferred: "日志推断（低到中等置信度）",
};

export function renderChineseMarkdownReport(summary) {
  const lines = [
    "# Skills 调用审计报告",
    "",
    "## 摘要",
    "",
    `- 运行 ID：${value(summary.runId)}`,
    `- 宿主工具：${value(summary.harness)}`,
    `- 工作目录：${value(summary.cwd)}`,
    `- 开始时间：${timeValue(summary.startedAt)}`,
    `- 结束时间：${timeValue(summary.finishedAt)}`,
    `- 发现 Skills：${summary.discoveredSkills?.length || 0}`,
    `- 已调用 Skills：${summary.calledSkills?.length || 0}`,
    `- 未调用 Skills：${summary.notCalledSkills?.length || 0}`,
    summary.hasTaskContext ? "- 任务上下文：已记录（漏用推断参考用户原始任务文本）" : "- 任务上下文：未记录（漏用推断仅基于已调用 skill 与备注）",
  ];

  const uncorroboratedCount = (summary.calledSkills || []).filter(isUncorroboratedSelfReport).length;
  if (uncorroboratedCount > 0) {
    lines.push(`- 可疑自报告 Skills：${uncorroboratedCount} 个（仅模型自报，缺少宿主事件佐证）`);
  }

  lines.push(
    "",
    "## 已调用 Skills",
    "",
    ...skillCallTable(summary.calledSkills || []),
    "",
    "## 未调用 Skills",
    "",
    ...skillTable(summary.notCalledSkills || []),
    "",
    "## 证据等级说明",
    "",
    "- 原生事件观测：宿主插件或生命周期事件直接记录到调用，置信度最高。",
    "- 上下文观测：宿主 hook 确认 Skill 内容进入模型上下文，能证明加载但不等同于原生工具调用。",
    "- 模型自报告：模型按照审计指令主动记录调用，可信但没有宿主事件佐证；标注“可疑自报告”的条目缺少任何宿主观测证据。",
    "- 日志推断：从对话、日志或 transcript 中推断调用，适合补充线索而非单独定论。",
  );

  if (summary.possiblyMissedSkills?.length) {
    lines.push(
      "",
      "## 可能漏用的 Skills",
      "",
      "> 该列表基于 Skill 描述关键词与任务上下文的启发式匹配，仅供参考，不代表确证漏用。",
      "",
      ...possibleMissTable(summary.possiblyMissedSkills),
    );
  }

  if (summary.notes?.length) {
    lines.push("", "## 备注", "");
    for (const note of summary.notes) lines.push(`- ${note}`);
  }

  return `${lines.join("\n")}\n`;
}

function skillCallTable(skills) {
  if (!skills.length) return ["本次没有记录到已调用的 Skill。"];
  return [
    "| Skill | 来源 | 证据 | 首次调用时间 | 原因 |",
    "|---|---|---|---|---|",
    ...skills.map((skill) => {
      let evidence = EVIDENCE_LABELS[skill.evidence] || skill.evidence;
      if (isUncorroboratedSelfReport(skill)) evidence += "（可疑自报告）";
      return [
        skill.name,
        skill.source,
        evidence,
        timeValue(skill.firstUsedAt),
        skill.reason,
      ]
        .map(cell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |");
    }),
  ];
}

function skillTable(skills) {
  if (!skills.length) return ["本次发现的 Skills 都已有调用记录。"];
  return [
    "| Skill | 来源 | 描述 |",
    "|---|---|---|",
    ...skills.map((skill) => [skill.name, skill.source, skill.description].map(cell).join(" | ").replace(/^/, "| ").replace(/$/, " |")),
  ];
}

function possibleMissTable(skills) {
  return [
    "| Skill | 可能适用原因 | 置信度 |",
    "|---|---|---|",
    ...skills.map((skill) => [skill.name, skill.reason, skill.confidence].map(cell).join(" | ").replace(/^/, "| ").replace(/$/, " |")),
  ];
}

function value(input) {
  return input || "未记录";
}

function timeValue(input) {
  return input ? formatLocalTimestamp(input) : value(input);
}

function cell(input) {
  return value(String(input || "")).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// 仅当证据为 self_reported 且 corroborated 显式为 false 时才标记可疑自报告，
// 避免对 native_observed/context_observed/log_inferred 或缺少 corroborated 字段的旧 summary 误标。
function isUncorroboratedSelfReport(skill) {
  return skill?.evidence === "self_reported" && skill.corroborated === false;
}
