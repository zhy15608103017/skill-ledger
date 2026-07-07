import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
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

    await plugin["experimental.chat.messages.transform"]({}, output);

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
    assert.ok(events.some((event) => event.event === "skill_discovered" && event.skill.name === "using-skill-audit"));
  } finally {
    if (previousHome === undefined) delete process.env.SKILL_LEDGER_HOME;
    else process.env.SKILL_LEDGER_HOME = previousHome;
  }
});
