# Skill Ledger 安装指南

Skill Ledger 只把 Codex、Claude Code 和 OpenCode 标记为一级支持。一级支持表示仓库内有针对启动、任务上下文、证据归属、并发会话、隐私默认值和结束清理的自动化集成测试。

## Codex 快速安装

Codex quick installer is currently Windows only because it uses the bundled PowerShell script.

```powershell
git clone https://github.com/zhy15608103017/skill-ledger.git "$HOME\plugins\skill-ledger"
cd "$HOME\plugins\skill-ledger"
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

安装脚本会创建本地插件链接、更新默认 personal marketplace，并执行：

```text
codex plugin add skill-ledger@<personal-marketplace-name>
```

更新本地开发版本后需要重新安装插件并开启新线程，Codex 才会重新读取 skill 内容。

Codex 当前没有由本插件直接观测的原生 Skill 调用事件，因此 Codex 调用证据保持为 `self_reported`；插件不会把它包装成 `native_observed`。

## Claude Code 快速安装

```powershell
git clone https://github.com/zhy15608103017/skill-ledger.git
cd skill-ledger
powershell -ExecutionPolicy Bypass -File scripts/install-claude.ps1
```

等价的宿主命令是：

```powershell
claude plugin marketplace add "<repo>\.claude-plugin\marketplace.json"
claude plugin install skill-ledger@skill-ledger-dev --scope user
```

Claude Code 一级支持包括：

- `SessionStart`：建立带 session ID 的审计运行并注入启动 skill。
- `UserPromptSubmit`：以隐私模式记录脱敏任务上下文。
- `PostToolUse`：直接观测原生 Skill 工具调用。
- `SessionEnd`：幂等结束运行、生成报告并清除 active pointer。

## OpenCode 快速安装

从 npm 安装：

```json
{
  "plugin": ["skill-ledger"]
}
```

从 Git 安装：

```json
{
  "plugin": ["skill-ledger@git+https://github.com/zhy15608103017/skill-ledger.git"]
}
```

或运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-opencode.ps1
```

OpenCode 一级支持包括首条用户消息注入、原始任务上下文、原生 `skill` 工具事件、多会话隔离，以及 session 删除/结束时自动生成报告。

## npm CLI

```powershell
npm install -g skill-ledger
skill-ledger start --harness codex --cwd . --task-context "脱敏任务摘要"
```

交互安装器：

```powershell
npx skill-ledger
```

非交互入口：

```powershell
npx skill-ledger install-codex
npx skill-ledger install-claude
npx skill-ledger install-opencode
```

## 隐私设置

```powershell
$env:SKILL_LEDGER_PRIVACY = "balanced"   # 默认
$env:SKILL_LEDGER_RETENTION_DAYS = "30"  # 0 表示不自动删除
```

- `strict`：不保存任务或工具输入正文。
- `balanced`：保存脱敏任务摘要，只保存工具输入键名和 payload hash。
- `diagnostic`：额外保存脱敏、截断后的工具输入文本。

## 实验性兼容入口

以下入口保留用于宿主实测，但还不是一级支持：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-cursor.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-copilot.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-kimi.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-gemini.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-pi.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-antigravity.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-droid.ps1
```

对应命令：

```text
/add-plugin skill-ledger
copilot plugin marketplace add zhy15608103017/skill-ledger
copilot plugin install skill-ledger@skill-ledger
/plugins install https://github.com/zhy15608103017/skill-ledger
gemini extensions install https://github.com/zhy15608103017/skill-ledger
pi install git:github.com/zhy15608103017/skill-ledger
agy plugin install https://github.com/zhy15608103017/skill-ledger
droid plugin marketplace add https://github.com/zhy15608103017/skill-ledger
droid plugin install skill-ledger@skill-ledger
```

这些宿主必须经过新的真实会话验证后才能升级为一级支持。
