# Skill Ledger 安装指南

## Codex 快速安装

在插件目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

脚本会完成三件事：

- 创建 `~/plugins/skill-ledger`，指向当前插件目录。
- 写入或更新 `~/.agents/plugins/marketplace.json`。
- 如果本机有 `codex` 命令，自动执行 `codex plugin add skill-ledger@<marketplace-name>`。

如果只想准备 marketplace，不自动执行 Codex 安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1 -SkipCodexAdd
```

之后手动运行脚本输出的 `codex plugin add ...` 命令。

## OpenCode 快速安装

在 `opencode.json` 中加入本地插件路径：

```json
{
  "plugin": ["D:/github/skill-ledger"]
}
```

重启 OpenCode 后，插件会自动注册 skills 并注入审计提示。

## 使用

安装后，在新会话里请求开启 skill ledger，或直接使用 `using-skill-audit`。报告会写到工作区的 `.skill-ledger/reports/`，并且默认是中文 Markdown。
