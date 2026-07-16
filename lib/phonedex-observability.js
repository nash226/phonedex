const crypto = require("node:crypto");

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,96}$/;
const MAX_RECENT_REQUESTS = 50;

function newCorrelationId() {
  return `pd_${crypto.randomUUID()}`;
}

function correlationIdFromRequest(value) {
  const candidate = String(value || "").trim();
  return CORRELATION_ID_PATTERN.test(candidate) ? candidate : newCorrelationId();
}

function createPhoneDexObservability({ service, role, protocolVersion = 1 }) {
  const startedAt = new Date().toISOString();
  const counts = { requests: 0, failures: 0, commands: 0 };
  const routes = new Map();
  const components = new Map([
    ["hub", "unknown"],
    ["agent", "unknown"],
    ["adapter", "unknown"],
    ["push", "unknown"],
    ["originTask", "unknown"]
  ]);
  const recentRequests = [];

  function recordRequest({ correlationId, route, status, latencyMs, command = false, errorClass = "" }) {
    counts.requests += 1;
    if (command) counts.commands += 1;
    if (status >= 400) counts.failures += 1;
    const routeStats = routes.get(route) || { requests: 0, failures: 0, totalLatencyMs: 0 };
    routeStats.requests += 1;
    routeStats.failures += status >= 400 ? 1 : 0;
    routeStats.totalLatencyMs += Math.max(0, Math.round(latencyMs));
    routes.set(route, routeStats);
    recentRequests.push({
      at: new Date().toISOString(),
      correlationId: correlationIdFromRequest(correlationId),
      route,
      status,
      latencyMs: Math.max(0, Math.round(latencyMs)),
      ...(errorClass ? { errorClass: String(errorClass).slice(0, 80) } : {})
    });
    if (recentRequests.length > MAX_RECENT_REQUESTS) recentRequests.shift();
  }

  function setComponent(name, state) {
    if (components.has(name)) components.set(name, state);
  }

  function snapshot({ capabilities = [], version = "" } = {}) {
    const routeStats = Object.fromEntries([...routes.entries()].map(([route, value]) => [
      route,
      {
        requests: value.requests,
        failures: value.failures,
        averageLatencyMs: value.requests ? Math.round(value.totalLatencyMs / value.requests) : 0
      }
    ]));
    return {
      schema: "phonedex.diagnostics.v1",
      generatedAt: new Date().toISOString(),
      startedAt,
      service,
      role,
      version,
      protocolVersion,
      components: Object.fromEntries(components),
      metrics: { ...counts, routes: routeStats },
      recentRequests: recentRequests.slice(-10),
      capabilities: capabilities.map((capability) => ({
        id: String(capability.id || "").slice(0, 80),
        supported: capability.supported === true
      }))
    };
  }

  return { recordRequest, setComponent, snapshot };
}

module.exports = { correlationIdFromRequest, createPhoneDexObservability };
