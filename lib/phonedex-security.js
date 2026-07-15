"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SECURITY_AUDIT_SCHEMA = "phonedex.security-audit.v1";
const SECURITY_AUDIT_FILE = "security-audit.jsonl";

function createRequestRateLimiter({ limit = 120, windowMs = 60_000 } = {}) {
  const entries = new Map();
  const boundedLimit = Number.isInteger(limit) && limit > 0 ? limit : 120;
  const boundedWindowMs = Number.isInteger(windowMs) && windowMs > 0 ? windowMs : 60_000;

  return {
    consume(key, now = Date.now()) {
      const normalizedKey = String(key || "anonymous");
      const current = entries.get(normalizedKey);
      const timestamps = current && now - current.startedAt < boundedWindowMs
        ? current.timestamps.filter((timestamp) => now - timestamp < boundedWindowMs)
        : [];
      const startedAt = current && timestamps.length > 0 ? current.startedAt : now;
      const allowed = timestamps.length < boundedLimit;
      if (allowed) timestamps.push(now);
      entries.set(normalizedKey, { startedAt, timestamps });

      const retryAfterMs = Math.max(
        0,
        (timestamps[0] || now) + boundedWindowMs - now
      );
      return {
        allowed,
        remaining: Math.max(0, boundedLimit - timestamps.length),
        retryAfterMs
      };
    }
  };
}

function appendSecurityAudit(dataDir, event = {}) {
  const root = path.resolve(dataDir);
  fs.mkdirSync(root, { recursive: true });
  const entry = {
    schema: SECURITY_AUDIT_SCHEMA,
    at: new Date().toISOString(),
    action: bounded(event.action, "unknown", 80),
    outcome: bounded(event.outcome, "unknown", 40),
    ...(event.identityId ? { identityId: bounded(event.identityId, "", 120) } : {}),
    ...(event.role ? { role: bounded(event.role, "", 40) } : {}),
    ...(event.route ? { route: bounded(event.route, "", 120) } : {}),
    ...(event.reason ? { reason: bounded(event.reason, "", 160) } : {})
  };
  fs.appendFileSync(
    path.join(root, SECURITY_AUDIT_FILE),
    `${JSON.stringify(entry)}\n`,
    { mode: 0o600 }
  );
  return entry;
}

function bounded(value, fallback, maxLength) {
  const normalized = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
    : "";
  return (normalized || fallback).slice(0, maxLength);
}

module.exports = {
  SECURITY_AUDIT_FILE,
  SECURITY_AUDIT_SCHEMA,
  appendSecurityAudit,
  createRequestRateLimiter
};
