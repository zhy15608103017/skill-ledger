import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { readEvents } from "../core/audit-log.mjs";

const hook = path.resolve("hooks", "session-start");
const observeHook = path.resolve("hooks", "observe-skill-call");
const pluginRoot = path.resolve(".");

test("session-start hook emits Claude, Cursor, and SDK bootstrap shapes", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-hook-"));
  try {
    const claude = runHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
    });
    assert.match(claude.hookSpecificOutput.additionalContext, /You have Skill Ledger/);
    assert.match(claude.hookSpecificOutput.additionalContext, /runId:/);
    assert.match(claude.hookSpecificOutput.additionalContext, /finish --run-id/);

    const cursor = runHook({
      auditHome,
      env: { CURSOR_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "cursor" },
    });
    assert.match(cursor.additional_context, /You have Skill Ledger/);
    assert.equal(cursor.hookSpecificOutput, undefined);

    const sdk = runHook({
      auditHome,
      env: { COPILOT_CLI: "1", CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "copilot-cli" },
    });
    assert.match(sdk.additionalContext, /You have Skill Ledger/);
    assert.equal(sdk.additional_context, undefined);
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("session-start hook discovers shared environment skill roots", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-hook-env-roots-"));
  const envRoot = path.join(auditHome, "env-skills");
  const envSkillDir = path.join(envRoot, "env-hook");
  await mkdir(envSkillDir, { recursive: true });
  await writeFile(
    path.join(envSkillDir, "SKILL.md"),
    "---\nname: env-hook\ndescription: Env hook skill\n---\n# Env Hook\n",
  );

  try {
    const output = runHook({
      auditHome,
      env: {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        SKILL_LEDGER_HARNESS: "claude-code",
        SKILL_LEDGER_SKILL_ROOTS: envRoot,
      },
    });
    const runId = output.hookSpecificOutput.additionalContext.match(/runId: (\S+)/)?.[1];
    assert.ok(runId);

    const events = await readEvents(path.join(auditHome, "runs", `${runId}.jsonl`));
    assert.ok(events.some((event) => event.event === "skill_discovered" && event.skill.name === "env-hook"));
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("tool observation hook records Claude Skill tool calls as native evidence", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-claude-observe-"));
  try {
    const bootstrap = runHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
    });
    const runId = bootstrap.hookSpecificOutput.additionalContext.match(/runId: (\S+)/)?.[1];
    assert.ok(runId);

    runObserveHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
      payload: {
        hook_event_name: "PostToolUse",
        tool_name: "Skill",
        tool_input: { name: "brainstorming" },
      },
    });

    const events = await readEvents(path.join(auditHome, "runs", `${runId}.jsonl`));
    assert.ok(
      events.some(
        (event) =>
          event.event === "skill_called" &&
          event.skill === "brainstorming" &&
          event.evidence === "native_observed" &&
          /Claude Code/.test(event.reason),
      ),
    );
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("tool observation hook records object-shaped Skill tool names", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-object-tool-"));
  try {
    const bootstrap = runHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
    });
    const runId = bootstrap.hookSpecificOutput.additionalContext.match(/runId: (\S+)/)?.[1];
    assert.ok(runId);

    runObserveHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
      payload: {
        hook_event_name: "PostToolUse",
        tool: { name: "Skill" },
        tool_input: { name: "brainstorming" },
      },
    });

    const events = await readEvents(path.join(auditHome, "runs", `${runId}.jsonl`));
    assert.ok(events.some((event) => event.event === "skill_called" && event.skill === "brainstorming"));
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("tool observation hook ignores corrupt active run files", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-corrupt-active-"));
  try {
    await mkdir(path.join(auditHome, "active"), { recursive: true });
    await writeFile(path.join(auditHome, "active", "claude-code.json"), "{not-json", "utf8");

    runObserveHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
      payload: {
        hook_event_name: "PostToolUse",
        tool_name: "Skill",
        tool_input: { name: "brainstorming" },
      },
    });
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("tool observation hook ignores active runs from another cwd", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-observe-cwd-"));
  const firstCwd = path.join(auditHome, "workspace-a");
  const secondCwd = path.join(auditHome, "workspace-b");
  await mkdir(firstCwd, { recursive: true });
  await mkdir(secondCwd, { recursive: true });

  try {
    const bootstrap = runHook({
      auditHome,
      env: {
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        SKILL_LEDGER_HARNESS: "claude-code",
        SKILL_LEDGER_CWD: firstCwd,
      },
    });
    const runId = bootstrap.hookSpecificOutput.additionalContext.match(/runId: (\S+)/)?.[1];
    assert.ok(runId);

    runObserveHook({
      auditHome,
      env: { CLAUDE_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "claude-code" },
      payload: {
        cwd: secondCwd,
        hook_event_name: "PostToolUse",
        tool_name: "Skill",
        tool_input: { name: "brainstorming" },
      },
    });

    const events = await readEvents(path.join(auditHome, "runs", `${runId}.jsonl`));
    assert.equal(events.some((event) => event.event === "skill_called" && event.skill === "brainstorming"), false);
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("tool observation hook records Cursor and Copilot probe events for unknown tools", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-probe-observe-"));
  try {
    const cursor = runHook({
      auditHome,
      env: { CURSOR_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "cursor" },
    });
    const runId = cursor.additional_context.match(/runId: (\S+)/)?.[1];
    assert.ok(runId);

    runObserveHook({
      auditHome,
      env: { CURSOR_PLUGIN_ROOT: pluginRoot, SKILL_LEDGER_HARNESS: "cursor" },
      payload: {
        hook_event_name: "postToolUse",
        tool_name: "read_file",
        tool_input: { path: "README.md" },
      },
    });

    const events = await readEvents(path.join(auditHome, "runs", `${runId}.jsonl`));
    assert.ok(
      events.some(
        (event) =>
          event.event === "tool_observed" &&
          event.harness === "cursor" &&
          event.tool === "read_file" &&
          event.observation === "probe",
      ),
    );
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

test("tool observation hook records Gemini context-loaded skills", async () => {
  const auditHome = await mkdtemp(path.join(tmpdir(), "skill-ledger-gemini-observe-"));
  try {
    const start = startRun({ auditHome, harness: "gemini" });

    runObserveHook({
      auditHome,
      env: { SKILL_LEDGER_HARNESS: "gemini" },
      payload: {
        hook_event_name: "BeforeModel",
        prompt: "@./skills/using-skill-audit/SKILL.md\n---\nname: using-skill-audit\n---\n# Using Skill Ledger",
      },
    });

    const events = await readEvents(start.logFile);
    assert.ok(
      events.some(
        (event) =>
          event.event === "skill_called" &&
          event.skill === "using-skill-audit" &&
          event.evidence === "context_observed" &&
          /context/i.test(event.reason),
      ),
    );
  } finally {
    await rm(auditHome, { recursive: true, force: true });
  }
});

function runHook({ auditHome, env }) {
  const result = spawnSync(process.execPath, [hook], {
    cwd: pluginRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      SKILL_LEDGER: "",
      SKILL_LEDGER_SKILL_ROOTS: "",
      SKILL_LEDGER_SKILLS: "",
      ...env,
      SKILL_LEDGER_HOME: auditHome,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runObserveHook({ auditHome, env, payload }) {
  const result = spawnSync(process.execPath, [observeHook], {
    cwd: pluginRoot,
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: {
      ...process.env,
      SKILL_LEDGER: "",
      SKILL_LEDGER_SKILL_ROOTS: "",
      SKILL_LEDGER_SKILLS: "",
      ...env,
      SKILL_LEDGER_HOME: auditHome,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function startRun({ auditHome, harness }) {
  const result = spawnSync(
    process.execPath,
    [path.resolve("scripts", "skill-ledger.mjs"), "start", "--harness", harness, "--cwd", pluginRoot],
    {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SKILL_LEDGER: "",
        SKILL_LEDGER_SKILL_ROOTS: "",
        SKILL_LEDGER_SKILLS: "",
        SKILL_LEDGER_HOME: auditHome,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
