---
name: using-skill-audit
description: Use when 需要为当前任务启动并维护一次 skill 使用审计，或在用户想知道哪些 skills 被调用或未被调用时、调优 skills 时、比较 Codex、OpenCode、Gemini、Kimi、Claude Code、Cursor 等编程代理的 skill 触发表现时，以及在调用其他 skills 之前记录每一次 skill 调用时使用。
---

# 使用 Skill Ledger

## 概述

为当前任务启动一轮本地审计，记录已发现的 skills 以及每一次 skill 调用。最终生成的报告默认是中文 Markdown。

## 工作流程

1. 找到插件根目录：也就是包含 `scripts/skill-ledger.mjs` 的目录。
2. 在使用任何其他 skill 之前，先启动一次审计运行：

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" start --harness "<tool-name>" --cwd "<workspace>"
```

这个命令会输出一个 `runId`。在本次任务后续的所有记录中，都要持续使用这个值。

3. 在调用每一个 skill 之前，先记录这次调用：

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" call --run-id "<runId>" --skill "<skill-name>" --evidence self_reported --reason "<中文原因>"
```

只有在宿主适配器直接观察到调用时，才使用 `native_observed`。当模型是按照这个 skill 主动记录调用时，使用 `self_reported`。只有在根据对话记录或日志反推审计结果时，才使用 `log_inferred`。

4. 任务结束后，使用 `generate-skill-audit-report` skill，或者直接执行：

```bash
node "<plugin-root>/scripts/skill-ledger.mjs" finish --run-id "<runId>"
node "<plugin-root>/scripts/skill-ledger.mjs" report --run-id "<runId>"
```

## Skill Roots

如果宿主环境能够暴露 skill 目录，那么在执行 `start` 时，使用重复的 `--skills` 参数把每个目录都传进去。如果没有显式传入 roots，CLI 会扫描一些常见的本地目录，例如插件自身的 `skills/`、`.codex/skills`、`.opencode/skills`、`~/.codex/skills`、`~/.agents/skills` 和 `~/.config/opencode/skills`。

如果某个 skill root 缺失，不要因此阻塞用户的主要任务。缺失的 roots 会被跳过，报告中应说明：skill 发现结果取决于宿主环境实际提供了哪些 roots。
