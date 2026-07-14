#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { appendEvent, readEvents, summarizeRun } from "../core/audit-log.mjs";
import { clearActiveRun, listActiveRuns, readActiveRun, writeActiveRun } from "../core/active-run.mjs";
import { renderChineseMarkdownReport } from "../core/report-md.mjs";
import { privacySettings, sanitizeTaskContext } from "../core/privacy.mjs";
import { pruneAuditData } from "../core/retention.mjs";
import { scanSkillRoots } from "../core/skill-scanner.mjs";
import { collectSkillRoots } from "../core/skill-roots.mjs";
import { defaultLearnedModelPath, learnFromRuns, loadLearnedModel, recordFeedback, saveLearnedModel } from "../core/learning.mjs";

const BOOLEAN_FLAGS = new Set(["only-skills", "skills-only", "no-report", "full", "task-context-stdin", "skip-codex-add", "print-only", "merge"]);
const VALUE_FLAGS = new Set([
  "run-id",
  "harness",
  "cwd",
  "skills",
  "skill",
  "evidence",
  "reason",
  "note",
  "output",
  "config",
  "plugin",
  "plugin-root",
  "marketplace",
  "plugin-spec",
  "scope",
  "limit",
  "task-context",
  "text",
  "session-id",
  "privacy",
  "retention-days",
  "startup-skill",
  "startup-evidence",
  "days",
  "model-path",
  "verdict",
]);
const KNOWN_FLAGS = new Set([...BOOLEAN_FLAGS, ...VALUE_FLAGS]);

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");

try {
  if (!command) await showQuickInstallMenu();
  else if (command === "start") await startRun(args);
  else if (command === "call") await recordSkillCall(args);
  else if (command === "note") await recordNote(args);
  else if (command === "task-context") await recordTaskContext(args);
  else if (command === "finish") await finishRun(args);
  else if (command === "report") await writeReport(args);
  else if (command === "status") await showStatus(args);
  else if (command === "runs") await listRuns(args);
  else if (command === "prune") await pruneRuns(args);
  else if (command === "install-opencode") await installOpenCode(args);
  else if (command === "install-codex") installCodex(args);
  else if (command === "install-claude") installClaude(args);
  else if (command === "learn") await learnFromHistory(args);
  else if (command === "feedback") await recordUserFeedback(args);
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
        "copilot plugin marketplace add zhy15608103017/skill-ledger",
        "copilot plugin install skill-ledger@skill-ledger",
      ]);
      return;
    }
    if (["6", "kimi", "kimi code"].includes(answer)) {
      printInstallGuidance("Kimi Code", [
        "/plugins install https://github.com/zhy15608103017/skill-ledger",
      ]);
      return;
    }
    if (answer === "7" || answer === "gemini") {
      printInstallGuidance("Gemini", [
        "gemini extensions install https://github.com/zhy15608103017/skill-ledger",
      ]);
      return;
    }
    if (answer === "8" || answer === "pi") {
      printInstallGuidance("Pi", [
        "pi install git:github.com/zhy15608103017/skill-ledger",
        "For local development: pi -e /path/to/skill-ledger",
      ]);
      return;
    }
    if (answer === "9" || answer === "antigravity" || answer === "agy") {
      printInstallGuidance("Antigravity", [
        "agy plugin install https://github.com/zhy15608103017/skill-ledger",
        "This is an install-route compatibility surface; verify with a fresh Antigravity session before treating it as fully validated.",
      ]);
      return;
    }
    if (["10", "factory", "factory droid", "droid"].includes(answer)) {
      printInstallGuidance("Factory Droid", [
        "droid plugin marketplace add https://github.com/zhy15608103017/skill-ledger",
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
  const runId = validateRunId(options["run-id"] || createRunId());
  const logFile = logPath(runId, cwd);
  const sessionId = options["session-id"] || "";
  const settings = privacySettings({
    ...process.env,
    SKILL_LEDGER_PRIVACY: options.privacy || process.env.SKILL_LEDGER_PRIVACY,
    SKILL_LEDGER_RETENTION_DAYS: options["retention-days"] || process.env.SKILL_LEDGER_RETENTION_DAYS,
  });
  const rawTaskContext = options["task-context-stdin"] === "true" ? await readStdinText() : options["task-context"];
  const retention = await pruneAuditData(auditHome(cwd), { retentionDays: settings.retentionDays });
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
    sessionId,
    privacyMode: settings.mode,
    retentionDays: settings.retentionDays,
    taskContext: sanitizeTaskContext(rawTaskContext, { mode: settings.mode }),
  });

  for (const skill of discovered) {
    await appendEvent(logFile, {
      event: "skill_discovered",
      runId,
      skill,
    });
  }

  if (options["startup-skill"]) {
    await appendEvent(logFile, {
      event: "skill_called",
      runId,
      skill: options["startup-skill"],
      evidence: options["startup-evidence"] || "self_reported",
      reason: "Skill Ledger startup workflow",
    });
  }

  await writeActiveRun({
    auditHome: auditHome(cwd),
    harness: options.harness || "unknown",
    runId,
    logFile,
    cwd,
    sessionId,
    privacyMode: settings.mode,
  });

  printJson({ runId, logFile, sessionId, privacyMode: settings.mode, retention, discoveredCount: discovered.length });
}

async function recordSkillCall(options) {
  const runId = validateRunId(required(options, "run-id"));
  const skill = required(options, "skill");
  const cwd = path.resolve(options.cwd || process.cwd());
  await assertRunOpen(runId, cwd);
  const { normalizeSkillName } = await import("../core/skill-name.mjs");
  const normalized = normalizeSkillName(skill);
  const event = await appendEvent(logPath(runId, cwd), {
    event: "skill_called",
    runId,
    skill: normalized,
    evidence: options.evidence || "self_reported",
    reason: options.reason || "",
  });
  printJson({ recorded: true, event });
}

async function recordNote(options) {
  const runId = validateRunId(required(options, "run-id"));
  const cwd = path.resolve(options.cwd || process.cwd());
  await assertRunOpen(runId, cwd);
  const event = await appendEvent(logPath(runId, cwd), {
    event: "audit_note",
    runId,
    note: required(options, "note"),
  });
  printJson({ recorded: true, event });
}

async function recordTaskContext(options) {
  const runId = validateRunId(required(options, "run-id"));
  const cwd = path.resolve(options.cwd || process.cwd());
  const events = await assertRunOpen(runId, cwd);
  const mode = events.find((event) => event.event === "task_start")?.privacyMode || "balanced";
  const event = await appendEvent(logPath(runId, cwd), {
    event: "task_context",
    runId,
    text: sanitizeTaskContext(required(options, "text"), { mode }),
  });
  printJson({ recorded: true, event });
}

async function finishRun(options) {
  const runId = validateRunId(required(options, "run-id"));
  const cwd = path.resolve(options.cwd || process.cwd());
  const events = await readEvents(logPath(runId, cwd));
  if (!events.length) throw new Error(`Unknown audit run: ${runId}`);
  const existingEnd = events.find((item) => item.event === "task_end");
  const event = existingEnd || await appendEvent(logPath(runId, cwd), { event: "task_end", runId });
  let reportOutput = "";
  try {
    if (options["no-report"] !== "true") {
      reportOutput = await writeReportFile({ runId, cwd, output: options.output, includeInventory: options.full === "true" });
    }
  } finally {
    await clearActiveRun({ auditHome: auditHome(cwd), runId });
  }
  printJson({ recorded: !existingEnd, alreadyFinished: Boolean(existingEnd), event, reportOutput: reportOutput || undefined });
}

async function writeReport(options) {
  const runId = validateRunId(required(options, "run-id"));
  const cwd = path.resolve(options.cwd || process.cwd());
  const output = await writeReportFile({ runId, cwd, output: options.output, includeInventory: options.full === "true" });
  printJson({ output });
}

async function showStatus(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const home = auditHome(cwd);
  const harness = options.harness || "unknown";
  const activeRun = await readActiveRun({ auditHome: home, harness, sessionId: options["session-id"] || "", cwd });
  const allActive = await listActiveRuns(home);
  printJson({ auditHome: home, cwd, harness, activeRun, allActive });
}

async function pruneRuns(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const days = Number(required(options, "days"));
  if (!Number.isFinite(days) || days <= 0) throw new Error("--days must be a positive number");
  printJson(await pruneAuditData(auditHome(cwd), { retentionDays: days }));
}

async function listRuns(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const home = auditHome(cwd);
  const runsDir = path.join(home, "runs");
  let entries = [];
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const runs = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".jsonl"))) {
    const logFile = path.join(runsDir, entry.name);
    const summary = summarizeRun(await readEvents(logFile));
    runs.push({
      runId: summary.runId,
      harness: summary.harness,
      startedAt: summary.startedAt,
      finishedAt: summary.finishedAt,
      discoveredCount: summary.discoveredSkills.length,
      calledCount: summary.calledSkills.length,
      notCalledCount: summary.notCalledSkills.length,
      possiblyMissedCount: summary.possiblyMissedSkills?.length || 0,
      logFile,
    });
  }
  runs.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));

  const limit = Number(options.limit);
  const limited = Number.isFinite(limit) && limit > 0 ? runs.slice(0, limit) : runs;
  printJson({ auditHome: home, count: limited.length, total: runs.length, runs: limited });
}

async function writeReportFile({ runId, cwd, output, includeInventory = false }) {
  const events = await readEvents(logPath(runId, cwd));
  if (!events.length) throw new Error(`Unknown audit run: ${runId}`);
  const learnedModel = await loadLearnedModel(defaultLearnedModelPath(cwd)).catch(() => null);
  const summary = summarizeRun(events, { learnedModel });
  const markdown = renderChineseMarkdownReport(summary, { includeInventory });
  const defaultOutput = path.join(auditHome(cwd), "reports", `${runId}.md`);
  const reportOutput = path.resolve(cwd, output || defaultOutput);
  await mkdir(path.dirname(reportOutput), { recursive: true });
  await writeFile(reportOutput, markdown);
  return reportOutput;
}

async function assertRunOpen(runId, cwd) {
  const events = await readEvents(logPath(runId, cwd));
  if (!events.length) throw new Error(`Unknown audit run: ${runId}`);
  if (events.some((event) => event.event === "task_end")) throw new Error(`Audit run is already finished: ${runId}`);
  return events;
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

function validateRunId(value) {
  const runId = String(value || "").trim();
  if (!/^[a-z0-9._-]+$/i.test(runId)) throw new Error("Invalid --run-id: use only letters, numbers, dots, underscores, and hyphens");
  return runId;
}

function readStdinText() {
  return new Promise((resolvePromise, reject) => {
    let content = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => { content += chunk; });
    input.on("end", () => resolvePromise(content));
    input.on("error", reject);
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const rawKey = item.slice(2);

    let key = rawKey;
    let inlineValue;
    const eqIndex = rawKey.indexOf("=");
    if (eqIndex >= 0) {
      key = rawKey.slice(0, eqIndex);
      inlineValue = rawKey.slice(eqIndex + 1);
    }

    if (inlineValue !== undefined) {
      setParsedValue(parsed, key, inlineValue);
      continue;
    }

    if (BOOLEAN_FLAGS.has(key)) {
      setParsedValue(parsed, key, "true");
      continue;
    }

    const next = argv[index + 1];
    if (next === undefined) {
      setParsedValue(parsed, key, "true");
    } else if (looksLikeFlag(next) && KNOWN_FLAGS.has(flagNameOf(next))) {
      setParsedValue(parsed, key, "true");
    } else {
      setParsedValue(parsed, key, next);
      index += 1;
    }
  }
  return parsed;
}

function looksLikeFlag(token) {
  return typeof token === "string" && token.startsWith("--");
}

function flagNameOf(token) {
  return token.slice(2).split("=")[0];
}

function setParsedValue(parsed, key, value) {
  if (parsed[key]) parsed[key] = Array.isArray(parsed[key]) ? [...parsed[key], value] : [parsed[key], value];
  else parsed[key] = value;
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

async function learnFromHistory(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const modelPath = options["model-path"] || defaultLearnedModelPath(cwd);
  const existing = await loadLearnedModel(modelPath).catch(() => null);
  const merge = options.merge === "true" && existing;
  const baseModel = merge ? existing : null;

  const result = await learnFromRuns(auditHome(cwd), { existingModel: baseModel });
  const saved = await saveLearnedModel(modelPath, result.model);
  printJson({
    modelPath,
    stats: result.stats,
    learnedStopwords: saved.learnedStopwords,
    learnedSynonyms: saved.learnedSynonyms,
    thresholds: saved.thresholds,
    feedbackCount: { confirmed: saved.feedback.confirmed.length, rejected: saved.feedback.rejected.length },
  });
}

async function recordUserFeedback(options) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const modelPath = options["model-path"] || defaultLearnedModelPath(cwd);
  const skill = required(options, "skill");
  const verdict = required(options, "verdict");
  if (!["confirmed", "rejected"].includes(verdict)) {
    throw new Error("--verdict must be 'confirmed' or 'rejected'");
  }

  const model = await loadLearnedModel(modelPath);
  recordFeedback(model, { skillName: skill, verdict, reason: options.reason || "" });
  await saveLearnedModel(modelPath, model);
  printJson({
    modelPath,
    skill,
    verdict,
    feedbackCount: { confirmed: model.feedback.confirmed.length, rejected: model.feedback.rejected.length },
    thresholds: model.thresholds,
  });
}

function usage(exitCode) {
  console.error(`Usage:
  node scripts/skill-ledger.mjs start --run-id <id> --harness <name> --cwd <path> [--session-id <id>] [--skills <skills-dir>] [--only-skills] [--task-context <text> | --task-context-stdin] [--privacy strict|balanced|diagnostic] [--retention-days <n>]
  node scripts/skill-ledger.mjs call --run-id <id> --skill <name> [--evidence self_reported] [--reason <text>]
  node scripts/skill-ledger.mjs note --run-id <id> --note <text>
  node scripts/skill-ledger.mjs task-context --run-id <id> --text <text>
  node scripts/skill-ledger.mjs finish --run-id <id> [--no-report] [--full] [--output <report.md>]
  node scripts/skill-ledger.mjs report --run-id <id> [--full] [--output <report.md>]
  node scripts/skill-ledger.mjs status [--harness <name>] [--session-id <id>] [--cwd <path>]
  node scripts/skill-ledger.mjs runs [--limit <n>] [--cwd <path>]
  node scripts/skill-ledger.mjs prune --days <n> [--cwd <path>]
  node scripts/skill-ledger.mjs learn [--cwd <path>] [--model-path <path>] [--merge]
  node scripts/skill-ledger.mjs feedback --skill <name> --verdict confirmed|rejected [--reason <text>] [--cwd <path>] [--model-path <path>]
  node scripts/skill-ledger.mjs install-opencode [--config <opencode.json>] [--plugin <plugin-spec>]
  node scripts/skill-ledger.mjs install-codex [--marketplace <marketplace.json>] [--skip-codex-add]
  node scripts/skill-ledger.mjs install-claude [--marketplace <marketplace.json>] [--plugin-spec <plugin@marketplace>] [--scope user|project|local] [--print-only]

Options accept --key value, --key=value, or repeated --key value for list flags.
Values that start with "--" are kept as long as they are not a recognized flag name.`);
  process.exit(exitCode);
}
