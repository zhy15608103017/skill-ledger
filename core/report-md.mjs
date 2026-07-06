const EVIDENCE_LABELS = {
  native_observed: "原生事件观测",
  self_reported: "模型自报告",
  log_inferred: "日志推断",
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
    `- 开始时间：${value(summary.startedAt)}`,
    `- 结束时间：${value(summary.finishedAt)}`,
    `- 发现 Skills：${summary.discoveredSkills?.length || 0}`,
    `- 已调用 Skills：${summary.calledSkills?.length || 0}`,
    `- 未调用 Skills：${summary.notCalledSkills?.length || 0}`,
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
    "- 原生事件观测：宿主插件或生命周期事件直接记录到调用。",
    "- 模型自报告：模型按照审计指令主动记录调用。",
    "- 日志推断：从对话、日志或 transcript 中推断调用。",
  ];

  if (summary.possiblyMissedSkills?.length) {
    lines.push("", "## 可能漏用的 Skills", "", ...possibleMissTable(summary.possiblyMissedSkills));
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
    ...skills.map((skill) =>
      [
        skill.name,
        skill.source,
        EVIDENCE_LABELS[skill.evidence] || skill.evidence,
        skill.firstUsedAt,
        skill.reason,
      ]
        .map(cell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    ),
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

function cell(input) {
  return value(String(input || "")).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
