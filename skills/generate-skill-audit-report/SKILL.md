---
name: generate-skill-audit-report
description: Use when 需要根据 Skill Ledger 的运行结果生成中文 Markdown 的 skills 审计报告，或在审计任务结束时、用户想知道哪些 skills 被调用或未被调用时、调优 skill 描述与触发条件时，以及从 Codex、OpenCode、Gemini、Kimi、Claude Code、Cursor 等编程代理导出证据时使用。
---

# 生成 Skill Ledger 报告

## 概述

结束当前的 skill 审计运行，并生成一份中文 Markdown 报告。报告应列出已发现的 skills、已调用的 skills、未调用的 skills，以及每次调用对应的证据等级。

## 工作流程

1. 找到插件根目录：也就是包含 `scripts/skill-ledger.mjs` 的目录。
2. 从之前 `using-skill-audit` 的启动命令输出，或 bootstrap 消息中，确定本次运行的 `runId`。
3. 将这次运行标记为结束，并自动生成默认报告：

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" finish --run-id "<runId>"
```

默认报告会写入 `<workspace>/.skill-ledger/reports/<runId>.md`，并省略冗长的完整未调用清单。

如果要重新生成报告，或指定输出路径：

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" report --run-id "<runId>" --output "<workspace>/.skill-ledger/reports/<name>.md"
```

只有在需要逐项盘点所有未调用 Skills 时才加 `--full`。

## 报告规则

- 报告必须是中文 Markdown。
- 保留证据标签：`native_observed`、`self_reported`、`log_inferred`。
- 如果没有发现任何 skills，需要说明原因是宿主环境没有暴露 skill roots，或者这些 roots 没有在审计启动命令中传入。
- 不要把 `self_reported` 的调用当成绝对准确的事实，应明确写出它的证据等级。

生成报告后，告诉用户报告文件的绝对路径。
