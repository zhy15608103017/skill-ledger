import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export async function writeActiveRun({ auditHome, harness, runId, logFile, cwd, sessionId = "", privacyMode = "balanced" }) {
  const filePath = activeRunPath(auditHome, harness, sessionId || runId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        harness,
        runId,
        logFile,
        cwd,
        sessionId,
        privacyMode,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

export async function readActiveRun({ auditHome, harness, sessionId = "", cwd = "" }) {
  const matching = (await listActiveRuns(auditHome)).filter((run) => {
    if (run.harness !== harness) return false;
    if (cwd && run.cwd && !samePath(run.cwd, cwd)) return false;
    return true;
  });
  const candidates = [];
  for (const run of matching) {
    if (await isFinishedRun(run.logFile)) continue;
    candidates.push(run);
  }

  if (sessionId) {
    const exact = candidates.filter((run) => run.sessionId === sessionId);
    if (exact.length === 1) return exact[0];
    return null;
  }

  // Without a host session id, only accept an unambiguous run. Dropping an
  // event is safer than attributing it to the wrong concurrent conversation.
  return candidates.length === 1 ? candidates[0] : null;
}

async function isFinishedRun(logFile) {
  if (!logFile) return true;
  try {
    const content = await readFile(logFile, "utf8");
    return content.includes('"event":"task_end"');
  } catch {
    return true;
  }
}

export async function clearActiveRun({ auditHome, runId = "", harness = "", sessionId = "" }) {
  const runs = await listActiveRuns(auditHome);
  const matches = runs.filter((run) => {
    if (runId && run.runId !== runId) return false;
    if (harness && run.harness !== harness) return false;
    if (sessionId && run.sessionId !== sessionId) return false;
    return Boolean(runId || harness || sessionId);
  });

  for (const run of matches) {
    try {
      await unlink(run.activeFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return matches.length;
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
        sessionId: data.sessionId || "",
        privacyMode: data.privacyMode || "balanced",
        updatedAt: data.updatedAt || "",
        activeFile: path.join(dir, entry.name),
      });
    } catch {
      // Skip corrupt active-run files.
    }
  }
  return runs;
}

function activeRunPath(auditHome, harness, sessionKey) {
  const safeHarness = String(harness || "unknown").replace(/[^a-z0-9._-]+/gi, "-");
  const key = stableFileKey(sessionKey || "default");
  return path.join(auditHome, "active", `${safeHarness}--${key}.json`);
}

function stableFileKey(value) {
  const source = String(value || "default");
  const readable = source.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "session";
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 10);
  return `${readable}-${digest}`;
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(String(left || ""));
  const normalizedRight = path.resolve(String(right || ""));
  if (process.platform === "win32") return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  return normalizedLeft === normalizedRight;
}
