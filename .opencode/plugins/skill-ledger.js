import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appendEvent } from "../../core/audit-log.mjs";
import { buildBootstrapText, readStartupSkillText } from "../../core/bootstrap.mjs";
import { scanSkillRoots } from "../../core/skill-scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "../..");
const pluginSkillsDir = path.join(pluginRoot, "skills");
let startupSkillTextCache;

export const SkillLedgerPlugin = async ({ directory } = {}) => {
  const workspaceDir = path.resolve(directory || process.cwd());
  const auditHome = process.env.SKILL_LEDGER_HOME || process.env.SKILL_AUDIT_HOME || path.join(workspaceDir, ".skill-ledger");
  let skillRoots = [pluginSkillsDir];
  let started = false;
  let runId = "";
  let logFile = "";

  return {
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      const existing = config.skills.paths.map((item) => normalizeSkillPath(item, workspaceDir)).filter(Boolean);
      skillRoots = [...new Set([...existing, pluginSkillsDir])];
      if (!config.skills.paths.includes(pluginSkillsDir)) config.skills.paths.push(pluginSkillsDir);
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output?.messages?.length) return;
      const firstUser = output.messages.find((message) => message.info?.role === "user");
      if (!firstUser?.parts?.length) return;
      if (firstUser.parts.some((part) => part.type === "text" && part.text?.includes("EXTREMELY_IMPORTANT"))) return;

      if (!started) {
        const start = await startAuditRun({ workspaceDir, auditHome, skillRoots });
        runId = start.runId;
        logFile = start.logFile;
        started = true;
      }

      const startupSkillText = await getStartupSkillText();

      const ref = firstUser.parts[0];
      firstUser.parts.unshift({
        ...ref,
        type: "text",
        text: buildBootstrapText({ runId, pluginRoot, logFile, harness: "opencode", skillText: startupSkillText }),
      });
    },
  };
};

export default SkillLedgerPlugin;

async function startAuditRun({ workspaceDir, auditHome, skillRoots }) {
  const runId = createRunId();
  const logFile = path.join(auditHome, "runs", `${runId}.jsonl`);
  const skills = await scanSkillRoots(skillRoots);

  await appendEvent(logFile, {
    event: "task_start",
    runId,
    harness: "opencode",
    cwd: workspaceDir,
  });

  for (const skill of skills) {
    await appendEvent(logFile, { event: "skill_discovered", runId, skill });
  }

  return { runId, logFile };
}

function normalizeSkillPath(value, workspaceDir) {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("~/")) return path.join(process.env.HOME || process.env.USERPROFILE || "", value.slice(2));
  if (path.isAbsolute(value)) return value;
  return path.resolve(workspaceDir, value);
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

async function getStartupSkillText() {
  if (startupSkillTextCache !== undefined) return startupSkillTextCache;
  startupSkillTextCache = await readStartupSkillText(pluginRoot);
  return startupSkillTextCache;
}
