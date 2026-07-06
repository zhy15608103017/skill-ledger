import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function appendEvent(logFile, event) {
  await mkdir(path.dirname(logFile), { recursive: true });
  const entry = {
    time: new Date().toISOString(),
    ...event,
  };
  await writeFile(logFile, `${JSON.stringify(entry)}\n`, { flag: "a" });
  return entry;
}

export async function readEvents(logFile) {
  try {
    const content = await readFile(logFile, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function summarizeRun(events) {
  const discoveredByName = new Map();
  const calledByName = new Map();
  const notes = [];
  let runId = "";
  let harness = "";
  let cwd = "";
  let startedAt = "";
  let finishedAt = "";

  for (const event of events) {
    if (event.runId && !runId) runId = event.runId;
    if (event.event === "task_start") {
      harness = event.harness || harness;
      cwd = event.cwd || cwd;
      startedAt = event.time || startedAt;
    }
    if (event.event === "task_end") finishedAt = event.time || finishedAt;
    if (event.event === "audit_note" && event.note) notes.push(event.note);
    if (event.event === "skill_discovered" && event.skill?.name) {
      discoveredByName.set(event.skill.name, event.skill);
    }
    if (event.event === "skill_called") {
      const name = typeof event.skill === "string" ? event.skill : event.skill?.name;
      if (!name) continue;
      const discovered = discoveredByName.get(name) || {};
      if (!calledByName.has(name)) {
        calledByName.set(name, {
          name,
          description: discovered.description || event.skill?.description || "",
          source: discovered.source || event.skill?.source || "",
          evidence: event.evidence || "self_reported",
          firstUsedAt: event.time || "",
          reason: event.reason || "",
        });
      }
    }
  }

  const discoveredSkills = [...discoveredByName.values()].sort(compareSkills);
  const calledSkills = [...calledByName.values()].sort(compareSkills);
  const calledNames = new Set(calledSkills.map((skill) => skill.name));
  const notCalledSkills = discoveredSkills.filter((skill) => !calledNames.has(skill.name));

  return {
    runId,
    harness,
    cwd,
    startedAt,
    finishedAt,
    discoveredSkills,
    calledSkills,
    notCalledSkills,
    notes,
  };
}

function compareSkills(left, right) {
  const leftSource = left.source || "";
  const rightSource = right.source || "";
  if (leftSource !== rightSource) return leftSource.localeCompare(rightSource);
  return left.name.localeCompare(right.name);
}
