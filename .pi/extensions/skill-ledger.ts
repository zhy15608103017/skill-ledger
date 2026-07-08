import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { appendEvent } from "../../core/audit-log.mjs";
import { buildBootstrapText, readStartupSkillText } from "../../core/bootstrap.mjs";
import { scanSkillRoots } from "../../core/skill-scanner.mjs";
import { collectSkillRoots } from "../../core/skill-roots.mjs";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "../..");
const bootstrapMarker = "The using-skill-audit skill content is included below";

let cachedStartupSkill: string | undefined;

export default function skillLedgerPiExtension(pi: ExtensionAPI) {
  let injectBootstrap = true;
  let activeRun: { runId: string; logFile: string } | undefined;

  pi.on("resources_discover", async () => ({
    skillPaths: collectSkillRoots({ cwd: process.cwd(), pluginRoot: packageRoot }),
  }));

  pi.on("session_start", async () => {
    injectBootstrap = true;
    activeRun = undefined;
  });

  pi.on("session_compact", async () => {
    injectBootstrap = true;
  });

  pi.on("agent_end", async () => {
    injectBootstrap = false;
  });

  pi.on("context", async (event) => {
    if (!injectBootstrap) return;
    if (event.messages.some(messageContainsBootstrap)) return;

    activeRun ||= await startAuditRun();
    cachedStartupSkill ||= await readStartupSkillText(packageRoot);

    const bootstrap = buildBootstrapText({
      runId: activeRun.runId,
      pluginRoot: packageRoot,
      logFile: activeRun.logFile,
      harness: "pi",
      skillText: cachedStartupSkill,
    });

    const bootstrapMessage = {
      role: "user" as const,
      content: [{ type: "text" as const, text: bootstrap }],
      timestamp: Date.now(),
    };

    await appendEvent(activeRun.logFile, {
      event: "skill_called",
      runId: activeRun.runId,
      skill: "using-skill-audit",
      evidence: "context_observed",
      reason: "Pi context hook injected using-skill-audit Skill content",
    });

    const insertAt = firstNonCompactionSummaryIndex(event.messages);
    return {
      messages: [
        ...event.messages.slice(0, insertAt),
        bootstrapMessage,
        ...event.messages.slice(insertAt),
      ],
    };
  });
}

async function startAuditRun() {
  const cwd = process.cwd();
  const auditHome = process.env.SKILL_LEDGER_HOME || process.env.SKILL_AUDIT_HOME || resolve(cwd, ".skill-ledger");
  const runId = createRunId();
  const logFile = resolve(auditHome, "runs", `${runId}.jsonl`);
  const skills = await scanSkillRoots(collectSkillRoots({ cwd, pluginRoot: packageRoot }));

  await appendEvent(logFile, {
    event: "task_start",
    runId,
    harness: "pi",
    cwd,
  });

  for (const skill of skills) {
    await appendEvent(logFile, { event: "skill_discovered", runId, skill });
  }

  return { runId, logFile };
}

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

function messageContainsBootstrap(message: unknown): boolean {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.includes(bootstrapMarker);
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    return (
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string" &&
      (part as { text: string }).text.includes(bootstrapMarker)
    );
  });
}

function firstNonCompactionSummaryIndex(messages: unknown[]): number {
  let index = 0;
  while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") {
    index += 1;
  }
  return index;
}
