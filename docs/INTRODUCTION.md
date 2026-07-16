# Skill Ledger - AI 编程助手 Skill 调用审计工具

## 一句话介绍

Skill Ledger 是一个跨编程代理（AI coding agent）的 Skill 使用审计插件。它在每次会话中自动记录哪些 skill 被发现、哪些被实际调用、调用证据有多可信，并在会话结束时生成一份中文 Markdown 审计报告。它还具备自学习机制，能从历史运行中自动发现停用词和同义词，并根据用户反馈自适应调整推断阈值。

---

## 它解决什么问题？

当你的团队使用 Claude Code、Codex、OpenCode 等 AI 编程助手时，每个助手挂载了数十个 skill（技能）。任务结束后，你无法回答这些关键问题：

- **追溯**：这次任务里，到底哪些 skill 被触发了？
- **取证**：触发的证据是什么--是宿主原生记录的，还是模型自己声称的？
- **漏用**：有没有该用但没用的 skill？
- **调优**：skill 的描述写得好不好，触发条件准不准？

Skill Ledger 就是给 skill 调用装"行车记录仪"的工具。

---

## 核心概念：证据分级模型

Skill Ledger 最重要的设计是**四级证据模型**。它从不把低置信度的证据"包装"成高置信度。

| 证据等级 | 含义 | 触发方式 | 可信度 |
|---|---|---|---|
| `native_observed` | 宿主原生事件直接观测到 skill 调用 | Claude Code 的 `PostToolUse` hook / OpenCode 的 `tool.execute.after` 事件 | 最高 |
| `context_observed` | 宿主确认 skill 内容进入了模型上下文 | `SessionStart` hook 注入时自动记录 | 较高 |
| `self_reported` | 模型按审计指令主动用 CLI 命令记录 | 模型执行 `skill-ledger call` | 中等 |
| `log_inferred` | 从日志或对话事后推断 | 手动重建审计 | 低 |

**关键原则：证据永不静默升级。** 如果一个调用只有 `self_reported`，它在报告里永远不会被标成 `native_observed`。报告还会显式标注"可疑自报告"--只有模型自报、没有宿主事件佐证的调用。

---

## 工作流程（四步生命周期）

```
会话开始                 调用 skill                    会话结束
   │                        │                           │
   ▼                        ▼                           ▼
┌──────────┐         ┌─────────────┐            ┌──────────────┐
│ 1. 启动   │         │ 2. 记录调用  │            │ 3. 生成报告   │
│ 扫描所有  │ ──────► │ 每次调用都   │ ─────────► │ 4. 清理运行   │
│ skill 目录│         │ 记录证据等级 │            │    状态      │
└──────────┘         └─────────────┘            └──────────────┘
                                                        │
                                                        ▼
                                                 ┌─────────────┐
                                                 │ 加载 learned │
                                                 │ model（如有）│
                                                 └─────────────┘
```

### 第一步：会话启动 - 发现与注入

当 AI 编程助手开始一个新会话时，Skill Ledger 做两件事：

**发现 skills**：递归扫描多个目录（插件自带 `skills/`、项目 `.codex/skills/`、用户全局 `~/.agents/skills/` 等），解析每个 `SKILL.md` 的 frontmatter（name + description），或从 `plugin.json` / `package.json` 的 skills 清单中读取。结果写入审计日志的 `skill_discovered` 事件。

**注入审计指令**：把 `using-skill-audit` 这个 skill 的全文指令注入到会话的第一条用户消息前面。这段指令告诉模型：

- 你有一个活跃的审计运行，runId 是 xxx
- 调用任何其他 skill 之前，先用 CLI 命令记录
- 任务结束时，用 CLI 命令关闭运行并生成报告

不同宿主的注入方式：

| 宿主 | 注入机制 |
|---|---|
| Claude Code | `SessionStart` hook -> `hookSpecificOutput.additionalContext` |
| OpenCode | `experimental.chat.messages.transform` 插件钩子 -> 在首条用户消息前插入 text part |
| Codex | 通过 skill 内容自身引导模型执行 CLI 命令 |

### 第二步：记录 skill 调用 - 证据分级

每次 skill 被调用时，记录一条 `skill_called` 事件，附带证据等级（见上方表格）。

- **Claude Code**：`PostToolUse` hook 读取工具调用 payload，用 `isSkillTool()` 判定工具名，再用 `normalizeSkillName()` 提取 skill 名 -> `native_observed`
- **OpenCode**：`tool.execute.after` 事件直接拿到 skill 工具的输入参数 -> `native_observed`
- **所有宿主**：模型按审计指令主动执行 `skill-ledger call` CLI 命令 -> `self_reported`

### 第三步：会话结束 - 生成报告

会话结束时（Claude Code 的 `SessionEnd` hook / OpenCode 的 `session.deleted` 事件 / 模型主动执行 `finish` 命令），Skill Ledger：

1. 读取完整审计日志（JSONL 格式，每行一个事件）
2. **加载学习模型**（如 `skill-ledger/learned-model.json` 存在）：合并 learned 停用词、同义词和阈值到推断逻辑
3. 聚合所有事件：去重 discovered、合并 called（同证据等级只保留首次、不同等级保留更高）
4. 运行漏用推断算法（使用合并后的有效停用词/同义词/阈值）
5. 生成中文 Markdown 报告
6. 写入 `.skill-ledger/reports/<runId>.md`
7. 清除 active run 状态

### 第四步：漏用推断 - 启发式匹配

报告里有一个"可能漏用的 Skills"表格，基于任务上下文关键词与未调用 skill 描述关键词的匹配推断：

```
任务上下文文本 + 已调用 skill 的 reason + 备注
                    │
                    ▼
              提取关键词
      ┌──────────┴──────────┐
      ▼                     ▼
  英文分词               中文分词
  (非字母数字切分)        (Intl.Segmenter 词级分词
                          或 CJK bigram 回退)
      │                     │
      └──────────┬──────────┘
                 ▼
           同义词归并
   (硬编码 + learned 同义词合并)
   (ui = 界面, frontend = 前端,
    review = 审查, test = 测试 ...)
                 │
                 ▼
           去停用词
   (硬编码 + learned 停用词合并)
   (the / a / use / task / default /
    配置 / 创建 / 生成 / 修复 ...)
                 │
                 ▼
      对每个未调用的 skill:
      1. 提取其 name + description 的关键词
      2. 过滤非判别性词（DF > maxDfRatio 的 skill 都有的词）
      3. 与任务上下文关键词求交集
      4. 命中 ≥2 个判别性词，或命中 1 个独占词（DF=1）
      5. TF-IDF 评分：sum(1/DF)，超过 minMissScore 才报
         评分 ≥ highMissScore 且命中 ≥3 -> "较高"置信度
```

> **注意**：`maxDfRatio`、`minMissScore`、`highMissScore` 在有 learned model 时会被学习到的阈值覆盖。无 learned model 时使用硬编码默认值（0.3 / 0.8 / 2.0）。

报告明确标注"仅供参考，不代表确证漏用"。它的价值是给你一个信号：这个 skill 的描述里出现了你任务里提到的词，但你没用它，值得人工看一眼。

---

## 学习机制（自适应优化）

Skill Ledger 具备四种学习能力，能从历史运行和用户反馈中持续优化漏用推断的准确度。

### 学习数据存储

学习数据存储在 `skill-ledger/learned-model.json`（项目根目录下），可被 git 跟踪，团队共享。

```json
{
  "version": 1,
  "updatedAt": "2026-07-14T10:00:00.000Z",
  "stats": {
    "runsAnalyzed": 19,
    "skillsSeen": 76
  },
  "learnedStopwords": ["use", "when"],
  "learnedSynonyms": [],
  "feedback": {
    "confirmed": [],
    "rejected": [
      { "skillName": "project-artifact", "reason": "误报", "time": "..." }
    ],
    "lastVerdict": { "project-artifact": "rejected" }
  },
  "thresholds": {
    "minMissScore": 1.2,
    "highMissScore": 3.0,
    "maxDfRatio": 0.2
  }
}
```

### 四种学习能力

#### 1. 自动发现停用词

从历史运行的 `skill_discovered` 事件中统计：每个关键词在每次运行中出现在多少个 skill 的描述中（per-run DF），计算 DF / 本次运行 skill 总数的比例，跨运行取平均。平均比例 >= 35% 且出现在 >= 50% 的已完成运行中的词，被标记为 learned stopword。

```bash
skill-ledger learn
```

**效果**：频繁出现在大量 skill 描述中但没有判别力的词（如 `use`、`when`）被自动过滤，减少漏用推断的噪声。

#### 2. 自动发现同义词

从历史运行中统计任务上下文关键词与 skill 描述关键词的直接共现：对每个已完成运行，提取任务上下文关键词和每个 skill 的描述关键词，对所有上下文词 × skill 描述词的配对统计共现次数（每对每运行只计一次）。共现 >= 8 次且运行覆盖率 >= 75% 的词对被标记为 learned synonym。

```bash
skill-ledger learn
```

**效果**：如果团队的任务上下文持续使用"界面"而 skill 描述使用"ui"，系统会自动学习到这个同义关系，让未来的漏用推断能跨语言匹配。

#### 3. 用户反馈学习

用户通过 CLI 命令标记漏用推断结果的对错：

```bash
# 标记为误报
skill-ledger feedback --skill project-artifact --verdict rejected --reason "命中 default 泛词"

# 标记为正确建议
skill-ledger feedback --skill ui-ux-pro-max --verdict confirmed --reason "确实应该用"
```

反馈事件**累计保存**（同一 skill 多次反馈会累计，不会覆盖），并维护 `lastVerdict` 映射记录每个 skill 的最新判定。

#### 4. 自动调阈值

当累计反馈事件数（confirmed + rejected）达到 3 次后，系统按拒绝率（rejectRate）自动调整推断阈值：

| 参数 | 调整公式 | 默认值 | 示例（rejectRate=100%） |
|---|---|---|---|
| `minMissScore` | 0.8 × (1 + rejectRate × 0.5) | 0.8 | 1.2 |
| `highMissScore` | 2.0 × (1 + rejectRate × 0.5) | 2.0 | 3.0 |
| `maxDfRatio` | max(0.15, 0.3 - rejectRate × 0.1) | 0.3 | 0.2 |

拒绝率越高，阈值越严格--漏用推断需要更高的评分才能通过，减少误报。

### 合并优先级

| 组件 | 硬编码默认值 | learned 覆盖 | 无 learned model 时 |
|---|---|---|---|
| 停用词 | `STOPWORDS`（内置） | `learnedStopwords` 追加合并 | 仅用硬编码 |
| 同义词 | `SYNONYM_GROUPS`（20 组） | `learnedSynonyms` 追加合并 | 仅用硬编码 |
| 阈值 | `0.8 / 2.0 / 0.3` | `thresholds` 字段覆盖 | 仅用硬编码 |

**无 `learned-model.json` 时完全回退到硬编码默认行为**，不影响现有功能。

### `--merge` 选项

`learn` 命令支持 `--merge` 选项，在学习时保留已有的 feedback 数据：

```bash
skill-ledger learn --merge
```

不加 `--merge` 时会重新计算 stopwords/synonyms，但 feedback 和 thresholds 不受影响（feedback 只通过 `feedback` 命令修改）。

---

## 数据流与存储

```
项目根目录/
├── skill-ledger/
│   └── learned-model.json              ← 学习模型（可 git 跟踪，团队共享）
│
└── .skill-ledger/                      ← 审计数据（gitignore，不提交）
    ├── runs/
    │   └── 20260713T084552Z-c10215c7.jsonl    ← 审计日志（每行一个 JSON 事件）
    ├── active/
    │   └── claude-code--session-a-abc123.json  ← 活跃运行指针（会话隔离用）
    └── reports/
        └── 20260713T084552Z-c10215c7.md       ← 最终中文报告
```

### 审计日志事件类型

| 事件 | 含义 |
|---|---|
| `task_start` | 运行启动，含 harness / cwd / sessionId / privacyMode / taskContext |
| `skill_discovered` | 发现一个 skill |
| `skill_called` | 记录一次调用，含 evidence / reason |
| `task_context` | 迟到的任务上下文补充 |
| `tool_observed` | 工具调用探针（非 skill 工具的弱信号） |
| `audit_note` | 手动备注 |
| `task_end` | 运行结束 |

---

## 会话隔离机制

多会话并发时，Skill Ledger 用 `harness + sessionId` 做键隔离：

- 每个 active run 存为 `.skill-ledger/active/<harness>--<sessionHash>.json`
- 如果宿主提供了 sessionId，精确匹配
- 如果没有 sessionId 且有多个活跃 run，**丢弃事件而非错误归因**（保守策略）
- 已结束的 run 会被自动排除（检查日志是否含 `task_end` 事件）

---

## 隐私保护

三档模式，通过环境变量 `SKILL_LEDGER_PRIVACY` 控制：

| 模式 | 任务上下文 | 工具输入 |
|---|---|---|
| `strict` | 不保存 | 不保存 |
| `balanced`（默认） | 脱敏后保存 | 只存键名 + payload hash |
| `diagnostic` | 脱敏后保存 | 脱敏截断后保存 |

### 脱敏覆盖范围

自动检测并脱敏以下敏感信息：

- `password` / `password123` 等 `password\w*` 后跟的值
- `api_key` / `token` / `client_secret` / `passwd` / `secret` / `private_key` 等关键词后跟的值
- `Bearer` / `Basic` 认证头
- `sk-`（OpenAI）/ `ghp_` / `ghs_` / `gho_`（GitHub）/ `github_pat_` / `AKIA`（AWS）等格式 token
- URL 内嵌凭据：`postgresql://user:pass@host`、`mysql://root:pass@host`、`redis://:pass@host`、`mongodb://admin:pass@host` 等所有协议
- PEM 格式私钥（`-----BEGIN ... PRIVATE KEY-----`）

设置 `SKILL_LEDGER=off` 可完全禁用插件。

---

## 报告示例

生成的中文 Markdown 报告包含以下部分：

```
# Skills 调用审计报告

## 摘要
- 运行 ID / 宿主工具 / 会话 ID / 工作目录
- 开始时间 / 结束时间
- 发现 Skills / 已调用 / 未调用 数量
- 隐私模式 / 自动保留期
- 任务上下文状态 / 可疑自报告数量

## 已调用 Skills（表格：Skill | 来源 | 证据 | 首次调用时间 | 原因）

## 来源覆盖（表格：来源 | 发现 | 调用 | 覆盖率）

## 审计结论与行动建议

## 可能漏用的 Skills（表格：Skill | 可能适用原因 | 置信度）
> 该列表基于启发式匹配，仅供参考，不代表确证漏用。

## 证据等级说明
```

---

## 支持的宿主工具

### Tier 1：已验证（有自动化集成测试）

| 宿主 | 支持能力 |
|---|---|
| **Claude Code** | `SessionStart` / `UserPromptSubmit` / `PostToolUse` / `SessionEnd` 四个 hook 完整覆盖生命周期，原生观测 skill 调用，自动生成报告 |
| **OpenCode** | 进程内插件，消息变换注入 bootstrap，`tool.execute.after` 观测原生 skill 调用，多会话隔离，session 删除时自动生成报告，报告生成时加载 learned model |
| **Codex** | `self_reported` 工作流，诚实承认无原生 Skill 事件（模型按指令主动记录） |

### 实验性兼容（有安装脚本，未做 Tier 1 验证）

Cursor、GitHub Copilot CLI、Kimi Code、Gemini、Pi、Antigravity、Factory Droid。

这些宿主保留安装入口和兼容性资产，但在真实验证完成前不标记为 Tier 1。

---

## 安装

### Claude Code

```powershell
git clone https://github.com/zhy15608103017/skill-ledger.git
cd skill-ledger
powershell -ExecutionPolicy Bypass -File scripts/install-claude.ps1
```

### OpenCode

从 npm 安装（推荐）：

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

或运行安装脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-opencode.ps1
```

### Codex

```powershell
git clone https://github.com/zhy15608103017/skill-ledger.git "$HOME\plugins\skill-ledger"
cd "$HOME\plugins\skill-ledger"
powershell -ExecutionPolicy Bypass -File scripts/install-codex.ps1
```

### 交互式安装

```powershell
npx skill-ledger
```

---

## CLI 命令参考

```bash
# 启动一个审计运行
skill-ledger start --harness codex --cwd . \
  --task-context "脱敏任务摘要" \
  --startup-skill using-skill-audit \
  --startup-evidence self_reported

# 记录一次 skill 调用
skill-ledger call --run-id <runId> --skill <skill-name> \
  --evidence self_reported --reason "<中文原因>"

# 结束运行并生成报告（自动加载 learned model）
skill-ledger finish --run-id <runId>

# 重新生成报告
skill-ledger report --run-id <runId> [--full]

# 查看活跃运行状态
skill-ledger status --harness claude-code --session-id <sessionId>

# 列出历史运行
skill-ledger runs --limit 20

# 手动清理过期数据
skill-ledger prune --days 30

# 从历史运行日志学习停用词和同义词
skill-ledger learn [--merge]

# 标记漏用推断结果的对错（影响阈值自适应）
skill-ledger feedback --skill <name> --verdict confirmed|rejected [--reason "<原因>"]
```

---

## 适用场景

| 场景 | 价值 |
|---|---|
| **调优 skill 描述** | 通过报告看哪些 skill 从不触发、哪些频繁误触发，针对性优化 description |
| **审计 agent 工作流** | 确认 agent 在特定任务中是否正确使用了该用的 skill |
| **团队 skill 使用率统计** | 来源覆盖率表格显示哪些 skill 目录的 skill 被用得多 |
| **发现漏用** | 启发式推断提示你可能该用但没用的 skill |
| **证据溯源** | 区分"宿主确认的调用"和"模型自己声称的调用"，评估数据可信度 |
| **持续优化推断准确度** | 通过 `learn` 和 `feedback` 命令让系统从历史和反馈中学习，逐步减少误报 |

---

## 技术架构

```
skill-ledger/
├── core/                        纯逻辑层（无宿主依赖）
│   ├── active-run.mjs           活跃运行状态管理与会话隔离
│   ├── audit-log.mjs            事件日志读写、运行汇总、漏用推断
│   ├── bootstrap.mjs            启动指令文本构建与宿主工具映射
│   ├── learning.mjs             学习机制：停用词/同义词/反馈/阈值自适应
│   ├── privacy.mjs              隐私设置与敏感信息脱敏
│   ├── report-md.mjs            中文 Markdown 报告渲染
│   ├── retention.mjs            过期数据自动清理
│   ├── skill-name.mjs           Skill 名归一化与 Skill 工具识别
│   ├── skill-roots.mjs          Skill 目录发现与收集
│   ├── skill-scanner.mjs        递归扫描 SKILL.md 与清单文件
│   └── time-format.mjs          时间格式化
├── scripts/
│   ├── skill-ledger.mjs         CLI 入口（start/call/finish/report/learn/feedback/...）
│   ├── update-opencode-config.mjs
│   └── install-*.ps1           各宿主安装脚本
├── hooks/                       宿主 Hook 适配层
│   ├── hooks.json               Claude Code hook 配置
│   ├── session-start            会话启动 hook
│   ├── observe-skill-call       PostToolUse/UserPromptSubmit hook（观测 skill 调用）
│   └── session-end              会话结束 hook
├── .opencode/plugins/
│   └── skill-ledger.js          OpenCode 进程内插件
├── skills/
│   └── using-skill-audit/           启动纪律 skill（会话开始时注入）
├── tests/                       100 个自动化测试
├── skill-ledger/                学习数据目录（可 git 跟踪）
│   └── learned-model.json       学习模型文件
└── docs/                        文档
```

### 设计特点

- **分层清晰**：`core/`（纯逻辑）-> `scripts/`（CLI）-> `hooks/`（宿主适配）-> `.opencode/plugins/`（进程内插件），职责边界明确
- **依赖极简**：运行时仅依赖 `yaml`（frontmatter 解析），其余全用 Node.js 内置模块
- **测试覆盖**：100 个自动化测试覆盖 CLI、core、hooks、OpenCode 插件、安装资产、发布包、隐私、保留期、会话隔离、学习机制
- **诚实工程**：证据分级模型不把模型自报包装成宿主确认，分级标注宿主支持状态（Tier 1 vs 实验性）
- **自学习**：从历史运行和用户反馈中持续优化漏用推断准确度，学习数据可 git 跟踪团队共享

---

## 环境变量参考

| 变量 | 作用 | 默认值 |
|---|---|---|
| `SKILL_LEDGER_PRIVACY` | 隐私模式：`strict` / `balanced` / `diagnostic` | `balanced` |
| `SKILL_LEDGER_RETENTION_DAYS` | 自动保留期天数（0 = 不自动清理） | `0` |
| `SKILL_LEDGER_HOME` | 审计数据存储根目录 | `<cwd>/.skill-ledger` |
| `SKILL_LEDGER_SKILL_ROOTS` | 额外 skill 目录（逗号或路径分隔符分隔） | - |
| `SKILL_LEDGER_SKILLS` | 同上（别名） | - |
| `SKILL_LEDGER` | 设为 `off` 完全禁用插件 | - |

---

## 项目信息

- **版本**：0.2.0
- **协议**：MIT
- **仓库**：https://github.com/zhy15608103017/skill-ledger
- **作者**：zhy15608103017
