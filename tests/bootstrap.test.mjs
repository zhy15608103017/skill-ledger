import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { AUDIT_BOOTSTRAP_MARKER, buildBootstrapText } from "../core/bootstrap.mjs";

test("buildBootstrapText returns Chinese audit instructions with CLI commands", () => {
  const text = buildBootstrapText({
    runId: "run-1",
    pluginRoot: path.resolve("D:/github/skill-ledger"),
    logFile: "D:/repo/.skill-ledger/runs/run-1.jsonl",
    harness: "opencode",
  });

  assert.match(text, new RegExp(AUDIT_BOOTSTRAP_MARKER));
  assert.match(text, /Skills 调用审计已启动/);
  assert.match(text, /skill-ledger\.mjs"? call --run-id run-1/);
  assert.match(text, /skill-ledger\.mjs"? report --run-id run-1/);
  assert.match(text, /报告必须输出为中文 Markdown/);
});
