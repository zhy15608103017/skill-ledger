import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { clearActiveRun, writeActiveRun } from "../../core/active-run.mjs";
import { appendEvent, readEvents, summarizeRun } from "../../core/audit-log.mjs";
import { buildBootstrapText, readStartupSkillText } from "../../core/bootstrap.mjs";
import { defaultLearnedModelPath, loadLearnedModel } from "../../core/learning.mjs";
import { privacySettings, sanitizeTaskContext } from "../../core/privacy.mjs";
import { renderChineseMarkdownReport } from "../../core/report-md.mjs";
import { pruneAuditData } from "../../core/retention.mjs";
import { normalizeSkillName } from "../../core/skill-name.mjs";
import { scanSkillRoots } from "../../core/skill-scanner.mjs";
import { collectSkillRoots } from "../../core/skill-roots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "../..");
const pluginSkillsDir = path.join(pluginRoot, "skills");
let startupSkillTextCache;

export const SkillLedgerPlugin = async ({ directory } = {}) => {
  const workspaceDir = path.resolve(directory || process.cwd());
  const auditHome = process.env.SKILL_LEDGER_HOME || process.env.SKILL_AUDIT_HOME || path.join(workspaceDir, ".skill-ledger");
  let skillRoots = collectSkillRoots({ cwd: workspaceDir, pluginRoot });
  const runs = new Map();
  const endedSessionIds = new Set();
  const settings = privacySettings();

  async function ensureStarted({ sessionId = "", taskContext = "", allowCreate = false } = {}) {
    if (sessionId && endedSessionIds.has(sessionId)) return null;

    if (sessionId && runs.has(sessionId)) {
      const run = runs.get(sessionId);
      await recordLateTaskContext(run, taskContext, settings.mode);
      return { key: sessionId, run };
    }
    if (!sessionId) {
      const candidates = [...runs.entries()];
      if (candidates.length === 1) {
        const [key, run] = candidates[0];
        await recordLateTaskContext(run, taskContext, settings.mode);
        return { key, run };
      }
      if (candidates.length > 1 || !allowCreate) return null;
    } else if (!allowCreate) {
      return null;
    }

    const key = sessionId || `anonymous-${createRunId()}`;
    const run = await startAuditRun({ workspaceDir, auditHome, skillRoots, sessionId, taskContext, settings });
    runs.set(key, run);
    return { key, run };
  }

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      const existing = config.skills.paths.map((item) => normalizeSkillPath(item, workspaceDir)).filter(Boolean);
      skillRoots = collectSkillRoots({ cwd: workspaceDir, pluginRoot, explicitRoots: existing });
      if (!existing.some((item) => samePath(item, pluginSkillsDir))) config.skills.paths.push(pluginSkillsDir);
    },

    "experimental.chat.messages.transform": async (input, output) => {
      if (isSkillLedgerDisabled()) return;
      if (!output?.messages?.length) return;
      const firstUser = output.messages.find((message) => message.info?.role === "user");
      if (!firstUser?.parts?.length) return;
      if (firstUser.parts.some((part) => part.type === "text" && part.text?.includes("EXTREMELY_IMPORTANT"))) return;

      const sessionId = observedSessionId(input, output);
      const taskContext = firstUserText(firstUser);
      const resolved = await ensureStarted({ sessionId, taskContext, allowCreate: true });
      if (!resolved) return;
      const { run } = resolved;

      const startupSkillText = await getStartupSkillText();

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({
        ...ref,
        type: "text",
        text: buildBootstrapText({ runId: run.runId, pluginRoot, logFile: run.logFile, harness: "opencode", sessionId, skillText: startupSkillText }),
      });
      if (!run.startupRecorded) {
        await appendEvent(run.logFile, {
          event: "skill_called",
          runId: run.runId,
          skill: "using-skill-audit",
          evidence: "context_observed",
          reason: "OpenCode message transform injected using-skill-audit Skill content",
        });
        run.startupRecorded = true;
      }
    },

    "tool.execute.after": async (input, output) => {
      if (isSkillLedgerDisabled()) return;
      const skillName = observedSkillName(input, output);
      if (!skillName) return;

      const sessionId = observedSessionId(input, output);
      const resolved = await ensureStarted({ sessionId, allowCreate: Boolean(sessionId) });
      if (!resolved) return;
      const { run } = resolved;
      await appendEvent(run.logFile, {
        event: "skill_called",
        runId: run.runId,
        skill: skillName,
        evidence: "native_observed",
        reason: "OpenCode 原生 skill 工具调用事件",
      });
    },

    event: async ({ event } = {}) => {
      if (isSkillLedgerDisabled()) return;
      if (!isSessionEndEvent(event)) return;
      const sessionId = observedSessionId(event);
      if (sessionId && endedSessionIds.has(sessionId)) return;
      const key = sessionId || ([...runs.keys()].length === 1 ? [...runs.keys()][0] : "");
      if (!key) return;
      const run = runs.get(key);
      if (!run) return;
      runs.delete(key);
      if (sessionId) endedSessionIds.add(sessionId);
      try {
        await finishAuditRun({ run, auditHome, workspaceDir });
      } catch (error) {
        runs.set(key, run);
        if (sessionId) endedSessionIds.delete(sessionId);
        throw error;
      }
    },
  };
};

export default SkillLedgerPlugin;

async function startAuditRun({ workspaceDir, auditHome, skillRoots, sessionId = "", taskContext = "", settings }) {
  await pruneAuditData(auditHome, { retentionDays: settings.retentionDays });
  const runId = createRunId();
  const logFile = path.join(auditHome, "runs", `${runId}.jsonl`);
  const skills = await scanSkillRoots(skillRoots);
  const sanitizedTaskContext = sanitizeTaskContext(taskContext, { mode: settings.mode });

  await appendEvent(logFile, {
    event: "task_start",
    runId,
    harness: "opencode",
    cwd: workspaceDir,
    sessionId,
    privacyMode: settings.mode,
    retentionDays: settings.retentionDays,
    taskContext: sanitizedTaskContext,
  });

  for (const skill of skills) {
    await appendEvent(logFile, { event: "skill_discovered", runId, skill });
  }

  await writeActiveRun({ auditHome, harness: "opencode", runId, logFile, cwd: workspaceDir, sessionId, privacyMode: settings.mode });
  return { runId, logFile, sessionId, startupRecorded: false, contextRecorded: Boolean(sanitizedTaskContext) };
}

async function recordLateTaskContext(run, taskContext, privacyMode) {
  if (!taskContext || run.contextRecorded) return;
  const text = sanitizeTaskContext(taskContext, { mode: privacyMode });
  if (!text) return;
  await appendEvent(run.logFile, { event: "task_context", runId: run.runId, text, source: "opencode_first_user_message" });
  run.contextRecorded = true;
}

async function finishAuditRun({ run, auditHome, workspaceDir }) {
  const events = await readEvents(run.logFile);
  if (!events.some((event) => event.event === "task_end")) {
    await appendEvent(run.logFile, { event: "task_end", runId: run.runId });
  }
  const modelPath = defaultLearnedModelPath(workspaceDir || run.cwd || process.cwd());
  const learnedModel = await loadLearnedModel(modelPath).catch(() => null);
  const summary = summarizeRun(await readEvents(run.logFile), { learnedModel });
  const reportPath = path.join(auditHome, "reports", `${run.runId}.md`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderChineseMarkdownReport(summary), "utf8");
  await clearActiveRun({ auditHome, runId: run.runId });
}

function normalizeSkillPath(value, workspaceDir) {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("~/")) return path.join(process.env.HOME || process.env.USERPROFILE || "", value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(workspaceDir, value);
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(String(left || ""));
  const normalizedRight = path.resolve(String(right || ""));
  if (process.platform === "win32") return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  return normalizedLeft === normalizedRight;
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function observedSessionId(...values) {
  for (const value of values) {
    const id = value?.sessionID || value?.sessionId || value?.session_id || value?.conversationID || value?.conversationId ||
      value?.event?.properties?.info?.id || value?.properties?.info?.id || value?.properties?.sessionID;
    if (id) return String(id);
  }
  return "";
}

function firstUserText(message) {
  return (message?.parts || [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .slice(0, 4000);
}

function isSessionEndEvent(event) {
  const type = String(event?.type || event?.event || "").toLowerCase();
  return type === "session.deleted" || type === "session.ended";
}

function isSkillLedgerDisabled() {
  return ["0", "false", "no", "off"].includes(String(process.env.SKILL_LEDGER || "").trim().toLowerCase());
}

function observedSkillName(input, output) {
  if (toolName(input, output) !== "skill") return "";

  for (const value of possibleSkillNameValues(input, output)) {
    const name = normalizeSkillName(value);
    if (name) return name;
  }
  return "";
}

function toolName(input, output) {
  const value = input?.tool || input?.toolName || input?.name || output?.tool || output?.toolName || output?.name;
  if (typeof value === "string") return value.trim().toLowerCase();
  if (value?.name) return String(value.name).trim().toLowerCase();
  return "";
}

function possibleSkillNameValues(input, output) {
  const payloads = [
    output?.args,
    output?.arguments,
    output?.input,
    input?.args,
    input?.arguments,
    input?.input,
  ];
  return payloads.flatMap((payload) => {
    const parsed = parsePayload(payload);
    if (!parsed) return [];
    if (typeof parsed === "string") return [parsed];
    return [parsed.skill, parsed.name, parsed.skillName, parsed.id];
  });
}

function parsePayload(payload) {
  if (!payload || typeof payload !== "string") return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

async function getStartupSkillText() {
  if (startupSkillTextCache !== undefined) return startupSkillTextCache;
  startupSkillTextCache = await readStartupSkillText(pluginRoot);
  return startupSkillTextCache;
}
