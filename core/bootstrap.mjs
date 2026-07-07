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

export function buildBootstrapText({ runId, pluginRoot, logFile, harness, skillText = "" }) {
  const script = path.join(pluginRoot, "scripts", "skill-ledger.mjs");
  const callCommand = `node "${script}" call --run-id ${runId} --skill <skill-name> --evidence self_reported --reason "<Chinese reason for using this skill>"`;
  const reportCommand = `node "${script}" report --run-id ${runId}`;
  const startupSkill = stripSkillFrontmatter(skillText).trim();
  const toolMapping = `**Tool Mapping for OpenCode:**
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

  return `<EXTREMELY_IMPORTANT>
You have Skill Ledger.

**IMPORTANT: ${AUDIT_BOOTSTRAP_MARKER}. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "using-skill-audit" again - that would be redundant.**

## Active Skill Ledger Audit

- runId: ${runId}
- harness: ${harness || "unknown"}
- logFile: ${logFile}
- pluginRoot: ${pluginRoot}

Record every other skill before using it:

\`\`\`bash
${callCommand}
\`\`\`

Generate the Chinese Markdown report at the end of the task:

\`\`\`bash
${reportCommand}
\`\`\`

${startupSkill}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
}
