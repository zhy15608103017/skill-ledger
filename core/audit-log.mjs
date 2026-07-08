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
      const rawName = typeof event.skill === "string" ? event.skill : event.skill?.name;
      if (!rawName) continue;
      const name = canonicalSkillName(rawName, discoveredByName);
      const discovered = discoveredByName.get(name) || {};
      const current = {
        name,
        description: discovered.description || event.skill?.description || "",
        source: discovered.source || event.skill?.source || "",
        evidence: event.evidence || "self_reported",
        firstUsedAt: event.time || "",
        reason: event.reason || "",
      };
      if (!calledByName.has(name)) {
        calledByName.set(name, current);
        continue;
      }

      const existing = calledByName.get(name);
      if (evidenceRank(current.evidence) > evidenceRank(existing.evidence)) {
        existing.evidence = current.evidence;
        existing.reason = current.reason || existing.reason;
        existing.description = existing.description || current.description;
        existing.source = existing.source || current.source;
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

function evidenceRank(evidence) {
  const ranks = {
    log_inferred: 1,
    self_reported: 2,
    context_observed: 3,
    native_observed: 4,
  };
  return ranks[evidence] || 0;
}

function compareSkills(left, right) {
  const leftSource = left.source || "";
  const rightSource = right.source || "";
  if (leftSource !== rightSource) return leftSource.localeCompare(rightSource);
  return left.name.localeCompare(right.name);
}

function canonicalSkillName(name, discoveredByName) {
  if (discoveredByName.has(name)) return name;

  const suffix = String(name).includes(":") ? String(name).slice(String(name).lastIndexOf(":") + 1) : "";
  if (suffix && discoveredByName.has(suffix)) return suffix;

  return name;
}
