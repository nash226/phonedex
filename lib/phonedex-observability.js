"use strict";

const crypto = require("node:crypto");

const CORRELATION_HEADER = "x-phonedex-correlation-id";
const SCHEMA = "phonedex.observability.v1";

function createCorrelationId(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(candidate)) return candidate;
  return `px-${crypto.randomUUID()}`;
}

function createPhoneDexObservability({ service = "watchdex", version = "0.1.0" } = {}) {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const requests = new Map();

  function record({ method, route, status, durationMs }) {
    const key = `${String(method || "GET").toUpperCase()} ${String(route || "unknown")}`;
    const current = requests.get(key) || { count: 0, errors: 0, totalMs: 0, lastStatus: 0 };
    current.count += 1;
    current.errors += Number(status) >= 400 ? 1 : 0;
    current.totalMs += Math.max(0, Number(durationMs) || 0);
    current.lastStatus = Number(status) || 0;
    requests.set(key, current);
  }

  function snapshot({ components = {} } = {}) {
    return {
      schema: SCHEMA,
      service,
      version,
      startedAt,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
      correlationHeader: CORRELATION_HEADER,
      components: {
        app: "healthy",
        hub: "healthy",
        push: "unknown",
        agent: "unknown",
        adapter: "unknown",
        originTask: "unknown",
        ...components
      },
      requests: [...requests.entries()].map(([route, value]) => ({
        route,
        count: value.count,
        errors: value.errors,
        averageLatencyMs: value.count ? Math.round(value.totalMs / value.count) : 0,
        lastStatus: value.lastStatus
      }))
    };
  }

  return { record, snapshot };
}

module.exports = {
  CORRELATION_HEADER,
  SCHEMA,
  createCorrelationId,
  createPhoneDexObservability
};
