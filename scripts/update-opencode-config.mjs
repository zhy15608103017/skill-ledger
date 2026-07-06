#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(required(args, "config"));
const pluginSpec = required(args, "plugin");
const legacySpecs = new Set([
  "skill-audit",
  "D:/github/plugin/skill-audit",
  "D:\\github\\plugin\\skill-audit",
]);

await mkdir(path.dirname(configPath), { recursive: true });

let config = { "$schema": "https://opencode.ai/config.json" };
let existed = false;

try {
  const content = await readFile(configPath, "utf8");
  if (content.trim()) config = JSON.parse(content);
  existed = true;
} catch (error) {
  if (error.code !== "ENOENT") {
    throw new Error(`Cannot read OpenCode config as JSON: ${configPath}\n${error.message}`);
  }
}

if (existed) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  await copyFile(configPath, `${configPath}.bak-${stamp}`);
}

const plugins = Array.isArray(config.plugin) ? config.plugin : config.plugin ? [config.plugin] : [];
config.plugin = [
  ...plugins.filter((item) => {
    const value = String(item);
    if (value === pluginSpec) return false;
    if (legacySpecs.has(value)) return false;
    if (/skill-audit@git\+/.test(value)) return false;
    if (/[/\\]skill-audit(\.git)?$/.test(value)) return false;
    return true;
  }),
  pluginSpec,
];

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  config: configPath,
  plugin: pluginSpec,
  pluginCount: config.plugin.length,
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    parsed[item.slice(2)] = argv[++index];
  }
  return parsed;
}

function required(options, name) {
  if (!options[name]) throw new Error(`Missing required option --${name}`);
  return options[name];
}
