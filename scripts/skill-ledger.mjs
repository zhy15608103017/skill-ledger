#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { appendEvent, readEvents, summarizeRun } from "../core/audit-log.mjs";
import { renderChineseMarkdownReport } from "../core/report-md.mjs";
import { scanSkillRoots } from "../core/skill-scanner.mjs";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");

try {
  if (!command) await showQuickInstallMenu();
  else if (command === "start") await startRun(args);
  else if (command === "call") await recordSkillCall(args);
  else if (command === "note") await recordNote(args);
  else if (command === "finish") await finishRun(args);
  else if (command === "report") await writeReport(args);
  else if (command === "install-opencode") await installOpenCode(args);
  else if (command === "install-codex") installCodex(args);
  else usage(1);
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

async function showQuickInstallMenu() {
  console.log("Skill Ledger quick install");
  console.log("");
  console.log("Supported AI coding tools:");
  console.log("  1. Codex");
  console.log("  2. OpenCode");
  console.log("  q. Cancel");
  console.log("");

  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("Select a tool to install Skill Ledger: ")).trim().toLowerCase();
    if (answer === "1" || answer === "codex") {
      installCodex({});
      return;
    }
    if (answer === "2" || answer === "opencode" || answer === "open code") {
      await installOpenCode({ plugin: await packageNameForInstall() });
      return;
    }
    if (answer === "q" || answer === "quit" || answer === "cancel") {
      console.log("Cancelled.");
      return;
    }
    throw new Error(`Unsupported selection: ${answer}`);
  } finally {
    rl.close();
  }
}

async function startRun(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const runId = options["run-id"] || createRunId();
  const logFile = logPath(runId, cwd);
  const configuredRoots = arrayOption(options.skills);
  const skillRoots = configuredRoots.length
    ? configuredRoots.map((item) => path.resolve(cwd, item))
    : defaultSkillRoots(cwd);
  const discovered = await scanSkillRoots(skillRoots);

  await appendEvent(logFile, {
    event: "task_start",
    runId,
    harness: options.harness || "unknown",
    cwd,
  });

  for (const skill of discovered) {
    await appendEvent(logFile, {
      event: "skill_discovered",
      runId,
      skill,
    });
  }

  printJson({ runId, logFile, discoveredCount: discovered.length });
}

async function recordSkillCall(options) {
  const runId = required(options, "run-id");
  const skill = required(options, "skill");
  const cwd = path.resolve(options.cwd || process.cwd());
  const event = await appendEvent(logPath(runId, cwd), {
    event: "skill_called",
    runId,
    skill,
    evidence: options.evidence || "self_reported",
    reason: options.reason || "",
  });
  printJson({ recorded: true, event });
}

async function recordNote(options) {
  const runId = required(options, "run-id");
  const cwd = path.resolve(options.cwd || process.cwd());
  const event = await appendEvent(logPath(runId, cwd), {
    event: "audit_note",
    runId,
    note: required(options, "note"),
  });
  printJson({ recorded: true, event });
}

async function finishRun(options) {
  const runId = required(options, "run-id");
  const cwd = path.resolve(options.cwd || process.cwd());
  const event = await appendEvent(logPath(runId, cwd), {
    event: "task_end",
    runId,
  });
  printJson({ recorded: true, event });
}

async function writeReport(options) {
  const runId = required(options, "run-id");
  const cwd = path.resolve(options.cwd || process.cwd());
  const events = await readEvents(logPath(runId, cwd));
  const summary = summarizeRun(events);
  const markdown = renderChineseMarkdownReport(summary);
  const output = path.resolve(cwd, options.output || path.join(auditHome(cwd), "reports", `${runId}.md`));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, markdown);
  printJson({ output });
}

async function installOpenCode(options) {
  const config = path.resolve(options.config || defaultOpenCodeConfigPath());
  const plugin = options.plugin || (await packageNameForInstall());
  runCommand(process.execPath, [
    path.join(pluginRoot, "scripts", "update-opencode-config.mjs"),
    "--config",
    config,
    "--plugin",
    plugin,
  ]);
}

async function packageNameForInstall() {
  const explicit = process.env.SKILL_LEDGER_PACKAGE_NAME?.trim();
  if (explicit) return explicit;

  try {
    const pkg = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8"));
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
  } catch {
    // Fall back to the public package name when package metadata is unavailable.
  }

  return "skill-ledger";
}

function installCodex(options) {
  if (process.platform !== "win32") {
    throw new Error("install-codex currently uses the bundled PowerShell installer and is supported on Windows.");
  }

  const script = path.join(pluginRoot, "scripts", "install-codex.ps1");
  const args = ["-ExecutionPolicy", "Bypass", "-File", script];
  if (options["plugin-root"]) args.push("-PluginRoot", path.resolve(options["plugin-root"]));
  if (options.marketplace) args.push("-MarketplacePath", path.resolve(options.marketplace));
  if (options["skip-codex-add"] === "true") args.push("-SkipCodexAdd");
  runCommand("powershell", args);
}

function logPath(runId, cwd) {
  return path.join(auditHome(cwd), "runs", `${runId}.jsonl`);
}

function auditHome(cwd) {
  return process.env.SKILL_LEDGER_HOME || process.env.SKILL_AUDIT_HOME || path.join(cwd, ".skill-ledger");
}

function defaultOpenCodeConfigPath() {
  if (process.env.OPENCODE_CONFIG_DIR) return path.join(process.env.OPENCODE_CONFIG_DIR, "opencode.json");
  return path.join(homedir(), ".config", "opencode", "opencode.json");
}

function defaultSkillRoots(cwd) {
  const home = homedir();
  return [
    path.join(pluginRoot, "skills"),
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".opencode", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".config", "opencode", "skills"),
  ];
}

function arrayOption(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function required(options, name) {
  if (!options[name]) throw new Error(`Missing required option --${name}`);
  return options[name];
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? "true" : argv[++index];
    if (parsed[key]) parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], value] : [parsed[key], value];
    else parsed[key] = value;
  }
  return parsed;
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function runCommand(commandName, commandArgs) {
  const result = spawnSync(commandName, commandArgs, {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function usage(exitCode) {
  console.error(`Usage:
  node scripts/skill-ledger.mjs start --run-id <id> --harness <name> --cwd <path> --skills <skills-dir>
  node scripts/skill-ledger.mjs call --run-id <id> --skill <name> [--evidence self_reported] [--reason <text>]
  node scripts/skill-ledger.mjs note --run-id <id> --note <text>
  node scripts/skill-ledger.mjs finish --run-id <id>
  node scripts/skill-ledger.mjs report --run-id <id> [--output <report.md>]
  node scripts/skill-ledger.mjs install-opencode [--config <opencode.json>] [--plugin <plugin-spec>]
  node scripts/skill-ledger.mjs install-codex [--marketplace <marketplace.json>] [--skip-codex-add]`);
  process.exit(exitCode);
}
