#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { correlationIdFromRequest, createPhoneDexObservability } = require("../lib/phonedex-observability");

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
assert.equal(correlationIdFromRequest("safe-request-123"), "safe-request-123");
assert.match(correlationIdFromRequest("not safe\nvalue"), /^pd_[0-9a-f-]+$/);

const metrics = createPhoneDexObservability({ service: "test", role: "hub" });
metrics.setComponent("hub", "healthy");
metrics.setComponent("adapter", "unknown");
metrics.recordRequest({ correlationId: "fixture-command-1", route: "/reply", status: 202, latencyMs: 12, command: true });
metrics.recordRequest({ correlationId: "fixture-sync-1", route: "/sync", status: 409, latencyMs: 8, errorClass: "sync_snapshot_changed" });
const snapshot = metrics.snapshot({ version: "test", capabilities: [{ id: "task.reply", supported: true }] });
assert.equal(snapshot.schema, "phonedex.diagnostics.v1");
assert.equal(snapshot.components.hub, "healthy");
assert.equal(snapshot.metrics.commands, 1);
assert.equal(snapshot.metrics.failures, 1);
assert.equal(snapshot.metrics.routes["/sync"].averageLatencyMs, 8);
assert.equal(snapshot.recentRequests[1].errorClass, "sync_snapshot_changed");
assert.equal(snapshot.recentRequests[0].correlationId, "fixture-command-1");
assert.equal(JSON.stringify(snapshot).includes("task text"), false);

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-observability-"));
const token = "observability-test-token";
const port = await awaitFreePort();
const child = spawn(process.execPath, [bridge, "server"], {
  cwd: root,
  env: { ...process.env, WATCH_BRIDGE_PORT: String(port), WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_TOKEN: token, PHONEDEX_MACHINE_NAME: "Observability Fixture",
    PHONEDEX_DEVICE_ID: "observability-fixture", PHONEDEX_COVERAGE_ALERTS: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  const unauthorized = await fetch(`http://127.0.0.1:${port}/diagnostics`);
  assert.equal(unauthorized.status, 401);
  const response = await fetch(`http://127.0.0.1:${port}/diagnostics`, {
    headers: { authorization: `Bearer ${token}`, "x-phonedex-correlation-id": "fixture-correlation-1" }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-phonedex-correlation-id"), "fixture-correlation-1");
  const diagnostics = await response.json();
  assert.equal(diagnostics.schema, "phonedex.diagnostics.v1");
  assert.equal(diagnostics.components.hub, "healthy");
  assert.equal(JSON.stringify(diagnostics).includes(token), false);
  assert.equal(JSON.stringify(diagnostics).includes(dataDir), false);
  console.log("observability fixture passed");
} finally {
  child.kill("SIGTERM");
  fs.rmSync(dataDir, { recursive: true, force: true });
}
}

function awaitFreePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port: freePort } = server.address();
      server.close(() => resolve(freePort));
    });
    server.on("error", reject);
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for observability fixture health");
}
