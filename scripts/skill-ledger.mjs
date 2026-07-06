#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendEvent, readEvents, summarizeRun } from "../core/audit-log.mjs";
import { renderChineseMarkdownReport } from "../core/report-md.mjs";
import { scanSkillRoots } from "../core/skill-scanner.mjs";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");

try {
  if (command === "start") await startRun(args);
  else if (command === "call") await recordSkillCall(args);
  else if (command === "note") await recordNote(args);
  else if (command === "finish") await finishRun(args);
  else if (command === "report") await writeReport(args);
  else usage(1);
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
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

function logPath(runId, cwd) {
  return path.join(auditHome(cwd), "runs", `${runId}.jsonl`);
}

function auditHome(cwd) {
  return process.env.SKILL_LEDGER_HOME || process.env.SKILL_AUDIT_HOME || path.join(cwd, ".skill-ledger");
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

function usage(exitCode) {
  console.error(`Usage:
  node scripts/skill-ledger.mjs start --run-id <id> --harness <name> --cwd <path> --skills <skills-dir>
  node scripts/skill-ledger.mjs call --run-id <id> --skill <name> [--evidence self_reported] [--reason <text>]
  node scripts/skill-ledger.mjs note --run-id <id> --note <text>
  node scripts/skill-ledger.mjs finish --run-id <id>
  node scripts/skill-ledger.mjs report --run-id <id> [--output <report.md>]`);
  process.exit(exitCode);
}
