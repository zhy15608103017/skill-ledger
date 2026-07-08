import { homedir } from "node:os";
import path from "node:path";

const ENV_ROOT_KEYS = ["SKILL_LEDGER_SKILL_ROOTS", "SKILL_LEDGER_SKILLS"];

export function collectSkillRoots({
  cwd = process.cwd(),
  pluginRoot = "",
  home = homedir(),
  explicitRoots = [],
  includeDefaults = true,
  includeEnv = includeDefaults,
  env = process.env,
} = {}) {
  const roots = [];

  if (includeDefaults) {
    roots.push(...defaultSkillRoots({ cwd, pluginRoot, home }));
  }

  roots.push(...arrayOption(explicitRoots));
  if (includeEnv) roots.push(...envSkillRoots(env));

  return uniqueRoots(
    roots
      .map((item) => normalizeSkillRoot(item, { cwd, home }))
      .filter(Boolean),
  );
}

export function defaultSkillRoots({ cwd = process.cwd(), pluginRoot = "", home = homedir() } = {}) {
  return [
    pluginRoot && path.join(pluginRoot, "skills"),
    path.join(cwd, "skills"),
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".opencode", "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(cwd, ".config", "opencode", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".config", "opencode", "skills"),
    path.join(home, ".codex", "plugins", "cache"),
    path.join(home, ".agents", "plugins"),
    path.join(home, "plugins"),
    path.join(home, ".cc-switch", "skills"),
    path.join(home, ".understand-anything", "repo", "understand-anything-plugin", "skills"),
    path.join(home, ".claude", "plugins"),
    path.join(home, ".cursor", "plugins"),
    path.join(home, ".kimi", "plugins"),
    path.join(home, ".gemini", "extensions"),
    path.join(home, ".pi", "extensions"),
  ].filter(Boolean);
}

export function envSkillRoots(env = process.env) {
  return ENV_ROOT_KEYS.flatMap((key) => splitRootList(env[key]));
}

function splitRootList(value) {
  if (!value) return [];
  const text = String(value).trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap(splitRootList);
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(","))
    .flatMap((line) => line.split(path.delimiter))
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function normalizeSkillRoot(value, { cwd, home }) {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "~") return path.resolve(home);
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return path.resolve(home, trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.resolve(trimmed);
  return path.resolve(cwd, trimmed);
}

function uniqueRoots(roots) {
  const seen = new Set();
  const result = [];
  for (const root of roots) {
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(root);
  }
  return result;
}

function arrayOption(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
