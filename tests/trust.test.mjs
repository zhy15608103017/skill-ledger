import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { clearActiveRun, readActiveRun, writeActiveRun } from "../core/active-run.mjs";
import { appendEvent } from "../core/audit-log.mjs";
import { observedPayloadMetadata, observedPayloadText, sanitizeTaskContext } from "../core/privacy.mjs";
import { pruneAuditData } from "../core/retention.mjs";

test("active runs are session-scoped and ambiguous events are dropped", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-active-"));
  const cwd = path.join(auditHome, "repo");
  const firstLog = path.join(auditHome, "runs", "first.jsonl");
  const secondLog = path.join(auditHome, "runs", "second.jsonl");
  await appendEvent(firstLog, { event: "task_start", runId: "first", harness: "claude-code", cwd, sessionId: "session-a" });
  await appendEvent(secondLog, { event: "task_start", runId: "second", harness: "claude-code", cwd, sessionId: "session-b" });
  await writeActiveRun({ auditHome, harness: "claude-code", runId: "first", logFile: firstLog, cwd, sessionId: "session-a" });
  await writeActiveRun({ auditHome, harness: "claude-code", runId: "second", logFile: secondLog, cwd, sessionId: "session-b" });

  assert.equal(await readActiveRun({ auditHome, harness: "claude-code", cwd }), null);
  assert.equal((await readActiveRun({ auditHome, harness: "claude-code", cwd, sessionId: "session-b" })).runId, "second");

  const unboundLog = path.join(auditHome, "runs", "unbound.jsonl");
  await appendEvent(unboundLog, { event: "task_start", runId: "unbound", harness: "claude-code", cwd });
  await writeActiveRun({ auditHome, harness: "claude-code", runId: "unbound", logFile: unboundLog, cwd });
  assert.equal(await readActiveRun({ auditHome, harness: "claude-code", cwd, sessionId: "unknown-session" }), null);

  await appendEvent(secondLog, { event: "task_end", runId: "second" });
  assert.equal(await readActiveRun({ auditHome, harness: "claude-code", cwd, sessionId: "session-b" }), null);
  assert.equal(await clearActiveRun({ auditHome, runId: "second" }), 1);
});

test("a provided session id never falls back to an unbound active run", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-unbound-"));
  const cwd = path.join(auditHome, "repo");
  const logFile = path.join(auditHome, "runs", "unbound.jsonl");
  await appendEvent(logFile, { event: "task_start", runId: "unbound", harness: "claude-code", cwd });
  await writeActiveRun({ auditHome, harness: "claude-code", runId: "unbound", logFile, cwd });
  assert.equal(await readActiveRun({ auditHome, harness: "claude-code", cwd, sessionId: "first-observed-session" }), null);
});

test("balanced privacy redacts task context and avoids tool text persistence", () => {
  const context = sanitizeTaskContext("Fix auth password=super-secret with sk-abcdefghijklmnopqrstuvwxyz", { mode: "balanced" });
  assert.match(context, /password=\[REDACTED\]/);
  assert.doesNotMatch(context, /super-secret|sk-abcdefghijklmnopqrstuvwxyz/);
  assert.equal(sanitizeTaskContext("private request", { mode: "strict" }), "");

  const payload = { tool_input: { path: "src/auth.ts", apiKey: "sk-abcdefghijklmnopqrstuvwxyz" } };
  assert.equal(observedPayloadText(payload, { mode: "balanced" }), "");
  assert.match(observedPayloadText(payload, { mode: "diagnostic" }), /\[REDACTED_TOKEN\]/);
  assert.deepEqual(observedPayloadMetadata(payload).inputKeys, ["apiKey", "path"]);

  for (const secret of [
    "Authorization: Bearer secret-token",
    "authorization=Bearer secret-token",
    "Proxy-Authorization: Basic dXNlcjpwYXNz",
    "Bearer standalone-secret",
  ]) {
    const redacted = sanitizeTaskContext(secret, { mode: "balanced" });
    assert.match(redacted, /\[REDACTED\]/);
    assert.doesNotMatch(redacted, /secret-token|dXNlcjpwYXNz|standalone-secret/);
  }
});

test("retention removes expired inactive data but preserves active logs", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-retention-"));
  const runsDir = path.join(auditHome, "runs");
  const reportsDir = path.join(auditHome, "reports");
  await mkdir(runsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  const activeLog = path.join(runsDir, "active.jsonl");
  const oldLog = path.join(runsDir, "old.jsonl");
  const oldReport = path.join(reportsDir, "old.md");
  await writeFile(activeLog, '{"event":"task_start"}\n');
  await writeFile(oldLog, '{"event":"task_end"}\n');
  await writeFile(oldReport, "old report");
  const oldTime = new Date("2020-01-01T00:00:00Z");
  await utimes(activeLog, oldTime, oldTime);
  await utimes(oldLog, oldTime, oldTime);
  await utimes(oldReport, oldTime, oldTime);
  await writeActiveRun({ auditHome, harness: "codex", runId: "active", logFile: activeLog, cwd: auditHome, sessionId: "active-session" });

  const result = await pruneAuditData(auditHome, { retentionDays: 7, now: Date.parse("2026-07-13T00:00:00Z") });
  assert.equal(result.removedRuns, 1);
  assert.equal(result.removedReports, 1);
  assert.match(await readFile(activeLog, "utf8"), /task_start/);
  await assert.rejects(access(oldLog), { code: "ENOENT" });
  await assert.rejects(access(oldReport), { code: "ENOENT" });
});
