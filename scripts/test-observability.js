#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  CORRELATION_HEADER,
  SCHEMA,
  createCorrelationId,
  createPhoneDexObservability
} = require("../lib/phonedex-observability");

const supplied = "mobile-command:123";
assert.equal(createCorrelationId(supplied), supplied);
assert.notEqual(createCorrelationId("contains spaces"), "contains spaces");
assert.match(createCorrelationId(), /^px-[0-9a-f-]{36}$/);

const observability = createPhoneDexObservability({ service: "fixture", version: "test" });
observability.record({ method: "POST", route: "/command", status: 200, durationMs: 12 });
observability.record({ method: "POST", route: "/command", status: 409, durationMs: 8 });
const snapshot = observability.snapshot({ components: { agent: "healthy", adapter: "degraded" } });
assert.equal(snapshot.schema, SCHEMA);
assert.equal(snapshot.correlationHeader, CORRELATION_HEADER);
assert.deepEqual(snapshot.components, {
  app: "healthy",
  hub: "healthy",
  push: "unknown",
  agent: "healthy",
  adapter: "degraded",
  originTask: "unknown"
});
assert.deepEqual(snapshot.requests, [{
  route: "POST /command",
  count: 2,
  errors: 1,
  averageLatencyMs: 10,
  lastStatus: 409
}]);

console.log("observability fixture passed");
