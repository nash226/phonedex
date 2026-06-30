#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function makeDataDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `phonedex-${name}-`));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Timed out waiting for hub health");
}

async function main() {
  const port = await getFreePort();
  const hubUrl = `http://127.0.0.1:${port}`;
  const hubDataDir = makeDataDir("self-test-hub");
  const agentDataDir = makeDataDir("self-test-agent");
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: hubDataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(port),
      WATCH_BRIDGE_PUBLIC_URL: hubUrl,
      WATCH_BRIDGE_TOKEN: "hub-token",
      WATCH_BRIDGE_PROVIDER: "pushcut",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });

  let stdout = "";
  let stderr = "";
  hub.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  hub.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await waitForHealth(`${hubUrl}/health`);

    const result = spawnSync(
      process.execPath,
      [bridge, "agent-self-test", "--json"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          WATCH_BRIDGE_DATA_DIR: agentDataDir,
          PHONEDEX_HUB_URL: hubUrl,
          PHONEDEX_HUB_TOKEN: "hub-token",
          PHONEDEX_AGENT_MODE: "true",
          PHONEDEX_DEVICE_ID: "agent-one",
          PHONEDEX_MACHINE_NAME: "Agent One",
          WATCH_BRIDGE_PUBLIC_URL: "http://agent-one.local:8765",
          WATCH_BRIDGE_TOKEN: "agent-token",
          WATCH_BRIDGE_PROVIDER: "pushcut",
          PUSHCUT_WEBHOOK_URL: ""
        }
      }
    );

    assert.equal(result.stderr, "");
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.deviceId, "agent-one");
    assert.equal(report.heartbeatForward.ok, true);
    assert.equal(report.taskForward.ok, true);
    assert.equal(report.hubDevice.deviceId, "agent-one");
    assert.equal(report.hubTask.originTaskId, report.task.id);
  } finally {
    hub.kill();
  }

  assert.equal(stderr, "");
  assert.match(stdout, /PhoneDex listening/);
  console.log("agent self-test fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
