#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createPhoneDexStore } = require("../lib/phonedex-store");
const {
  DELETE_CONFIRMATION,
  RETENTION_CONFIRMATION,
  createPhoneDexPrivacy
} = require("../lib/phonedex-privacy");

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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("Timed out waiting for hub health");
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep raw text for assertion failures.
  }
  return { response, json, text };
}

function task(id, at) {
  return {
    id,
    at,
    title: id,
    text: id === "old" ? "token: super-secret-value" : "Safe result",
    cwd: "C:\\Users\\private\\PhoneDex",
    machineName: "Windows Workstation",
    replyToken: "reply-secret",
    status: "completed"
  };
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-privacy-"));
  const store = createPhoneDexStore(dataDir);
  const oldAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const recentAt = new Date().toISOString();
  store.appendTask(task("old", oldAt), () => false);
  store.appendTask(task("recent", recentAt), () => false);
  store.upsertDevice({
    deviceId: "windows-workstation",
    machineName: "Windows Workstation",
    platform: "windows",
    status: "online",
    lastSeenAt: recentAt
  });
  fs.writeFileSync(
    path.join(dataDir, "replies.jsonl"),
    `${JSON.stringify({ at: oldAt, prompt: "token: reply-secret" })}\n${JSON.stringify({ at: recentAt, prompt: "safe" })}\n`
  );

  const privacy = createPhoneDexPrivacy(dataDir);
  const exported = privacy.exportData();
  assert.equal(exported.schema, "phonedex.privacy.v1");
  assert.equal(exported.tasks.some((entry) => Object.hasOwn(entry, "cwd")), false);
  assert.equal(exported.tasks.some((entry) => Object.hasOwn(entry, "replyToken")), false);
  assert.equal(exported.tasks.find((entry) => entry.id === "old").workspaceName, "PhoneDex");
  assert.equal(JSON.stringify(exported).includes("super-secret-value"), false);
  assert.equal(JSON.stringify(exported).includes("C:\\Users\\private"), false);

  const retention = privacy.applyRetention(1);
  assert.equal(retention.deletedTaskCount, 1);
  assert.equal(retention.deletedActivityCount, 1);
  assert.deepEqual(createPhoneDexStore(dataDir).listTasks().map((entry) => entry.id), ["recent"]);
  assert.equal(privacy.summary().policy.retentionDays, 1);

  assert.throws(
    () => privacy.deleteHistory({ confirmation: "wrong" }),
    (error) => error.code === "privacy_confirmation_required"
  );

  const port = await getFreePort();
  const hubUrl = `http://127.0.0.1:${port}`;
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(port),
      WATCH_BRIDGE_PUBLIC_URL: hubUrl,
      WATCH_BRIDGE_TOKEN: "hub-token",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);
    const unauthenticated = await request(`${hubUrl}/privacy`);
    assert.equal(unauthenticated.response.status, 401);
    const queryAuthenticated = await request(`${hubUrl}/privacy?token=hub-token`);
    assert.equal(queryAuthenticated.response.status, 401);

    const summary = await request(`${hubUrl}/privacy`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(summary.response.status, 200);
    assert.equal(summary.json.taskCount, 1);

    const missingConfirmation = await request(`${hubUrl}/privacy/delete`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "wrong" })
    });
    assert.equal(missingConfirmation.response.status, 400);
    assert.equal(missingConfirmation.json.code, "privacy_confirmation_required");

    const deleted = await request(`${hubUrl}/privacy/delete`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({ confirmation: DELETE_CONFIRMATION })
    });
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.json.deletedTaskCount, 1);
    const clearedStore = createPhoneDexStore(dataDir);
    assert.equal(clearedStore.listDevices().length, 1);
    assert.deepEqual(clearedStore.read().changes, []);
    assert.equal(fs.existsSync(path.join(dataDir, "phonedex-store.json.bak")), false);

    const afterDelete = await request(`${hubUrl}/privacy/export`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(afterDelete.response.status, 200);
    assert.deepEqual(afterDelete.json.tasks, []);

    const retentionConfirmation = await request(`${hubUrl}/privacy/retention`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        confirmation: RETENTION_CONFIRMATION,
        retentionDays: 0
      })
    });
    assert.equal(retentionConfirmation.response.status, 200);
    assert.equal(retentionConfirmation.json.policy.retentionDays, 0);
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("privacy controls fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
