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

function readJsonl(dataDir, fileName) {
  const filePath = path.join(dataDir, fileName);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runCoverageAlert(dataDir, expectedDevices) {
  const result = spawnSync(
    process.execPath,
    [bridge, "notify-coverage", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        WATCH_BRIDGE_DATA_DIR: dataDir,
        WATCH_BRIDGE_PUBLIC_URL: "http://hub.local:8765",
        WATCH_BRIDGE_TOKEN: "hub-secret-token",
        PHONEDEX_MACHINE_NAME: "Hub",
        PHONEDEX_DEVICE_ID: "hub",
        PHONEDEX_EXPECTED_DEVICES: expectedDevices,
        WATCH_BRIDGE_PROVIDER: "pushcut",
        PUSHCUT_WEBHOOK_URL: ""
      }
    }
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

{
  const dataDir = makeDataDir("coverage-alert-missing");
  writeDevices(dataDir, [
    {
      deviceId: "hub",
      machineName: "Hub",
      lastSeenAt: new Date().toISOString()
    }
  ]);

  const result = runCoverageAlert(
    dataDir,
    "hub:Hub,macbook-air:MacBook Air,windows-desktop:Windows Desktop"
  );
  assert.equal(result.sent, true);
  assert.equal(result.task.source, "device-coverage-alert");
  assert.equal(result.report.ok, false);
  assert.equal(result.report.failingExpectedCount, 2);
  assert.match(result.invite.setupUrl, /\/agent-bootstrap\/invite\//);
  assert.doesNotMatch(result.invite.setupUrl, /hub-secret-token/);
  assert.match(result.task.text, /MacBook Air is missing/);
  assert.match(result.task.text, /Windows Desktop is missing/);
  assert.match(result.task.text, /Open this short-lived setup link/);
  assert.match(result.task.text, /\/agent-bootstrap\/invite\//);
  assert.doesNotMatch(result.task.text, /hub-secret-token/);

  const tasks = readJsonl(dataDir, "tasks.jsonl");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].source, "device-coverage-alert");

  const state = JSON.parse(
    fs.readFileSync(path.join(dataDir, "coverage-alert-state.json"), "utf8")
  );
  assert.equal(state.ok, false);
  assert.equal(state.taskId, tasks[0].id);
  assert.match(state.inviteUrl, /\/agent-bootstrap\/invite\//);
  assert.equal(state.inviteExpiresAt, result.invite.expiresAt);
}

{
  const dataDir = makeDataDir("coverage-alert-ok");
  writeDevices(dataDir, [
    {
      deviceId: "hub",
      machineName: "Hub",
      lastSeenAt: new Date().toISOString()
    }
  ]);

  const result = runCoverageAlert(dataDir, "hub:Hub");
  assert.equal(result.sent, false);
  assert.equal(result.reason, "coverage-ok");
  assert.equal(result.report.ok, true);
  assert.equal(readJsonl(dataDir, "tasks.jsonl").length, 0);
}

console.log("coverage alert fixture test passed");
