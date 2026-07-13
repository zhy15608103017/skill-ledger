import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readEvents } from "../core/audit-log.mjs";
import { AUDIT_BOOTSTRAP_MARKER } from "../core/bootstrap.mjs";
import { SkillLedgerPlugin } from "../.opencode/plugins/skill-ledger.js";

test("OpenCode adapter registers skills, injects bootstrap, and starts a run", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-opencode-"));
  const auditHome = path.join(cwd, ".skill-ledger");
  const previousHome = process.env.SKILL_LEDGER_HOME;
  process.env.SKILL_LEDGER_HOME = auditHome;

  try {
    const plugin = await SkillLedgerPlugin({ directory: cwd });
    const config = { skills: { paths: [] } };
    await plugin.config(config);

    assert.ok(config.skills.paths.some((item) => item.endsWith(path.join("skill-ledger", "skills"))));

    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    };

    await plugin["experimental.chat.messages.transform"]({ sessionID: "open-session" }, output);

    assert.match(output.messages[0].parts[0].text, new RegExp(AUDIT_BOOTSTRAP_MARKER));
    assert.match(output.messages[0].parts[0].text, /^<EXTREMELY_IMPORTANT>\nYou have Skill Ledger\./);
    assert.match(output.messages[0].parts[0].text, /ALREADY LOADED/);
    assert.match(output.messages[0].parts[0].text, /Tool Mapping for OpenCode/);
    assert.doesNotMatch(output.messages[0].parts[0].text, /<SKILL_AUDIT>/);
    assert.doesNotMatch(output.messages[0].parts[0].text, /^---$/m);
    assert.match(output.messages[0].parts[0].text, /# Using Skill Ledger/);
    assert.match(output.messages[0].parts[0].text, /BEFORE any response or action/);

    const runFiles = await readdir(path.join(auditHome, "runs"));
    assert.equal(runFiles.length, 1);
    const events = await readEvents(path.join(auditHome, "runs", runFiles[0]));
    assert.equal(events[0].event, "task_start");
    assert.equal(events[0].sessionId, "open-session");
    assert.equal(events[0].taskContext, "hello");
    assert.ok(events.some((event) => event.event === "skill_discovered" && event.skill.name === "using-skill-audit"));
    assert.ok(events.some((event) => event.event === "skill_called" && event.skill === "using-skill-audit" && event.evidence === "context_observed"));
  } finally {
    if (previousHome === undefined) delete process.env.SKILL_LEDGER_HOME;
    else process.env.SKILL_LEDGER_HOME = previousHome;
  }
});

test("OpenCode adapter records native skill tool calls", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-opencode-native-"));
  const auditHome = path.join(cwd, ".skill-ledger");
  const previousHome = process.env.SKILL_LEDGER_HOME;
  process.env.SKILL_LEDGER_HOME = auditHome;

  try {
    const plugin = await SkillLedgerPlugin({ directory: cwd });
    await plugin.config({ skills: { paths: [] } });

    await plugin["tool.execute.after"]({ tool: "skill", sessionID: "native-session" }, { args: { name: "brainstorming" } });

    const runFiles = await readdir(path.join(auditHome, "runs"));
    assert.equal(runFiles.length, 1);
    const events = await readEvents(path.join(auditHome, "runs", runFiles[0]));
    assert.ok(
      events.some(
        (event) =>
          event.event === "skill_called" &&
          event.skill === "brainstorming" &&
          event.evidence === "native_observed" &&
          /OpenCode/.test(event.reason),
      ),
    );
  } finally {
    if (previousHome === undefined) delete process.env.SKILL_LEDGER_HOME;
    else process.env.SKILL_LEDGER_HOME = previousHome;
  }
});

test("OpenCode adapter isolates sessions and writes a report on session deletion", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-opencode-sessions-"));
  const auditHome = path.join(cwd, ".skill-ledger");
  const previousHome = process.env.SKILL_LEDGER_HOME;
  process.env.SKILL_LEDGER_HOME = auditHome;

  try {
    const plugin = await SkillLedgerPlugin({ directory: cwd });
    await plugin.config({ skills: { paths: [] } });
    const first = { messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "first task" }] }] };
    const second = { messages: [{ info: { role: "user" }, parts: [{ type: "text", text: "second task" }] }] };
    await plugin["experimental.chat.messages.transform"]({ sessionID: "session-one" }, first);
    await plugin["experimental.chat.messages.transform"]({ sessionID: "session-two" }, second);
    await plugin["tool.execute.after"]({ tool: "skill", sessionID: "session-two" }, { args: { name: "brainstorming" } });

    const runFiles = (await readdir(path.join(auditHome, "runs"))).sort();
    assert.equal(runFiles.length, 2);
    const runEvents = await Promise.all(runFiles.map((file) => readEvents(path.join(auditHome, "runs", file))));
    const firstEvents = runEvents.find((events) => events[0].sessionId === "session-one");
    const secondEvents = runEvents.find((events) => events[0].sessionId === "session-two");
    assert.equal(firstEvents.some((event) => event.skill === "brainstorming"), false);
    assert.equal(secondEvents.some((event) => event.skill === "brainstorming" && event.evidence === "native_observed"), true);

    await plugin["tool.execute.after"]({ tool: "skill" }, { args: { name: "unattributed-skill" } });
    const afterUnattributed = await Promise.all(runFiles.map((file) => readEvents(path.join(auditHome, "runs", file))));
    assert.equal(afterUnattributed.some((events) => events.some((event) => event.skill === "unattributed-skill")), false);

    await plugin.event({ event: { type: "session.deleted", properties: { info: { id: "session-two" } } } });
    const secondRunId = secondEvents[0].runId;
    assert.match(await readFile(path.join(auditHome, "reports", `${secondRunId}.md`), "utf8"), /任务上下文：已记录/);
    const activeFiles = await readdir(path.join(auditHome, "active"));
    assert.equal(activeFiles.length, 1);

    await plugin["tool.execute.after"]({ tool: "skill", sessionID: "session-two" }, { args: { name: "late-skill" } });
    await plugin.event({ event: { type: "session.deleted", properties: { info: { id: "session-two" } } } });
    assert.equal((await readdir(path.join(auditHome, "runs"))).length, 2);
    const endedEvents = await readEvents(path.join(auditHome, "runs", `${secondRunId}.jsonl`));
    assert.equal(endedEvents.some((event) => event.skill === "late-skill"), false);
    assert.equal(endedEvents.filter((event) => event.event === "task_end").length, 1);
  } finally {
    if (previousHome === undefined) delete process.env.SKILL_LEDGER_HOME;
    else process.env.SKILL_LEDGER_HOME = previousHome;
  }
});

test("OpenCode adapter discovers shared environment skill roots", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-opencode-env-roots-"));
  const auditHome = path.join(cwd, ".skill-ledger");
  const envRoot = path.join(cwd, "env-skills");
  const envSkillDir = path.join(envRoot, "env-opencode");
  const previousHome = process.env.SKILL_LEDGER_HOME;
  const previousRoots = process.env.SKILL_LEDGER_SKILL_ROOTS;

  await mkdir(envSkillDir, { recursive: true });
  await writeFile(
    path.join(envSkillDir, "SKILL.md"),
    "---\nname: env-opencode\ndescription: Env OpenCode skill\n---\n# Env OpenCode\n",
  );

  try {
    process.env.SKILL_LEDGER_HOME = auditHome;
    process.env.SKILL_LEDGER_SKILL_ROOTS = envRoot;

    const plugin = await SkillLedgerPlugin({ directory: cwd });
    await plugin.config({ skills: { paths: [] } });

    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    };

    await plugin["experimental.chat.messages.transform"]({}, output);

    const runFiles = await readdir(path.join(auditHome, "runs"));
    const events = await readEvents(path.join(auditHome, "runs", runFiles[0]));
    assert.ok(events.some((event) => event.event === "skill_discovered" && event.skill.name === "env-opencode"));
  } finally {
    if (previousHome === undefined) delete process.env.SKILL_LEDGER_HOME;
    else process.env.SKILL_LEDGER_HOME = previousHome;
    if (previousRoots === undefined) delete process.env.SKILL_LEDGER_SKILL_ROOTS;
    else process.env.SKILL_LEDGER_SKILL_ROOTS = previousRoots;
  }
});

test("OpenCode adapter honors SKILL_LEDGER=off", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "skill-ledger-opencode-off-"));
  const auditHome = path.join(cwd, ".skill-ledger");
  const previousHome = process.env.SKILL_LEDGER_HOME;
  const previousEnabled = process.env.SKILL_LEDGER;
  process.env.SKILL_LEDGER_HOME = auditHome;
  process.env.SKILL_LEDGER = "off";

  try {
    const plugin = await SkillLedgerPlugin({ directory: cwd });
    await plugin.config({ skills: { paths: [] } });

    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    };

    await plugin["experimental.chat.messages.transform"]({}, output);
    await plugin["tool.execute.after"]({ tool: "skill" }, { args: { name: "brainstorming" } });

    assert.equal(output.messages[0].parts.length, 1);
    assert.equal(output.messages[0].parts[0].text, "hello");
    await assert.rejects(readdir(path.join(auditHome, "runs")), { code: "ENOENT" });
  } finally {
    if (previousHome === undefined) delete process.env.SKILL_LEDGER_HOME;
    else process.env.SKILL_LEDGER_HOME = previousHome;
    if (previousEnabled === undefined) delete process.env.SKILL_LEDGER;
    else process.env.SKILL_LEDGER = previousEnabled;
  }
});
