import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeActiveRun({ auditHome, harness, runId, logFile, cwd }) {
  const filePath = activeRunPath(auditHome, harness);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        harness,
        runId,
        logFile,
        cwd,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

export async function readActiveRun({ auditHome, harness }) {
  try {
    return JSON.parse(await readFile(activeRunPath(auditHome, harness), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function activeRunPath(auditHome, harness) {
  const safeHarness = String(harness || "unknown").replace(/[^a-z0-9._-]+/gi, "-");
  return path.join(auditHome, "active", `${safeHarness}.json`);
}
