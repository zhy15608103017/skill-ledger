import { readFile } from "node:fs/promises";
import path from "node:path";

export const AUDIT_BOOTSTRAP_MARKER = "The using-skill-audit skill content is included below";
export const STARTUP_SKILL_NAME = "using-skill-audit";

export async function readStartupSkillText(pluginRoot, skillName = STARTUP_SKILL_NAME) {
  return readFile(path.join(pluginRoot, "skills", skillName, "SKILL.md"), "utf8");
}

export function stripSkillFrontmatter(skillText) {
  return skillText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, "");
}

export function buildBootstrapText({ runId, pluginRoot, logFile, harness, sessionId = "", skillText = "" }) {
  const script = path.join(pluginRoot, "scripts", "skill-ledger.mjs");
  const callCommand = `node "${script}" call --run-id ${runId} --skill <skill-name> --evidence self_reported --reason "<Chinese reason for using this skill>"`;
  const finishCommand = `node "${script}" finish --run-id ${runId}`;
  const startupSkill = startupSkillForHarness(skillText, harness);
  const toolMapping = toolMappingForHarness(harness);
  const auditInstructions = auditInstructionsForHarness({ harness, callCommand, finishCommand });

  return `<EXTREMELY_IMPORTANT>
You have Skill Ledger.

**IMPORTANT: ${AUDIT_BOOTSTRAP_MARKER}. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "using-skill-audit" again - that would be redundant.**

## Active Skill Ledger Audit

- runId: ${runId}
- harness: ${harness || "unknown"}
- sessionId: ${sessionId || "unavailable"}
- logFile: ${logFile}
- pluginRoot: ${pluginRoot}

${auditInstructions}

${startupSkill}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
}

function auditInstructionsForHarness({ harness, callCommand, finishCommand }) {
  if (String(harness || "").toLowerCase() === "opencode") {
    return `This audit is already started and bound to the current OpenCode session by the plugin. Do NOT run \`skill-ledger start\` or \`skill-ledger finish\`; the plugin observes native \`skill\` calls and writes the report when the session ends.

Before using another skill, record it only when it is not loaded through OpenCode's native \`skill\` tool:

\`\`\`bash
${callCommand}
\`\`\``;
  }

  return `Record every other skill before using it:

\`\`\`bash
${callCommand}
\`\`\`

Finish the audit and generate the Chinese Markdown report at the end of the task:

\`\`\`bash
${finishCommand}
\`\`\``;
}

function startupSkillForHarness(skillText, harness) {
  const startupSkill = stripSkillFrontmatter(skillText).trim();
  if (String(harness || "").toLowerCase() !== "opencode") return startupSkill;

  return startupSkill
    .replace(/## Startup Rule\r?\n[\s\S]*?(?=## Before Other Skills)/, "## OpenCode Session\n\nThe plugin already created this audit run for the current session. Reuse its `runId`; do not create another run.\n\n")
    .replace(/## Finish\r?\n[\s\S]*?(?=## Privacy and Retention)/, "");
}

export function toolMappingForHarness(harness = "unknown") {
  const normalized = String(harness || "unknown").toLowerCase();

  if (normalized === "opencode") {
    return `**Tool Mapping for OpenCode:**
When skills request actions, substitute OpenCode equivalents:
- Create or update todos -> \`todowrite\`
- \`Subagent (general-purpose):\` -> \`task\` with \`subagent_type: "general"\`
- Invoke a skill -> OpenCode's native \`skill\` tool
- Read files -> \`read\`
- Create, edit, or delete files -> \`apply_patch\`
- Run shell commands -> \`bash\`
- Search files -> \`grep\`, \`glob\`
- Fetch a URL -> \`webfetch\`

Use OpenCode's native \`skill\` tool to list and load skills.`;
  }

  if (["claude-code", "cursor", "copilot-cli"].includes(normalized)) {
    return `**Tool Mapping for ${displayHarnessName(normalized)}:**
When Skill Ledger asks for actions, use the host's native coding tools:
- Invoke a skill -> use the native \`Skill\` or \`skill\` tool when available.
- Read files -> use the host file-read tool.
- Create, edit, or delete files -> use the host edit/apply-patch tool.
- Run shell commands -> use the host shell/terminal tool.
- Search files -> use the host grep/glob/search tools.
- Fetch a URL or search the web -> use the host web tools when available.
- Track tasks -> use the host todo/task-list tool when available; otherwise maintain a short checklist in the conversation or a plan file.`;
  }

  if (normalized === "pi") {
    return `**Tool Mapping for Pi:**
Pi exposes Skill Ledger skills through its native resource discovery. If there is no native Skill tool, load a matching skill by reading its \`SKILL.md\` file. Use Pi's \`read\`, \`write\`, \`edit\`, \`bash\`, \`grep\`, \`find\`, and \`ls\` tools for the corresponding file, shell, and search actions.`;
  }

  return `**Tool Mapping for ${displayHarnessName(normalized)}:**
Use the host's native skill, file, shell, search, and task tools for the actions described by Skill Ledger. If the host has no native skill invocation tool, load the relevant skill by reading its \`SKILL.md\` file.`;
}

function displayHarnessName(harness) {
  const names = {
    "claude-code": "Claude Code",
    "copilot-cli": "GitHub Copilot CLI",
    cursor: "Cursor",
    opencode: "OpenCode",
    pi: "Pi",
  };
  return names[harness] || harness;
}
