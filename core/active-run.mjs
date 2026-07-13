import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
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

export async function listActiveRuns(auditHome) {
  const dir = path.join(auditHome, "active");
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }

  const runs = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json"))) {
    try {
      const data = JSON.parse(await readFile(path.join(dir, entry.name), "utf8"));
      runs.push({
        harness: data.harness || entry.name.replace(/\.json$/, ""),
        runId: data.runId || "",
        logFile: data.logFile || "",
        cwd: data.cwd || "",
        updatedAt: data.updatedAt || "",
      });
    } catch {
      // Skip corrupt active-run files.
    }
  }
  return runs;
}

function activeRunPath(auditHome, harness) {
  const safeHarness = String(harness || "unknown").replace(/[^a-z0-9._-]+/gi, "-");
  return path.join(auditHome, "active", `${safeHarness}.json`);
}
