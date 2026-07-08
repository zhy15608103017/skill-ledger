# Skill Ledger 安装指南

## Platform Support Matrix

Skill Ledger ships repository artifacts for Claude Code, Antigravity, Codex App,
Codex CLI, Cursor, Factory Droid, GitHub Copilot CLI, Kimi Code, OpenCode, Pi,
and Gemini.

- Codex and OpenCode have local PowerShell quick installers in `scripts/`.
- Claude Code, Cursor, and GitHub Copilot CLI use the bundled `hooks/`
  session-start bootstrap.
- Gemini uses `gemini-extension.json` plus `GEMINI.md`.
- Kimi Code uses `.kimi-plugin/plugin.json`.
- Pi uses `.pi/extensions/skill-ledger.ts`.
- Antigravity and Factory Droid use host-owned plugin install routes and should
  be verified in a fresh live host session before being treated as fully
  validated.

## 安装命令速查

下面的 `<owner>` 需要替换为发布 Skill Ledger 的 GitHub 组织或用户名。

每个平台都有一个 PowerShell 入口脚本，命令格式和 Codex 保持一致：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-opencode.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-claude.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-cursor.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-copilot.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-kimi.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-gemini.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-pi.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-antigravity.ps1
powershell -ExecutionPolicy Bypass -File scripts/install-droid.ps1
```

### Codex App / Codex CLI

本地开发安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

只准备 marketplace，不自动执行 `codex plugin add`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1 -SkipCodexAdd
```

手动安装命令：

```bash
codex plugin add skill-ledger@<marketplace-name>
```

### OpenCode

本地开发安装：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-opencode.ps1
```

通过 `opencode.json` 使用 Git 仓库：

```json
{
  "plugin": ["skill-ledger@git+https://github.com/<owner>/skill-ledger.git"]
}
```

发布到 npm 后，也可以写包名：

```json
{
  "plugin": ["skill-ledger"]
}
```

### Claude Code

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-claude.ps1
```

通过 marketplace 安装：

```text
/plugin marketplace add <owner>/skill-ledger-marketplace
/plugin install skill-ledger@skill-ledger-marketplace
```

本地开发时，将 Claude Code 指向当前仓库作为 plugin directory，确保它能读取 `.claude-plugin/plugin.json`、`hooks/hooks.json` 和 `skills/`。

### Cursor

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-cursor.ps1
```

通过 Cursor Agent chat 安装：

```text
/add-plugin skill-ledger
```

本地开发时，将 Cursor 指向当前仓库作为插件目录，确保它能读取 `.cursor-plugin/plugin.json`、`hooks/hooks-cursor.json` 和 `skills/`。

### GitHub Copilot CLI

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-copilot.ps1
```

通过 Copilot marketplace 安装：

```bash
copilot plugin marketplace add <owner>/skill-ledger-marketplace
copilot plugin install skill-ledger@skill-ledger-marketplace
```

### Kimi Code

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-kimi.ps1
```

通过 Kimi Code 插件管理器安装：

```text
/plugins install https://github.com/<owner>/skill-ledger
```

安装后新开会话，让 Kimi Code 重新加载 `.kimi-plugin/plugin.json`。

### Gemini

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-gemini.ps1
```

通过 Gemini extension 安装：

```bash
gemini extensions install https://github.com/<owner>/skill-ledger
```

Gemini 会通过 `gemini-extension.json` 加载仓库内的 `GEMINI.md`。

### Pi

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-pi.ps1
```

通过 Pi package 安装：

```bash
pi install git:github.com/<owner>/skill-ledger
```

本地开发时加载当前 checkout：

```bash
pi -e /path/to/skill-ledger
```

### Antigravity

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-antigravity.ps1
```

通过 Antigravity 插件安装：

```bash
agy plugin install https://github.com/<owner>/skill-ledger
```

这是按 Superpowers 兼容模式提供的 install-route 支持。发布前建议用全新 Antigravity 会话验证启动注入和 skill 加载。

### Factory Droid

PowerShell 入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-droid.ps1
```

通过 Droid marketplace 安装：

```bash
droid plugin marketplace add https://github.com/<owner>/skill-ledger
droid plugin install skill-ledger@skill-ledger
```

这是按 Superpowers 兼容模式提供的 install-route 支持。发布前建议用全新 Droid 会话验证启动注入和 skill 加载。

### npm 快捷菜单

发布到 npm 后，可以通过交互菜单查看所有支持平台和命令提示：

```powershell
npx skill-ledger
```

目前菜单中 Codex 和 OpenCode 会执行自动安装；其它平台会打印对应宿主的安装命令，避免修改用户自己的全局配置文件。

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
