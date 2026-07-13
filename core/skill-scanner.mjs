import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { normalizeSkillName, skillNameKey } from "./skill-name.mjs";

const SKILL_FILE = "SKILL.md";

export async function scanSkillRoots(roots) {
  const skills = [];
  for (const root of roots.filter(Boolean)) {
    const absoluteRoot = path.resolve(root);
    const source = path.basename(absoluteRoot);
    const found = await scanOneRoot(absoluteRoot, source);
    skills.push(...found);
  }
  // 跨 root 去重：按归一化 skill 名小写 key 合并，避免清单声明与递归 SKILL.md
  // 发现同一 skill 时返回重复条目。优先保留带 description 且 path 指向真实 SKILL.md 的记录。
  return deduplicateSkills(skills);
}

function deduplicateSkills(skills) {
  const byKey = new Map();
  for (const skill of skills) {
    const key = skillNameKey(skill.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, skill);
      continue;
    }
    // 保留信息更完整（有 description、path 指向 SKILL.md）的那条。
    const candidate = preferMoreComplete(existing, skill);
    byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function preferMoreComplete(left, right) {
  const leftScore = (left.description ? 1 : 0) + (String(left.path || "").endsWith(SKILL_FILE) ? 1 : 0);
  const rightScore = (right.description ? 1 : 0) + (String(right.path || "").endsWith(SKILL_FILE) ? 1 : 0);
  return rightScore > leftScore ? right : left;
}

async function scanOneRoot(root, source) {
  try {
    const rootStat = await stat(root);
    if (rootStat.isFile() && path.basename(root) === SKILL_FILE) {
      const skill = await parseSkillFile(root, source);
      return skill ? [skill] : [];
    }
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }

  return scanDirectory(root, source);
}

async function scanDirectory(directory, source) {
  const skillPath = path.join(directory, SKILL_FILE);
  if (await exists(skillPath)) {
    const skill = await parseSkillFile(skillPath, source);
    if (skill) return [skill];
  }

  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const discovered = [];

  // 补充来源：部分宿主用 plugin.json / package.json 的 skills 字段声明 skill 清单，
  // 即使没有 SKILL.md 也能被发现。
  for (const manifestName of ["plugin.json", "package.json"]) {
    const manifestSkills = await parseManifestSkillList(path.join(directory, manifestName), source, directory);
    discovered.push(...manifestSkills);
  }

  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    discovered.push(...(await scanDirectory(path.join(directory, entry.name), source)));
  }
  return discovered;
}

async function parseSkillFile(filePath, source) {
  const content = await readFile(filePath, "utf8");
  let frontmatter = extractFrontmatter(content);

  // frontmatter 解析失败或缺少 name 时，回退到正文标题或首个 name: 行。
  if (!frontmatter.name) {
    frontmatter = { ...frontmatter, ...fallbackNameAndDescription(content) };
  }

  if (!frontmatter.name) return null;
  return {
    name: frontmatter.name,
    description: frontmatter.description || "",
    source,
    path: filePath,
  };
}

// 从宿主清单文件（plugin.json / package.json）中读取 skills 数组，
// 支持 "name" 或 "skill" 字段、字符串项或 {name, description} 对象项。
async function parseManifestSkillList(manifestPath, source, baseDir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return [];
  }

  const rawSkills = manifest.skills || manifest.skill || (manifest.pi && manifest.pi.skills);
  if (!Array.isArray(rawSkills)) return [];

  const skills = [];
  for (const item of rawSkills) {
    const entry = typeof item === "string" ? { name: item } : item;
    if (!entry || !entry.name) continue;

    const name = String(entry.name).trim();
    if (!name) continue;

    // 尝试读取对应的 SKILL.md 描述；找不到就只用清单里的描述。
    let description = entry.description || "";
    if (!description) {
      const skillFile = await resolveSkillFile(baseDir, name);
      if (skillFile) {
        const parsed = await parseSkillFile(skillFile, source);
        if (parsed) {
          skills.push(parsed);
          continue;
        }
      }
    }

    skills.push({ name, description, source, path: manifestPath });
  }
  return skills;
}

async function resolveSkillFile(baseDir, name) {
  const candidates = [
    path.join(baseDir, name, SKILL_FILE),
    path.join(baseDir, "skills", name, SKILL_FILE),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  try {
    const parsed = parseYaml(match[1]) || {};
    return {
      name: frontmatterString(parsed.name),
      description: frontmatterString(parsed.description),
    };
  } catch {
    return {};
  }
}

// frontmatter 缺失或无 name 时的回退：解析正文第一行 # 标题，
// 以及首个独立的 "name:" 行。
function fallbackNameAndDescription(content) {
  const result = {};

  const nameMatch = content.match(/^\s*name:\s*(.+?)\s*$/m);
  if (nameMatch && nameMatch[1]) {
    result.name = nameMatch[1].replace(/^["']|["']$/g, "").trim();
  }

  if (!result.name) {
    const headingMatch = content.match(/^\s*#\s+(.+?)\s*$/m);
    if (headingMatch && headingMatch[1]) {
      result.name = kebabize(headingMatch[1]);
    }
  }

  const descMatch = content.match(/^\s*description:\s*(.+?)\s*$/m);
  if (descMatch && descMatch[1]) {
    result.description = descMatch[1].replace(/^["']|["']$/g, "").trim();
  }

  return result;
}

function frontmatterString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// 把标题文本转成 kebab-case 风格的 skill 名，匹配项目命名约定。
function kebabize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}