// 技能名归一化与 Skill 工具识别的共享逻辑。
// 同时被 core/audit-log.mjs 和 hooks/observe-skill-call.mjs 使用，
// 避免两端各自实现导致判定不一致。

// 已知的 Skill 工具名（忽略大小写、连字符/下划线差异）。
const SKILL_TOOL_ALIASES = new Set([
  "skill",
  "skilltool",
  "loadskill",
  "load-skill",
  "load_skill",
  "invokeskill",
  "invoke-skill",
  "invoke_skill",
  "applyskill",
  "apply-skill",
  "apply_skill",
  "usesskill",
  "use-skill",
  "use_skill",
]);

// 归一化工具名：小写 + 去掉连字符/下划线变体差异。
export function normalizeToolName(tool) {
  const text = String(tool || "").trim().toLowerCase();
  if (!text) return "";
  return text.replace(/[-_]+/g, "");
}

// 判断某个工具名是否属于 Skill 调用工具。
export function isSkillTool(tool) {
  const normalized = normalizeToolName(tool);
  if (!normalized) return false;
  if (SKILL_TOOL_ALIASES.has(normalized)) return true;
  // 兜底：名字里含 "skill" 子串，避免漏掉未知宿主的自定义命名。
  return /skill/.test(normalized);
}

// 归一化技能名：去掉前导斜杠/@、namespace 前缀、路径、SKILL.md 后缀，
// 统一小写比较键。返回值用于匹配 discoveredByName 和去重。
export function normalizeSkillName(value) {
  if (!value) return "";
  if (typeof value === "object" && value.name) return normalizeSkillName(value.name);

  let text = String(value).trim();
  if (!text) return "";

  if (text.startsWith("/")) text = text.slice(1);
  if (text.startsWith("@")) text = text.slice(1);

  // 处理 namespace:skill-name 形式，取冒号后的部分。
  if (text.includes(":")) text = text.slice(text.lastIndexOf(":") + 1);

  // 统一路径分隔符，便于后续按 / 切分。
  text = text.replace(/\\/g, "/");

  // 如果最后一段是 SKILL.md（不区分大小写），取倒数第二段作为 skill 名。
  const segments = text.split("/").filter(Boolean);
  if (segments.length >= 2 && /^skill\.md$/i.test(segments[segments.length - 1])) {
    text = segments[segments.length - 2];
  } else if (segments.length >= 1) {
    text = segments[segments.length - 1];
  }

  // 去掉普通 .md 后缀。
  text = text.replace(/\.md$/i, "");

  return text.trim();
}

// 大小写不敏感的归一化键，用于 Map 查找。
export function skillNameKey(name) {
  return normalizeSkillName(name).toLowerCase();
}

// 把一个原始技能名映射到 discoveredByName 里已存在的规范名。
// 找不到时返回归一化后的名字（保留原大小写用于展示）。
export function canonicalSkillName(rawName, discoveredByKey = new Map()) {
  const normalized = normalizeSkillName(rawName);
  if (!normalized) return "";
  const key = normalized.toLowerCase();

  if (discoveredByKey.has(key)) return discoveredByKey.get(key);
  // 退回到原始字符串（去掉前缀/路径）以便展示尽量可读。
  return normalized;
}