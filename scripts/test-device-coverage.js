#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function makeDataDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `phonedex-${name}-`));
}

function writeDevices(dataDir, devices) {
  fs.writeFileSync(
    path.join(dataDir, "devices.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), devices }, null, 2)
  );
}

function writeTasks(dataDir, tasks) {
  fs.writeFileSync(
    path.join(dataDir, "tasks.jsonl"),
    tasks.map((task) => JSON.stringify(task)).join("\n") + "\n"
  );
}

function runVerify({ dataDir, expectedDevices, args = [] }) {
  const result = spawnSync(
    process.execPath,
    [bridge, "verify-devices", "--json", ...args],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        WATCH_BRIDGE_DATA_DIR: dataDir,
        PHONEDEX_EXPECTED_DEVICES: expectedDevices,
        PHONEDEX_DEVICE_STALE_MS: "60000",
        WATCH_BRIDGE_PROVIDER: "pushcut",
        PUSHCUT_WEBHOOK_URL: "",
        WATCH_BRIDGE_TOKEN: "test-token"
      }
    }
  );

  assert.equal(result.stderr, "");
  return {
    status: result.status,
    report: JSON.parse(result.stdout)
  };
}

const now = new Date().toISOString();
const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();

{
  const dataDir = makeDataDir("devices-empty");
  const { status, report } = runVerify({ dataDir, expectedDevices: "" });
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, "expected-devices-empty");
}

{
  const dataDir = makeDataDir("devices-online");
  writeDevices(dataDir, [
    { deviceId: "macbook-air", machineName: "MacBook Air", lastSeenAt: now }
  ]);
  const { status, report } = runVerify({
    dataDir,
    expectedDevices: "macbook-air:MacBook Air"
  });
  assert.equal(status, 0);
  assert.equal(report.ok, true);
  assert.equal(report.onlineExpectedCount, 1);
}

{
  const dataDir = makeDataDir("devices-missing");
  writeDevices(dataDir, [
    { deviceId: "macbook-air", machineName: "MacBook Air", lastSeenAt: now }
  ]);
  const { status, report } = runVerify({
    dataDir,
    expectedDevices: "macbook-air:MacBook Air,windows-desktop:Windows"
  });
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === "device-missing"), true);
}

{
  const dataDir = makeDataDir("devices-stale");
  writeDevices(dataDir, [
    { deviceId: "windows-desktop", machineName: "Windows", lastSeenAt: stale }
  ]);
  const { status, report } = runVerify({
    dataDir,
    expectedDevices: "windows-desktop:Windows"
  });
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, "device-stale");
}

{
  const dataDir = makeDataDir("devices-task-only");
  writeTasks(dataDir, [
    {
      id: "task_1",
      at: now,
      deviceId: "windows-desktop",
      machineName: "Windows",
      sessionId: "session_1",
      cwd: root,
      source: "fixture"
    }
  ]);
  const { status, report } = runVerify({
    dataDir,
    expectedDevices: "windows-desktop:Windows"
  });
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, "device-task-only");
}

{
  const dataDir = makeDataDir("devices-unexpected");
  writeDevices(dataDir, [
    { deviceId: "macbook-air", machineName: "MacBook Air", lastSeenAt: now },
    { deviceId: "extra-mac", machineName: "Extra Mac", lastSeenAt: now }
  ]);
  const { status, report } = runVerify({
    dataDir,
    expectedDevices: "macbook-air:MacBook Air",
    args: ["--fail-on-unexpected"]
  });
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.issues.some((issue) => issue.code === "unexpected-device"), true);
}

console.log("device coverage fixture test passed");
