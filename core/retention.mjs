import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { listActiveRuns } from "./active-run.mjs";

export async function pruneAuditData(auditHome, { retentionDays = 0, now = Date.now() } = {}) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { enabled: false, retentionDays: 0, removedRuns: 0, removedReports: 0 };
  }

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const activeLogs = new Set((await listActiveRuns(auditHome)).map((run) => normalizePath(run.logFile)).filter(Boolean));
  const removedRuns = await pruneDirectory(path.join(auditHome, "runs"), cutoff, (filePath) => !activeLogs.has(normalizePath(filePath)));
  const removedReports = await pruneDirectory(path.join(auditHome, "reports"), cutoff);
  return { enabled: true, retentionDays, removedRuns, removedReports };
}

async function pruneDirectory(directory, cutoff, shouldRemove = () => true) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(directory, entry.name);
    if (!shouldRemove(filePath)) continue;
    const details = await stat(filePath);
    if (details.mtimeMs >= cutoff) continue;
    await unlink(filePath);
    removed += 1;
  }
  return removed;
}

function normalizePath(value) {
  if (!value) return "";
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
