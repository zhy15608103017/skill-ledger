# Skill Ledger 安装指南

## 发布到 npm

发布前确认 `package.json` 里的 `name`、`repository`、`homepage` 已经改成真实地址，然后运行：

```powershell
npm login --registry=https://registry.npmjs.org/
npm test
npm pack --dry-run
npm publish --access public --registry=https://registry.npmjs.org/
```

如果 `skill-ledger` 这个包名不可用，可以改成 scoped 包：

```powershell
npm pkg set name="@你的scope/skill-ledger"
npm publish --access public --registry=https://registry.npmjs.org/
npx @你的scope/skill-ledger
```

如果包名就是 `skill-ledger`，发布后直接运行：

```powershell
npx skill-ledger
```

命令会显示当前支持快捷安装的 AI 编程工具列表，选择对应工具后自动执行安装流程。

## Codex 快速安装

在插件目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

发布到 npm 后，可以直接运行：

```powershell
npx skill-ledger
```

选择 `1. Codex` 后会自动执行 Codex 安装。

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

在插件目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-opencode.ps1
```

发布到 npm 后，可以直接运行：

```powershell
npx skill-ledger
```

选择 `2. OpenCode` 后会自动执行 OpenCode 安装。

本地 PowerShell 脚本会把当前插件目录加入 `~/.config/opencode/opencode.json` 的 `plugin` 数组；`npx` 快捷安装会写入 npm 包名，例如 `skill-ledger` 或 `@你的scope/skill-ledger`。修改前都会创建 `.bak-时间戳` 备份。

也可以手动在 `opencode.json` 中加入本地插件路径：

```json
{
  "plugin": [
    "D:/github/skill-ledger"
  ]
}
```

重启 OpenCode 后，插件会自动注册 skills 并注入审计提示。

## 使用

安装后，在新会话里请求开启 skill ledger，或直接使用 `using-skill-audit`。报告会写到工作区的 `.skill-ledger/reports/`，并且默认是中文 Markdown。
