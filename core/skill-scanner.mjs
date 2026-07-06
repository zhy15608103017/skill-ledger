import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SKILL_FILE = "SKILL.md";

export async function scanSkillRoots(roots) {
  const skills = [];
  for (const root of roots.filter(Boolean)) {
    const absoluteRoot = path.resolve(root);
    const source = path.basename(absoluteRoot);
    const found = await scanOneRoot(absoluteRoot, source);
    skills.push(...found);
  }
  return skills;
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
    return skill ? [skill] : [];
  }

  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const discovered = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    discovered.push(...(await scanDirectory(path.join(directory, entry.name), source)));
  }
  return discovered;
}

async function parseSkillFile(filePath, source) {
  const content = await readFile(filePath, "utf8");
  const frontmatter = extractFrontmatter(content);
  if (!frontmatter.name) return null;
  return {
    name: frontmatter.name,
    description: frontmatter.description || "",
    source,
    path: filePath,
  };
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name" || key === "description") result[key] = value;
  }
  return result;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
