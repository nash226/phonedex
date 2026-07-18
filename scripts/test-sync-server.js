#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
    // Keep the raw response for assertion failures.
  }
  return { response, json, text };
}

async function main() {
  const port = await getFreePort();
  const hubUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-sync-server-"));
  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(port),
    WATCH_BRIDGE_PUBLIC_URL: hubUrl,
    WATCH_BRIDGE_TOKEN: "hub-token",
    PUSHCUT_WEBHOOK_URL: ""
  };
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);
    const unauthenticated = await request(`${hubUrl}/sync`);
    assert.equal(unauthenticated.response.status, 401);

    const incompatible = await request(`${hubUrl}/sync`, {
      headers: {
        authorization: "Bearer hub-token",
        "x-phonedex-protocol-version": "99"
      }
    });
    assert.equal(incompatible.response.status, 426);
    assert.equal(incompatible.json.code, "protocol_incompatible");
    assert.deepEqual(incompatible.json.supportedProtocolVersions, [1]);

    const unsupportedCapability = await request(`${hubUrl}/sync`, {
      headers: {
        authorization: "Bearer hub-token",
        "x-phonedex-protocol-version": "1",
        "x-phonedex-capabilities": "task.cancel.v1"
      }
    });
    assert.equal(unsupportedCapability.response.status, 426);
    assert.equal(unsupportedCapability.json.code, "capability_unsupported");
    assert.deepEqual(unsupportedCapability.json.unsupportedCapabilities, ["task.cancel.v1"]);

    const taskIds = [];
    for (const id of ["remote_task_1", "remote_task_2"]) {
      const ingested = await request(`${hubUrl}/tasks`, {
        method: "POST",
        headers: {
          authorization: "Bearer hub-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          id,
          title: id,
          text: "safe result",
          cwd: "C:\\Users\\private\\repo",
          machineName: "Windows Workstation",
          deviceId: "windows-workstation",
          replyToken: "do-not-return-this-secret"
        })
      });
      assert.equal(ingested.response.status, 201);
      taskIds.push(ingested.json.task.id);
    }

    const heartbeat = await request(`${hubUrl}/devices/heartbeat`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        device: {
          deviceId: "windows-workstation",
          machineName: "Windows Workstation",
          platform: "windows",
          role: "agent",
          lastSeenAt: "2026-07-15T12:00:00.000Z",
          codexHome: "C:\\Users\\private",
          health: { agent: "healthy", adapter: "unknown" }
        }
      })
    });
    assert.equal(heartbeat.response.status, 200);

    let cursor = "";
    let tasks = [];
    let devices = [];
    let events = [];
    let lastPage;
    do {
      const page = await request(`${hubUrl}/sync?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: { authorization: "Bearer hub-token" }
      });
      assert.equal(page.response.status, 200);
      assert.equal(page.json.schema, "phonedex.sync.v1");
      assert.equal(page.json.protocolVersion, 1);
      assert.equal(page.json.protocol.negotiatedVersion, 1);
      assert.equal(page.json.protocol.capabilities.some((capability) => capability.id === "sync.snapshot"), true);
      assert.equal(page.json.changes.length, 0);
      tasks = tasks.concat(page.json.snapshot.tasks);
      devices = devices.concat(page.json.snapshot.devices);
      events = events.concat(page.json.snapshot.events || []);
      cursor = page.json.cursor;
      lastPage = page.json;
    } while (lastPage.hasMore);

    assert.deepEqual(tasks.map((task) => task.id).sort(), taskIds.sort());
    assert.deepEqual(devices.map((device) => device.deviceId), ["windows-workstation"]);
    assert.equal(events.length >= 2, true);
    assert.equal(events.every((event) => event.type === "task_completed"), true);
    assert.equal(JSON.stringify(tasks).includes("do-not-return-this-secret"), false);
    assert.equal(tasks.every((task) => task.workspaceName === "repo"), true);
    assert.equal(tasks.every((task) => !Object.hasOwn(task, "cwd")), true);
    assert.equal(JSON.stringify(devices).includes("private"), false);
    assert.deepEqual(devices[0].health, {
      reachability: "online",
      agent: "healthy",
      adapter: "unknown"
    });
    assert.equal(devices[0].capabilityDetails.some((capability) => capability.id === "task.reply"), false);

    const ingested = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({ id: "remote_task_3", title: "New task", text: "new result" })
    });
    assert.equal(ingested.response.status, 201);
    const newTaskId = ingested.json.task.id;

    const stream = await request(`${hubUrl}/sync?limit=10&cursor=${encodeURIComponent(cursor)}`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(stream.response.status, 200);
    assert.equal(stream.json.snapshot, null);
    assert.equal(stream.json.changes.some((change) => change.id === newTaskId), true);
    assert.equal(stream.json.changes.some((change) => change.kind === "event" && change.record.type === "task_completed"), true);

    const invalid = await request(`${hubUrl}/sync?cursor=not-a-cursor`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.json.code, "sync_cursor_invalid");
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("snapshot cursor sync server fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
