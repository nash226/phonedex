#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createPhoneDexStore } = require("../lib/phonedex-store");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

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

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text available when an older client receives a non-JSON error.
  }
  return { response, json, text };
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await request(url);
      if (result.response.ok) return;
      lastError = new Error(`HTTP ${result.response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("Timed out waiting for compatibility bridge health");
}

function spawnHub(dataDir, port) {
  const hubUrl = `http://127.0.0.1:${port}`;
  const processHandle = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(port),
      WATCH_BRIDGE_PUBLIC_URL: hubUrl,
      WATCH_BRIDGE_TOKEN: "hub-token",
      PHONEDEX_ENABLE_LEGACY_QUERY_TOKENS: "true",
      PHONEDEX_ENABLE_LEGACY_BODY_TOKENS: "true",
      WATCH_BRIDGE_PROVIDER: "pushcut",
      WATCH_BRIDGE_AUTO_RESUME: "false",
      PHONEDEX_ADAPTER_MODE: "cli",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });
  return { hubUrl, processHandle };
}

async function stopHub(processHandle) {
  if (processHandle.exitCode !== null) return;
  processHandle.kill();
  await new Promise((resolve) => processHandle.once("exit", resolve));
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-compatibility-"));
  const legacyTask = {
    id: "legacy-task",
    title: "Legacy task",
    text: "Recovered from the pre-store JSONL mirror.",
    cwd: "C:\\Users\\legacy\\PhoneDex",
    machineName: "Windows Workstation",
    sessionId: "legacy-session",
    at: "2026-07-15T12:00:00.000Z"
  };
  const legacyDevice = {
    deviceId: "legacy-windows",
    machineName: "Windows Workstation",
    platform: "windows",
    role: "agent",
    lastSeenAt: "2026-07-15T12:00:00.000Z"
  };
  fs.writeFileSync(path.join(dataDir, "tasks.jsonl"), `${JSON.stringify(legacyTask)}\n`);
  fs.writeFileSync(path.join(dataDir, "devices.json"), `${JSON.stringify({ devices: [legacyDevice] })}\n`);

  const firstPort = await getFreePort();
  const first = spawnHub(dataDir, firstPort);
  let firstStderr = "";
  let ingestedTaskId;
  first.processHandle.stderr.on("data", (chunk) => { firstStderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${first.hubUrl}/health`);

    const legacyList = await request(`${first.hubUrl}/tasks?token=hub-token&limit=all`);
    assert.equal(legacyList.response.status, 200);
    assert.deepEqual(legacyList.json.map((task) => task.id), ["legacy-task"]);
    assert.equal(legacyList.json[0].text, legacyTask.text);

    const legacyIngest = await request(`${first.hubUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: "hub-token",
        id: "legacy-ingest",
        title: "Legacy ingest",
        text: "Accepted through the old task form.",
        cwd: "C:\\Users\\legacy\\Repo",
        machineName: "Windows Workstation"
      })
    });
    assert.equal(legacyIngest.response.status, 201);
    assert.notEqual(legacyIngest.json.task.id, "legacy-ingest");
    assert.equal(legacyIngest.json.task.originTaskId, "legacy-ingest");
    ingestedTaskId = legacyIngest.json.task.id;

    const sync = await request(`${first.hubUrl}/sync`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(sync.response.status, 200);
    assert.deepEqual(
      sync.json.snapshot.tasks.map((task) => task.id).sort(),
      [ingestedTaskId, "legacy-task"].sort()
    );

    const legacyReply = await request(`${first.hubUrl}/reply`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: "hub-token",
        taskId: "legacy-task",
        choice: "custom",
        prompt: "Continue from the legacy client.",
        idempotencyKey: "legacy-reply-1",
        commandId: "legacy-command-1"
      })
    });
    assert.equal(legacyReply.response.status, 200);
    assert.equal(legacyReply.json.ok, true);
    assert.equal(legacyReply.json.receipt.state, "completed");
    assert.equal(legacyReply.json.recorded.taskId, "legacy-task");

    const replies = await request(`${first.hubUrl}/replies?token=hub-token`);
    assert.equal(replies.response.status, 200);
    assert.equal(replies.json.at(-1).idempotencyKey, "legacy-reply-1");

    const devices = await request(`${first.hubUrl}/devices`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(devices.response.status, 200);
    assert.equal(devices.json.some((device) => device.deviceId === "legacy-windows"), true);
  } finally {
    await stopHub(first.processHandle);
  }

  assert.equal(firstStderr, "");
  const secondPort = await getFreePort();
  const second = spawnHub(dataDir, secondPort);
  let secondStderr = "";
  second.processHandle.stderr.on("data", (chunk) => { secondStderr += chunk.toString("utf8"); });
  try {
    await waitForHealth(`${second.hubUrl}/health`);
    const restarted = await request(`${second.hubUrl}/tasks`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(restarted.response.status, 200);
    assert.deepEqual(
      restarted.json.map((task) => task.id).sort(),
      [ingestedTaskId, "legacy-task"].sort()
    );

    const store = createPhoneDexStore(dataDir).read();
    assert.equal(store.tasks.length, 2);
    assert.equal(store.devices.some((device) => device.deviceId === "legacy-windows"), true);
    assert.equal(store.changes.some((change) => change.kind === "task" && change.id === ingestedTaskId), true);
  } finally {
    await stopHub(second.processHandle);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(secondStderr, "");
  console.log("legacy tasks/replies compatibility fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
