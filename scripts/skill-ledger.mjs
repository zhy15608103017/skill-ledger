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
import { writeActiveRun } from "../core/active-run.mjs";
import { renderChineseMarkdownReport } from "../core/report-md.mjs";
import { scanSkillRoots } from "../core/skill-scanner.mjs";
import { collectSkillRoots } from "../core/skill-roots.mjs";
import { formatLocalTimestampForFileName } from "../core/time-format.mjs";

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
  else if (command === "install-claude") installClaude(args);
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
  console.log("  3. Claude Code");
  console.log("  4. Cursor");
  console.log("  5. GitHub Copilot CLI");
  console.log("  6. Kimi Code");
  console.log("  7. Gemini");
  console.log("  8. Pi");
  console.log("  9. Antigravity");
  console.log("  10. Factory Droid");
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
    if (["3", "claude", "claude code"].includes(answer)) {
      installClaude({});
      return;
    }
    if (answer === "4" || answer === "cursor") {
      printInstallGuidance("Cursor", [
        "/add-plugin skill-ledger",
        "For local development, install this repository as a Cursor plugin so it can load .cursor-plugin/plugin.json.",
      ]);
      return;
    }
    if (["5", "copilot", "github copilot", "github copilot cli", "copilot cli"].includes(answer)) {
      printInstallGuidance("GitHub Copilot CLI", [
        "copilot plugin marketplace add <owner>/skill-ledger-marketplace",
        "copilot plugin install skill-ledger@skill-ledger-marketplace",
      ]);
      return;
    }
    if (["6", "kimi", "kimi code"].includes(answer)) {
      printInstallGuidance("Kimi Code", [
        "/plugins install https://github.com/<owner>/skill-ledger",
      ]);
      return;
    }
    if (answer === "7" || answer === "gemini") {
      printInstallGuidance("Gemini", [
        "gemini extensions install https://github.com/<owner>/skill-ledger",
      ]);
      return;
    }
    if (answer === "8" || answer === "pi") {
      printInstallGuidance("Pi", [
        "pi install git:github.com/<owner>/skill-ledger",
        "For local development: pi -e /path/to/skill-ledger",
      ]);
      return;
    }
    if (answer === "9" || answer === "antigravity" || answer === "agy") {
      printInstallGuidance("Antigravity", [
        "agy plugin install https://github.com/<owner>/skill-ledger",
        "This is an install-route compatibility surface; verify with a fresh Antigravity session before treating it as fully validated.",
      ]);
      return;
    }
    if (["10", "factory", "factory droid", "droid"].includes(answer)) {
      printInstallGuidance("Factory Droid", [
        "droid plugin marketplace add https://github.com/<owner>/skill-ledger",
        "droid plugin install skill-ledger@skill-ledger",
      ]);
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

function printInstallGuidance(toolName, commands) {
  console.log(`${toolName} install guidance:`);
  for (const command of commands) console.log(`  ${command}`);
}

async function startRun(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const runId = options["run-id"] || createRunId();
  const logFile = logPath(runId, cwd);
  const configuredRoots = arrayOption(options.skills);
  const skillRoots = collectSkillRoots({
    cwd,
    pluginRoot,
    explicitRoots: configuredRoots,
    includeDefaults: options["only-skills"] !== "true" && options["skills-only"] !== "true",
  });
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

  await writeActiveRun({
    auditHome: auditHome(cwd),
    harness: options.harness || "unknown",
    runId,
    logFile,
    cwd,
  });

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
  if (options["no-report"] === "true") {
    printJson({ recorded: true, event });
    return;
  }

  const reportOutput = await writeReportFile({ runId, cwd, output: options.output });
  printJson({ recorded: true, event, reportOutput });
}

async function writeReport(options) {
  const runId = required(options, "run-id");
  const cwd = path.resolve(options.cwd || process.cwd());
  const output = await writeReportFile({ runId, cwd, output: options.output });
  printJson({ output });
}

async function writeReportFile({ runId, cwd, output }) {
  const events = await readEvents(logPath(runId, cwd));
  const summary = summarizeRun(events);
  const markdown = renderChineseMarkdownReport(summary);
  const defaultOutput = path.join(auditHome(cwd), "reports", `${formatLocalTimestampForFileName(new Date())}.md`);
  const reportOutput = path.resolve(cwd, output || defaultOutput);
  await mkdir(path.dirname(reportOutput), { recursive: true });
  await writeFile(reportOutput, markdown);
  return reportOutput;
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

function installClaude(options) {
  if (process.platform !== "win32") {
    throw new Error("install-claude currently uses the bundled PowerShell installer and is supported on Windows.");
  }

  const script = path.join(pluginRoot, "scripts", "install-claude.ps1");
  const args = ["-ExecutionPolicy", "Bypass", "-File", script];
  if (options.marketplace) args.push("-MarketplacePath", path.resolve(options.marketplace));
  if (options["plugin-spec"]) args.push("-PluginSpec", options["plugin-spec"]);
  if (options.scope) args.push("-Scope", options.scope);
  if (options["print-only"] === "true") args.push("-PrintOnly");
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
  node scripts/skill-ledger.mjs start --run-id <id> --harness <name> --cwd <path> [--skills <skills-dir>] [--only-skills]
  node scripts/skill-ledger.mjs call --run-id <id> --skill <name> [--evidence self_reported] [--reason <text>]
  node scripts/skill-ledger.mjs note --run-id <id> --note <text>
  node scripts/skill-ledger.mjs finish --run-id <id> [--no-report] [--output <report.md>]
  node scripts/skill-ledger.mjs report --run-id <id> [--output <report.md>]
  node scripts/skill-ledger.mjs install-opencode [--config <opencode.json>] [--plugin <plugin-spec>]
  node scripts/skill-ledger.mjs install-codex [--marketplace <marketplace.json>] [--skip-codex-add]
  node scripts/skill-ledger.mjs install-claude [--marketplace <marketplace.json>] [--plugin-spec <plugin@marketplace>] [--scope user|project|local] [--print-only]`);
  process.exit(exitCode);
}
