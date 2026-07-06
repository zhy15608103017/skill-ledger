import path from "node:path";

export const AUDIT_BOOTSTRAP_MARKER = "skill-ledger bootstrap";

export function buildBootstrapText({ runId, pluginRoot, logFile, harness }) {
  const script = path.join(pluginRoot, "scripts", "skill-ledger.mjs");
  const callCommand = `node "${script}" call --run-id ${runId} --skill <skill-name> --evidence self_reported --reason "<为什么调用这个 skill>"`;
  const reportCommand = `node "${script}" report --run-id ${runId}`;

  return `<SKILL_AUDIT>
${AUDIT_BOOTSTRAP_MARKER}

Skills 调用审计已启动。

- 运行 ID：${runId}
- 宿主工具：${harness || "unknown"}
- 日志文件：${logFile}

执行要求：

1. 每次准备使用任何 skill 之前，先记录一次调用事件。
2. 记录命令格式：

\`\`\`bash
${callCommand}
\`\`\`

3. reason 必须用中文说明为什么本次任务需要这个 skill。
4. 如果宿主工具能原生观测 skill 调用，优先使用 native_observed；否则使用 self_reported。
5. 收尾时生成报告：

\`\`\`bash
${reportCommand}
\`\`\`

报告必须输出为中文 Markdown，并保留已调用、未调用和证据等级说明。
</SKILL_AUDIT>`;
}
