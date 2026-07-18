#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-installs-"));
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    text,
    json
  };
}

function runAgentInstalls(env) {
  const result = spawnSync(process.execPath, [bridge, "agent-installs", "--json"], {
    cwd: root,
    encoding: "utf8",
    env
  });

  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

async function main() {
  const port = await getFreePort();
  const hubUrl = `http://127.0.0.1:${port}`;
  const dataDir = makeTempDir();
  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(port),
    WATCH_BRIDGE_PUBLIC_URL: hubUrl,
    WATCH_BRIDGE_TOKEN: "hub-token",
    WATCH_BRIDGE_PROVIDER: "pushcut",
    PUSHCUT_WEBHOOK_URL: ""
  };

  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
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

    const blockedGet = await fetchJson(`${hubUrl}/agent-installs`);
    assert.equal(blockedGet.status, 401);

    const blockedPost = await fetchJson(`${hubUrl}/agent-installs`, {
      method: "POST",
      body: new URLSearchParams({
        token: "wrong",
        deviceId: "macbook-air",
        stage: "started"
      })
    });
    assert.equal(blockedPost.status, 401);

    const started = await fetchJson(`${hubUrl}/agent-installs`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token" },
      body: new URLSearchParams({
        deviceId: "macbook-air",
        machineName: "MacBook Air",
        platform: "macos",
        stage: "started",
        ok: "true",
        message: "ready",
        source: "bootstrap-script"
      })
    });
    assert.equal(started.status, 201);
    assert.equal(started.json.ok, true);
    assert.equal(started.json.report.deviceId, "macbook-air");
    assert.equal(started.json.report.stage, "started");
    assert.equal(started.json.report.ok, true);
    assert.equal(started.json.notification.attempted, true);
    assert.equal(started.json.notification.created, true);
    assert.equal(started.text.includes("hub-token"), false);

    const progress = await fetchJson(`${hubUrl}/agent-installs`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token" },
      body: new URLSearchParams({
        deviceId: "macbook-air",
        machineName: "MacBook Air",
        platform: "macos",
        stage: "self-test-passed",
        ok: "true",
        message: "ready",
        source: "bootstrap-script"
      })
    });
    assert.equal(progress.status, 201);
    assert.equal(progress.json.notification.attempted, false);

    const failed = await fetchJson(`${hubUrl}/agent-installs`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token" },
      body: new URLSearchParams({
        deviceId: "windows-desktop",
        machineName: "Windows Desktop",
        platform: "windows",
        stage: "failed",
        ok: "false",
        message: "git not found"
      })
    });
    assert.equal(failed.status, 201);
    assert.equal(failed.json.report.ok, false);

    const reports = await fetchJson(`${hubUrl}/agent-installs`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(reports.status, 200);
    assert.equal(reports.json.length, 3);
    assert.equal(reports.json[0].machineName, "MacBook Air");
    assert.equal(reports.json[1].stage, "self-test-passed");
    assert.equal(reports.json[2].stage, "failed");
    assert.equal(reports.text.includes("hub-token"), false);

    const tasks = await fetchJson(`${hubUrl}/tasks`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(tasks.status, 200);
    const installTasks = tasks.json.filter((task) => task.source === "agent-install-report");
    assert.equal(installTasks.length, 2);
    assert.match(installTasks[0].text, /Install started on MacBook Air/);
    assert.match(installTasks[1].text, /Install failed on Windows Desktop/);

    const cliReports = runAgentInstalls(env);
    assert.equal(cliReports.length, 3);
    assert.equal(cliReports[0].deviceId, "macbook-air");
    assert.equal(cliReports[2].ok, false);
  } finally {
    hub.kill();
  }

  assert.equal(stderr, "");
  assert.match(stdout, /PhoneDex listening/);
  console.log("agent install report fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
