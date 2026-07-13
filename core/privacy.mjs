import { createHash } from "node:crypto";

export const PRIVACY_MODES = new Set(["strict", "balanced", "diagnostic"]);
export const DEFAULT_PRIVACY_MODE = "balanced";

export function privacySettings(env = process.env) {
  const requested = String(env.SKILL_LEDGER_PRIVACY || DEFAULT_PRIVACY_MODE).trim().toLowerCase();
  const mode = PRIVACY_MODES.has(requested) ? requested : DEFAULT_PRIVACY_MODE;
  const retentionDays = parseRetentionDays(env.SKILL_LEDGER_RETENTION_DAYS);
  return { mode, retentionDays };
}

export function sanitizeTaskContext(value, { mode = DEFAULT_PRIVACY_MODE, limit = 1200 } = {}) {
  const text = String(value || "").trim();
  if (!text || mode === "strict") return "";
  return redactSensitiveText(text).slice(0, limit);
}

export function observedPayloadMetadata(payload) {
  const keys = new Set();
  collectKeys(payload?.tool_input, keys);
  collectKeys(payload?.toolInput, keys);
  collectKeys(payload?.input, keys);
  collectKeys(payload?.args, keys);
  collectKeys(payload?.arguments, keys);
  return {
    inputKeys: [...keys].sort().slice(0, 50),
    payloadHash: stableHash(JSON.stringify(payload || {})),
  };
}

export function observedPayloadText(payload, { mode = DEFAULT_PRIVACY_MODE, limit = 2000 } = {}) {
  if (mode !== "diagnostic") return "";
  return redactSensitiveText(collectText(payload)).slice(0, limit);
}

export function redactSensitiveText(value) {
  return String(value || "")
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*[^\r\n]+/gi, "$1=[REDACTED]")
    .replace(/\b(bearer|basic)\s+[a-z0-9._~+\/-]+=*/gi, "$1 [REDACTED]")
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*(["']?)[^\s,"';]+\2/gi, "$1=[REDACTED]")
    .replace(/\b(sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9_]{16,}|github_pat_[a-z0-9_]{16,})\b/gi, "[REDACTED_TOKEN]")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[REDACTED]@")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

export function stableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function parseRetentionDays(value) {
  if (value === undefined || value === null || String(value).trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function collectKeys(value, keys, depth = 0) {
  if (!value || depth > 3) return;
  if (typeof value === "string") {
    try {
      collectKeys(JSON.parse(value), keys, depth + 1);
    } catch {
      // Opaque strings are deliberately not persisted in metadata mode.
    }
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys, depth + 1);
  }
}

function collectText(value, seen = new Set()) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => collectText(item, seen)).join("\n");
  return Object.values(value).map((item) => collectText(item, seen)).join("\n");
}
