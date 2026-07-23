import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionId, sessionIdFromValues } from "../core/session-id.mjs";

test("session ID extraction supports common host payload shapes", () => {
  assert.equal(sessionIdFromValues({ session_id: "claude-session" }), "claude-session");
  assert.equal(sessionIdFromValues({ input: { conversationId: "cursor-session" } }), "cursor-session");
  assert.equal(
    sessionIdFromValues({ event: { properties: { info: { id: "opencode-session" } } } }),
    "opencode-session",
  );
});

test("top-level session fields take precedence over nested event info IDs", () => {
  assert.equal(
    sessionIdFromValues({
      sessionId: "top-level-session",
      event: { properties: { info: { id: "nested-info-id" } } },
    }),
    "top-level-session",
  );
});

test("session ID resolution preserves explicit and payload precedence", () => {
  const env = { SKILL_LEDGER_SESSION_ID: "configured-session", CODEX_THREAD_ID: "codex-thread" };
  assert.equal(
    resolveSessionId({ harness: "codex", explicit: "explicit-session", values: [{ sessionId: "payload-session" }], env }),
    "explicit-session",
  );
  assert.equal(resolveSessionId({ harness: "codex", values: [{ sessionId: "payload-session" }], env }), "configured-session");
  assert.equal(
    resolveSessionId({ harness: "codex", values: [{ sessionId: "payload-session" }], env: { CODEX_THREAD_ID: "codex-thread" } }),
    "payload-session",
  );
});

test("Codex falls back to CODEX_THREAD_ID without inventing other host environment variables", () => {
  assert.equal(resolveSessionId({ harness: "codex", env: { CODEX_THREAD_ID: "codex-thread" } }), "codex-thread");
  assert.equal(resolveSessionId({ harness: "cursor", env: { CODEX_THREAD_ID: "codex-thread" } }), "");
});
