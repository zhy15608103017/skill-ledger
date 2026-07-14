# 漏用推断 — 启发式匹配详解

> 本文是对 Skill Ledger 中"可能漏用的 Skills"功能的深度原理解析，适合需要理解算法细节或调优推断准确度的开发者阅读。

## 概述

漏用推断是 Skill Ledger 审计报告中最具特色的功能。当会话结束后，它会扫描所有**已发现但未被调用**的 skill，对照任务上下文（用户原始请求 + 已调用 skill 的调用原因 + 备注 + 工具探针信号），推断哪些 skill **可能应该被使用但被遗漏了**。

输出的不是确定结论，而是带有置信度的候选列表。报告明确标注：

> "该列表基于 Skill 描述关键词与任务上下文的启发式匹配，仅供参考，不代表确证漏用。"

---

## 算法全流程

```
┌─────────────────────────────────────────────────────────┐
│                    输入                                  │
│  1. discoveredSkills: 所有被发现的 skill (name+description) │
│  2. calledSkills: 已调用的 skill                          │
│  3. taskContext: 用户原始任务文本（脱敏后）                  │
│  4. notes: 手动备注                                        │
│  5. toolObservedText: 工具调用探针的弱信号                  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1: 构建上下文文本                                    │
│  把 taskContext + calledSkills(name+desc+reason)          │
│  + notes + toolObservedText 拼接成一段文本                  │
│  优先级: 用户原始任务上下文 > 已调用 skill > 备注 > 探针    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: 关键词提取                                        │
│  英文: 按非字母数字切分 → 同义词归并 → 去停用词              │
│  中文: Intl.Segmenter 词级分词 → 同义词归并 → 去停用词      │
│  (无 Segmenter 时回退到 CJK bigram)                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: 文档频率 (DF) 统计                                │
│  对每个 skill 的 name+description 提取关键词               │
│  统计每个关键词出现在多少个 skill 的描述中                    │
│  关键词出现越少越有判别力                                    │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: 判别性过滤                                        │
│  maxDocumentFrequency = max(2, ceil(skill总数 × 30%))     │
│  只保留 DF ≤ maxDocumentFrequency 的关键词                  │
│  (出现在太多 skill 描述中的词没有判别力)                     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 5: 关键词匹配                                       │
│  对每个未调用的 skill:                                     │
│    提取其判别性关键词                                       │
│    与上下文关键词求交集                                     │
│    命中 ≥ 2 个 → 候选                                      │
│    命中 = 1 个且该词 DF=1 (独占词) → 候选                   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 6: TF-IDF 评分                                      │
│  score = Σ (1 / DF(matched_keyword))                     │
│  越罕见的词命中，贡献分越高                                   │
│  score < minMissScore → 淘汰                              │
│  score ≥ highMissScore 且命中 ≥ 3 → "较高"置信度           │
│  否则 → "中等"置信度                                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Step 7: 排序与输出                                       │
│  按 score 降序排列                                         │
│  取前 10 个写入报告                                        │
│  每条含: name, reason (命中的关键词), confidence            │
└─────────────────────────────────────────────────────────┘
```

---

## 逐步详解

### Step 1: 构建上下文文本

```javascript
function buildTaskContextText(calledSkills, notes, taskContext, toolObservedText) {
  const parts = [];
  if (taskContext) parts.push(taskContext);                    // 优先级最高
  for (const skill of calledSkills) {
    parts.push(skill.name, skill.description || "", skill.reason || "");
  }
  parts.push(...notes);                                        // 手动备注
  if (toolObservedText) parts.push(toolObservedText);          // 工具探针
  return parts.join(" ").toLowerCase();
}
```

上下文文本由四部分拼接，**用户原始任务文本放在最前**，权重最高。如果任务上下文为空（如 strict 隐私模式），算法直接返回空列表，不做推断。

`tool_observed` 事件是 `PostToolUse` hook 对非 skill 工具调用的弱信号记录（工具名、输入键名、payload hash），提供"模型在做什么"的旁证。

### Step 2: 关键词提取

这是算法中最复杂的部分，分英文和中文两条路径。

#### 英文路径

```javascript
for (const token of source.split(/[^a-z0-9]+/i)) {
  if (!token || STOPWORDS.has(token)) continue;
  const canonical = canonicalizeWord(token);   // 同义词归并
  if (canonical.length >= 2 && !STOPWORDS.has(canonical)) {
    tokens.add(canonical);
  }
}
```

流程：按非字母数字字符切分 → 去停用词 → 同义词归并 → 再检查归并后的词是否为停用词。

**关键细节**：先归并再按归并后的 canonical 词长度过滤。这让 `ui`、`js`、`ts`、`css` 等 2 字母缩写经过同义词归并后仍能保留（如果不归并直接按长度过滤，`ui` 会被保留，但 `界面` 归并成 `ui` 后长度才够）。

#### 中文路径

```javascript
const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
for (const segment of segmenter.segment(source)) {
  const word = segment.segment.trim();
  if (word.length < 2) continue;
  if (!/[\u4e00-\u9fff]/.test(word)) continue;   // 只处理含 CJK 的 segment
  if (STOPWORDS.has(word)) continue;
  tokens.add(canonicalizeWord(word));
}
```

使用 `Intl.Segmenter` 做**词级分词**（不是字级），只保留长度 ≥ 2 且包含 CJK 字符的词。

**回退机制**：如果运行环境没有 `Intl.Segmenter`（如缺少完整 ICU 的 Node.js 构建），回退到 **CJK bigram** 分词：

```javascript
const cjkChars = Array.from(source).filter((char) => /[\u4e00-\u9fff]/.test(char));
for (let i = 0; i < cjkChars.length - 1; i++) {
  const bigram = cjkChars[i] + cjkChars[i + 1];
  if (!STOPWORDS.has(bigram)) tokens.add(canonicalizeWord(bigram));
}
```

bigram 会产生大量无意义组合（如"代码审"、"码审查"），增加噪声。可通过 `getSegmenter()` 检测当前是否使用 Segmenter，但目前没有日志告知用户当前用的是哪种模式。

#### 同义词归并

```javascript
const SYNONYM_GROUPS = [
  ["ui", "界面", "interface", "gui"],
  ["frontend", "前端", "front-end", "front end"],
  ["backend", "后端", "back-end", "back end"],
  ["review", "审查", "复核", "reviewing"],
  ["test", "测试", "testing"],
  ["design", "设计"],
  ["report", "报告", "审计"],
  ["audit", "审计", "审查"],
  ["image", "图片", "图像"],
  ["prototype", "原型", "wireframe", "mockup"],
  ["css", "样式"],
  ["typescript", "ts"],
  ["javascript", "js"],
  ["python", "py"],
  ["refactor", "重构"],
  ["bug", "缺陷", "错误"],
  ["optimize", "优化", "performance", "性能"],
  ["onboard", "onboarding", "入职", "上手"],
  ["dashboard", "仪表盘", "看板"],
  ["landing", "落地页", "首页"],
];
```

每组第一个词是**规范形式 (canonical)**，其余都是同义词。归并后，任务上下文里的"界面"和 skill 描述里的"ui"会被映射到同一个关键词 `ui`，从而可以匹配。

#### 停用词过滤

停用词分三类：

| 类别 | 示例 | 作用 |
|---|---|---|
| 英文虚词/连接词 | `the`, `a`, `an`, `and`, `or`, `to`, `in`, `with` | 语法功能词，无判别力 |
| 通用过程动词 | `use`, `make`, `get`, `set`, `need`, `help`, `require`, `support`, `provide`, `include`, `handle`, `manage`, `control`, `load`, `record`, `call`, `invoke` | 几乎所有 skill 描述都包含 |
| 通用填充名词 | `task`, `user`, `skill`, `file`, `local`, `output`, `doc`, `spec`, `feature`, `comment`, `trigger`, `dev`, `code`, `tool`, `plugin`, `module`, `app`, `service`, `api`, `function`, `action` | 技术上下文通用词 |
| 高频技术词 | `default`, `model`, `add`, `update`, `create`, `generate`, `build`, `config`, `json`, `yaml`, `path`, `name`, `value`, `type`, `data`, `info`, `command`, `project`, `source` | 在大量 skill 描述中出现 |
| 中文通用技术词 | `配置`, `创建`, `生成`, `更新`, `修复`, `解决`, `实现`, `检查`, `验证`, `管理`, `处理`, `操作`, `数据`, `信息`, `选项`, `设置`, `命令`, `路径`, `目录`, `文件`, `项目`, `代码`, `工具`, `插件`, `模块` | 中文高频技术词 |
| 中文虚词 | `并`, `的`, `了`, `在`, `是`, `我`, `你`, `和`, `与`, `也`, `都`, `就`, `还`, `被`, `给`, `向`, `从`, `到`, `对`, `以`, `为`, `而`, `则`, `若`, `如`, `且`, `但`, `只`, `会`, `能`, `可`, `要`, `需`, `应`, `该`, `一`, `个` | 中文语法虚词 |

### Step 3: 文档频率 (DF) 统计

```javascript
const documentFrequency = new Map();
for (const skill of discoveredSkills) {
  for (const keyword of new Set(extractKeywords(`${skill.name} ${skill.description}`))) {
    documentFrequency.set(keyword, (documentFrequency.get(keyword) || 0) + 1);
  }
}
```

对每个 skill，提取其 `name + description` 的关键词（去重），统计每个关键词出现在**多少个 skill** 的描述中。一个关键词出现在越多 skill 的描述中，它的**判别力越低**——因为命中它无法帮你区分该用哪个 skill。

### Step 4: 判别性过滤

```javascript
const maxDocumentFrequency = Math.max(2, Math.ceil(total * 0.3));
const isDiscriminative = (keyword) => {
  const frequency = documentFrequency.get(keyword) || 0;
  return frequency > 0 && frequency <= maxDocumentFrequency;
};
```

**自适应阈值**：skill 总数 × 30%，最少为 2。

| Skill 总数 | maxDF | 含义 |
|---|---|---|
| 5 | 2 | 关键词最多出现在 2 个 skill 中才算判别性 |
| 10 | 3 | 最多 3 个 |
| 50 | 15 | 最多 15 个 |
| 100 | 30 | 最多 30 个 |

出现在超过 30% 的 skill 描述中的关键词会被认为是"泛词"，不参与匹配。

### Step 5: 关键词匹配

```javascript
for (const skill of discoveredSkills) {
  if (calledKeys.has(skillNameKey(skill.name))) continue;   // 跳过已调用的

  const keywords = [...new Set(extractKeywords(`${skill.name} ${skill.description}`))]
    .filter(isDiscriminative);                               // 只留判别性关键词
  if (keywords.length < 1) continue;

  const matched = keywords.filter((keyword) => contextKeywords.has(keyword));

  // 命中 ≥ 2 个判别性关键词 → 候选
  // 或命中 1 个且该关键词 DF=1（独占词）→ 候选
  const uniqueHit = matched.length === 1 && documentFrequency.get(matched[0]) === 1;
  if (matched.length < 2 && !uniqueHit) continue;
  // ...进入评分
}
```

**两种命中模式**：

- **多词命中**：命中 ≥ 2 个判别性关键词。多个词同时命中降低了误报概率。
- **独占词命中**：只命中 1 个关键词，但该关键词的 DF=1（只在这一个 skill 的描述中出现）。独占词有高判别力，单个命中也值得报告。这个设计是为了支持中文场景——中文分词可能只产出一个有效的判别性词，不应该因为数量门槛而漏报。

### Step 6: TF-IDF 评分

```javascript
const score = matched.reduce((sum, keyword) => sum + 1 / (documentFrequency.get(keyword) || 1), 0);
```

评分公式：**score = Σ (1 / DF(命中关键词))**

每个命中关键词的贡献分是 `1/DF`。越罕见的词命中，贡献分越高。这和搜索引擎中 TF-IDF 的 IDF 部分类似（但不完全相同——这里没有 TF 项，因为每个关键词在单个 skill 中只算一次）。

**自适应阈值**：

```javascript
const scale = total > 10 ? Math.log10(total) : 1;
const minMissScore = 0.8 * scale;    // 最低评分门槛
const highMissScore = 2 * scale;    // 高置信度门槛
```

| Skill 总数 | scale | minMissScore | highMissScore |
|---|---|---|---|
| 1-10 | 1 | 0.8 | 2.0 |
| 50 | 1.70 | 1.36 | 3.40 |
| 100 | 2 | 1.60 | 4.00 |
| 500 | 2.70 | 2.16 | 5.40 |

Skill 数量越多，阈值越高——因为大清单下关键词的 DF 普遍更高（一个词可能出现在更多 skill 中），需要更高的分数才能通过。

**置信度判定**：

```javascript
confidence: score >= highMissScore && matched.length >= 3 ? "较高" : "中等"
```

必须同时满足**高评分**和**多命中**（≥3 个关键词）才标为"较高"。

### Step 7: 排序与输出

```javascript
return candidates
  .sort((left, right) => right._score - left._score)   // 按分数降序
  .map(({ _score, ...rest }) => rest);                  // 去掉内部评分字段
```

报告渲染时取前 10 个（`maxPossiblyMissed = 10`），输出格式：

```markdown
| Skill | 可能适用原因 | 置信度 |
|---|---|---|
| ui-ux-pro-max | 任务上下文命中描述关键词：ui、design、react | 较高 |
```

---

## 完整示例

以一个具体场景演示完整计算过程。

### 输入

- **任务上下文**：`"帮我设计一个前端界面，用 React 做一个仪表盘落地页"`
- **已发现 skills**（5 个）：

| Skill | Description |
|---|---|
| frontend-design | Create distinctive production-grade frontend interfaces with high design quality |
| ui-ux-pro-max | UI/UX design intelligence. 67 styles 96 palettes 57 font pairings 25 charts 13 stacks React Next.js Vue Svelte |
| backend-api | Build REST API backend services with Node.js Express |
| code-review-loop | AI code review for feature bug fix refactor changes |
| imagegen | Generate raster images photos illustrations textures sprites mockups |

- **已调用**：`frontend-design`

### Step 1: 上下文文本

```
"帮我设计一个前端界面，用 react 做一个仪表盘落地页 frontend-design create distinctive production-grade frontend interfaces with high design quality 构建前端界面"
```

（= 任务上下文 + 已调用 skill 的 name/description/reason）

### Step 2: 关键词提取

**英文路径**：从上下文文本中提取英文 token，去停用词，同义词归并：

- `react` → `react`（非停用词，长度 ≥ 2）✅

**中文路径**（Intl.Segmenter 分词）：

- `设计` → 同义词归并 → `design` ✅
- `前端` → 同义词归并 → `frontend` ✅
- `界面` → 同义词归并 → `ui` ✅
- `仪表盘` → 同义词归并 → `dashboard` ✅
- `落地页` → 同义词归并 → `landing` ✅

**上下文关键词集合**：`{ react, design, frontend, ui, dashboard, landing }`

### Step 3: DF 统计

对 5 个 skill 各自提取关键词，统计每个关键词出现在几个 skill 中：

| 关键词 | 出现在哪些 skill | DF |
|---|---|---|
| `frontend` | frontend-design | 1 |
| `design` | frontend-design, ui-ux-pro-max | 2 |
| `ui` | ui-ux-pro-max | 1 |
| `react` | ui-ux-pro-max | 1 |
| `backend` | backend-api | 1 |
| `review` | code-review-loop | 1 |
| `bug` | code-review-loop | 1 |
| `imagegen` | imagegen | 1 |
| ... | ... | ... |

### Step 4: 判别性过滤

- `total = 5`，`maxDocumentFrequency = max(2, ceil(5 × 0.3)) = 2`
- 只保留 DF ≤ 2 的关键词
- `design`（DF=2）保留（等于阈值）
- `frontend`（DF=1）保留
- `ui`（DF=1）保留
- `react`（DF=1）保留

### Step 5: 匹配

对 4 个未调用的 skill 逐一检查：

| Skill | 判别性关键词 | 与上下文交集 | 命中数 | 是否候选 |
|---|---|---|---|---|
| **ui-ux-pro-max** | ui, ux, pro, max, design, react, next | **ui, design, react** | 3 | ✅ (≥2) |
| backend-api | backend, node, javascript | (无) | 0 | ❌ |
| code-review-loop | review, loop, ai, bug | (无) | 0 | ❌ |
| imagegen | imagegen | (无) | 0 | ❌ |

### Step 6: 评分

`ui-ux-pro-max` 命中 3 个关键词：

```
score = 1/DF(ui) + 1/DF(design) + 1/DF(react)
      = 1/1 + 1/2 + 1/1
      = 1 + 0.5 + 1
      = 2.5
```

- `scale = 1`（total=5 ≤ 10）
- `minMissScore = 0.8 × 1 = 0.8` → 2.5 ≥ 0.8 ✅
- `highMissScore = 2 × 1 = 2` → 2.5 ≥ 2 ✅ 且命中 ≥ 3 ✅
- 置信度：**较高**

### Step 7: 输出

```markdown
| Skill | 可能适用原因 | 置信度 |
|---|---|---|
| ui-ux-pro-max | 任务上下文命中描述关键词：ui、design、react | 较高 |
```

---

## 设计权衡

### 为什么用启发式而不是 LLM 推断？

- **零成本**：不需要额外的模型调用，纯本地计算
- **确定性**：相同输入永远产出相同输出，可复现
- **快速**：毫秒级完成，不阻塞报告生成
- **可审计**：算法逻辑完全在代码中，可检查、可测试

代价是准确度有限——关键词匹配无法理解语义。比如"帮我优化性能"和 skill 描述里的"optimize performance"只有通过同义词归并才能匹配，而更复杂的语义关系（如"提升速度"≈"优化性能"）无法识别。

### 为什么不只用 TF-IDF？

标准 TF-IDF 需要一个**文档集**来计算 IDF。这里把每个 skill 的 `name+description` 当作一个"文档"，但文档集很小（通常几十到上百个），IDF 的统计基础薄弱。因此算法做了以下调整：

- **去停用词**：手动维护停用词表，而不是完全依赖 DF 统计来过滤泛词
- **同义词归并**：手动维护同义词组，弥补纯词频匹配无法处理同义关系的缺陷
- **独占词规则**：DF=1 的词即使单个命中也算候选，弥补小文档集下统计信号弱的问题
- **自适应阈值**：阈值随 skill 数量缩放，避免大清单下全报或小清单下全不报

### 为什么用 bigram 回退而不是全词匹配？

中文没有天然的词边界。如果 `Intl.Segmenter` 不可用，直接把整段中文当一个 token 没有判别力。bigram（相邻两字组合）是一种简单的近似分词方法：

- "代码审查" → "代码"、"码审"、"审查" → 其中"代码"和"审查"有意义，"码审"是噪声
- 噪声词通常 DF 低，可能被误认为独占词

这是 `Intl.Segmenter` 不可用时的**最后手段**，准确度确实会下降。

---

## 调优指南

### 漏用推断误报太多

1. **扩充停用词**：在 `core/audit-log.mjs` 的 `STOPWORDS` 中添加在你的 skill 集合中高频出现但无判别力的词
2. **提高阈值**：调高 `MIN_MISS_SCORE`（默认 0.8）或 `HIGH_MISS_SCORE`（默认 2）
3. **收紧 maxDF**：把 `Math.ceil(total * 0.3)` 改为 `0.2` 或 `0.15`

### 漏用推断漏报太多

1. **扩充同义词组**：在 `SYNONYM_GROUPS` 中添加你领域中常见的同义关系
2. **降低阈值**：调低 `MIN_MISS_SCORE`
3. **放宽 maxDF**：把 `0.3` 改为 `0.4` 或 `0.5`
4. **确保 Intl.Segmenter 可用**：检查 Node.js 是否构建了完整 ICU（`node -e "console.log(typeof Intl.Segmenter)"` 应输出 `function`）

### 中文匹配效果差

1. 检查 `Intl.Segmenter` 是否可用（如果不可用，回退到 bigram 会产生大量噪声）
2. 在 `SYNONYM_GROUPS` 中添加中文同义词组
3. 在 `STOPWORDS` 中添加你领域中高频但无判别力的中文词

---

## 算法局限性

| 局限 | 说明 |
|---|---|
| **无语义理解** | 纯关键词匹配，无法理解"提升速度"≈"优化性能"等语义关系 |
| **同义词表有限** | 硬编码 20 组，覆盖面有限，扩展需改代码 |
| **中文分词依赖环境** | 无 `Intl.Segmenter` 时回退到 bigram，噪声增大 |
| **小样本统计不稳** | skill 数量少时 DF 统计基础薄弱，独占词规则是补偿手段 |
| **停用词需维护** | 随 skill 描述风格变化，新的泛词需要手动加入 |
| **最多输出 10 条** | 报告渲染时 `maxPossiblyMissed = 10`，超出的不显示 |
| **不区分调用质量** | 只判断"是否可能漏用"，不判断"已调用的是否用对了" |

---

## 相关代码位置

| 组件 | 文件 | 行号 |
|---|---|---|
| 漏用推断主函数 | `core/audit-log.mjs` | `detectPossiblyMissedSkills()` |
| 上下文文本构建 | `core/audit-log.mjs` | `buildTaskContextText()` |
| 关键词提取 | `core/audit-log.mjs` | `extractKeywords()` |
| 中文分词器 | `core/audit-log.mjs` | `getSegmenter()` |
| 同义词归并 | `core/audit-log.mjs` | `canonicalizeWord()` / `SYNONYM_GROUPS` |
| 停用词表 | `core/audit-log.mjs` | `STOPWORDS` |
| 评分常量 | `core/audit-log.mjs` | `MIN_MISS_SCORE` / `HIGH_MISS_SCORE` |
| 报告渲染 | `core/report-md.mjs` | `renderChineseMarkdownReport()` 中 `possibleMissTable()` |
| 报告最大条数 | `core/report-md.mjs` | `maxPossiblyMissed = 10` |