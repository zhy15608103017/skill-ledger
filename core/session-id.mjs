const SESSION_ID_KEYS = [
  "sessionID",
  "sessionId",
  "session_id",
  "conversationID",
  "conversationId",
  "conversation_id",
  "threadID",
  "threadId",
  "thread_id",
  "transcriptPath",
  "transcript_path",
];

export function sessionIdFromValues(...values) {
  for (const value of values) {
    for (const candidate of sessionIdCandidates(value)) {
      const id = stringValue(candidate);
      if (id) return id;
    }
  }
  return "";
}

export function resolveSessionId({ harness = "", values = [], explicit = "", env = process.env } = {}) {
  return (
    stringValue(explicit) ||
    stringValue(env.SKILL_LEDGER_SESSION_ID) ||
    sessionIdFromValues(...values) ||
    environmentSessionId(harness, env)
  );
}

function environmentSessionId(harness, env) {
  if (String(harness || "").trim().toLowerCase() === "codex") {
    return stringValue(env.CODEX_THREAD_ID);
  }
  return "";
}

function sessionIdCandidates(value) {
  if (!value || typeof value !== "object") return [];
  const nestedInfoIds = [value.event?.properties?.info?.id, value.properties?.info?.id];
  const containers = [
    value,
    value.input,
    value.event,
    value.event?.properties,
    value.event?.properties?.info,
    value.properties,
    value.properties?.info,
  ];

  return [...containers.flatMap((container) => {
    if (!container || typeof container !== "object") return [];
    return SESSION_ID_KEYS.map((key) => container[key]);
  }), ...nestedInfoIds];
}

function stringValue(value) {
  if (value === undefined || value === null || typeof value === "object") return "";
  return String(value).trim();
}
