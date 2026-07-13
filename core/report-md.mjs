import { formatLocalTimestamp } from "./time-format.mjs";

const EVIDENCE_LABELS = {
  native_observed: "native_observed — 原生事件观测（高置信度）",
  context_observed: "context_observed — 上下文观测（较高置信度）",
  self_reported: "self_reported — 模型自报告（中等置信度）",
  log_inferred: "log_inferred — 日志推断（低到中等置信度）",
};

export function renderChineseMarkdownReport(summary, { includeInventory = false, maxPossiblyMissed = 10 } = {}) {
  const sourceRows = sourceCoverage(summary.discoveredSkills || [], summary.calledSkills || []);
  const missed = (summary.possiblyMissedSkills || []).slice(0, maxPossiblyMissed);
  const lines = [
    "# Skills 调用审计报告",
    "",
    "## 摘要",
    "",
    `- 运行 ID：${value(summary.runId)}`,
    `- 宿主工具：${value(summary.harness)}`,
    `- 会话 ID：${value(summary.sessionId)}`,
    `- 工作目录：${value(summary.cwd)}`,
    `- 开始时间：${timeValue(summary.startedAt)}`,
    `- 结束时间：${timeValue(summary.finishedAt)}`,
    `- 发现 Skills：${summary.discoveredSkills?.length || 0}`,
    `- 已调用 Skills：${summary.calledSkills?.length || 0}`,
    `- 未调用 Skills：${summary.notCalledSkills?.length || 0}`,
    `- 隐私模式：${value(summary.privacyMode)}`,
    `- 自动保留期：${summary.retentionDays > 0 ? `${summary.retentionDays} 天` : "未启用自动清理"}`,
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
    "## 来源覆盖",
    "",
    ...sourceCoverageTable(sourceRows),
    "",
    "## 审计结论与行动建议",
    "",
    ...actionItems(summary),
  );

  if (missed.length) {
    lines.push(
      "",
      "## 可能漏用的 Skills",
      "",
      "> 该列表基于 Skill 描述关键词与任务上下文的启发式匹配，仅供参考，不代表确证漏用。",
      "",
      ...possibleMissTable(missed),
    );
  }

  if (includeInventory) {
    lines.push("", "## 完整未调用 Skills 清单", "", ...skillTable(summary.notCalledSkills || []));
  } else if (summary.notCalledSkills?.length) {
    lines.push(
      "",
      "## 完整清单",
      "",
      `默认报告省略了 ${summary.notCalledSkills.length} 个未调用 Skills 的逐项列表，以减少噪声。使用 \`report --full\` 或 \`finish --full\` 生成完整清单。`,
    );
  }

  lines.push(
    "",
    "## 证据等级说明",
    "",
    "- `native_observed`：宿主插件或生命周期事件直接记录到调用，置信度最高。",
    "- `context_observed`：宿主确认 Skill 内容进入模型上下文，能证明加载但不等同于原生工具调用。",
    "- `self_reported`：模型按照审计指令主动记录调用，可信但没有宿主事件佐证。",
    "- `log_inferred`：从对话、日志或 transcript 中推断调用，只适合作为补充线索。",
  );

  if (summary.notes?.length) {
    lines.push("", "## 备注", "");
    for (const note of summary.notes) lines.push(`- ${note}`);
  }

  return `${lines.join("\n")}\n`;
}

function sourceCoverage(discovered, called) {
  const rows = new Map();
  for (const skill of discovered) {
    const source = skill.source || "未记录";
    if (!rows.has(source)) rows.set(source, { source, discovered: 0, called: 0 });
    rows.get(source).discovered += 1;
  }
  for (const skill of called) {
    const source = skill.source || "未记录";
    if (!rows.has(source)) rows.set(source, { source, discovered: 0, called: 0 });
    rows.get(source).called += 1;
  }
  return [...rows.values()].sort((left, right) => right.called - left.called || right.discovered - left.discovered || left.source.localeCompare(right.source));
}

function sourceCoverageTable(rows) {
  if (!rows.length) return ["本次没有发现 Skill 来源。"];
  return [
    "| 来源 | 发现 | 调用 | 覆盖率 |",
    "|---|---:|---:|---:|",
    ...rows.map((row) => `| ${cell(row.source)} | ${row.discovered} | ${row.called} | ${row.discovered ? `${Math.round(row.called / row.discovered * 100)}%` : "-"} |`),
  ];
}

function actionItems(summary) {
  const items = [];
  const selfReported = (summary.calledSkills || []).filter((skill) => skill.evidence === "self_reported").length;
  if (!summary.hasTaskContext) items.push("- 补充任务上下文，否则“可能漏用”检测只能依赖调用原因和工具探针。 ");
  if (selfReported) items.push(`- 有 ${selfReported} 个调用仅为 \`self_reported\`，不要把它们当作宿主已原生确认的事实。`);
  if (summary.possiblyMissedSkills?.length) items.push(`- 复核下方 ${summary.possiblyMissedSkills.length} 个可能漏用的 Skills，优先检查高置信度条目。`);
  if (!summary.possiblyMissedSkills?.length && summary.hasTaskContext) items.push("- 未发现明显漏用信号；这表示启发式匹配未命中，不等同于绝对没有漏用。 ");
  if ((summary.notCalledSkills?.length || 0) > 50) items.push("- Skill 根目录覆盖范围较大，建议按宿主或项目限制扫描 roots，以提升报告信噪比。 ");
  if (!items.length) items.push("- 本次没有发现需要人工处理的明显审计异常。 ");
  return items;
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
