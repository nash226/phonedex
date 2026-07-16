#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
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
    json = JSON.parse(text);
  } catch {
    // Keep plain-text bodies available in assertion failures.
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
  throw lastError || new Error("Timed out waiting for PhoneDex hub health");
}

async function createOrigin() {
  const port = await getFreePort();
  const received = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/reply") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { received, server, url: `http://127.0.0.1:${port}/reply` };
}

async function main() {
  const hubPort = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-cross-platform-"));
  const macOrigin = await createOrigin();
  const windowsOrigin = await createOrigin();
  const hubUrl = `http://127.0.0.1:${hubPort}`;
  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(hubPort),
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
    const auth = { authorization: "Bearer hub-token" };
    const jsonAuth = { ...auth, "content-type": "application/json" };

    for (const device of [
      {
        deviceId: "mac-studio",
        machineName: "Studio Mac",
        platform: "macos",
        capabilities: ["task.reply", "desktop.handoff"]
      },
      {
        deviceId: "windows-workstation",
        machineName: "Windows Workstation",
        platform: "windows",
        capabilities: ["task.reply", "desktop.handoff"]
      }
    ]) {
      const heartbeat = await request(`${hubUrl}/devices/heartbeat`, {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({
          device: {
            ...device,
            role: "agent",
            lastSeenAt: "2026-07-16T12:00:00.000Z",
            health: { agent: "healthy", adapter: "ready" }
          }
        })
      });
      assert.equal(heartbeat.response.status, 200, heartbeat.text);
    }

    const taskInputs = [
      {
        id: "mac-task-1",
        title: "Review Mac change",
        text: "Mac result",
        machineName: "Studio Mac",
        deviceId: "mac-studio",
        workspaceName: "phone-dex",
        replyUrl: macOrigin.url,
        replyToken: "mac-origin-secret"
      },
      {
        id: "windows-task-1",
        title: "Review Windows change",
        text: "Windows result",
        machineName: "Windows Workstation",
        deviceId: "windows-workstation",
        workspaceName: "phone-dex",
        replyUrl: windowsOrigin.url,
        replyToken: "windows-origin-secret"
      }
    ];
    for (const task of taskInputs) {
      const ingested = await request(`${hubUrl}/tasks`, {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({ ...task, cwd: "/private/source/path" })
      });
      assert.equal(ingested.response.status, 201, ingested.text);
    }

    const tasks = [];
    const devices = [];
    let cursor = "";
    let page;
    do {
      page = await request(`${hubUrl}/sync?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
        headers: auth
      });
      assert.equal(page.response.status, 200, page.text);
      assert.equal(page.json.schema, "phonedex.sync.v1");
      assert.equal(page.json.protocol.negotiatedVersion, 1);
      tasks.push(...page.json.snapshot.tasks);
      devices.push(...page.json.snapshot.devices);
      cursor = page.json.cursor;
    } while (page.json.hasMore);

    assert.deepEqual(tasks.map(({ title }) => title).sort(), ["Review Mac change", "Review Windows change"]);
    assert.deepEqual(devices.map(({ deviceId }) => deviceId).sort(), ["mac-studio", "windows-workstation"]);
    assert.deepEqual(
      tasks.map(({ deviceId, machineName, workspaceName }) => ({ deviceId, machineName, workspaceName })).sort((a, b) => a.deviceId.localeCompare(b.deviceId)),
      [
        { deviceId: "mac-studio", machineName: "Studio Mac", workspaceName: "phone-dex" },
        { deviceId: "windows-workstation", machineName: "Windows Workstation", workspaceName: "phone-dex" }
      ]
    );
    assert.equal(JSON.stringify({ tasks, devices }).includes("origin-secret"), false);
    assert.equal(JSON.stringify({ tasks, devices }).includes("/private/source/path"), false);
    assert.equal(devices.every((device) => device.health.agent === "healthy"), true);

    for (const task of tasks) {
      const reply = await request(`${hubUrl}/reply`, {
        method: "POST",
        headers: jsonAuth,
        body: JSON.stringify({
          taskId: task.id,
          expectedTaskVersion: task.version,
          idempotencyKey: `cross-platform-${task.id}`,
          commandId: `cross-platform-command-${task.id}`,
          prompt: `Continue ${task.machineName} safely`
        })
      });
      assert.equal(reply.response.status, 200, reply.text);
      assert.equal(reply.json.receipt.state, "completed");
    }

    assert.deepEqual(macOrigin.received.map(({ prompt }) => prompt), ["Continue Studio Mac safely"]);
    assert.deepEqual(windowsOrigin.received.map(({ prompt }) => prompt), ["Continue Windows Workstation safely"]);
    assert.equal(macOrigin.received[0].token, "mac-origin-secret");
    assert.equal(windowsOrigin.received[0].token, "windows-origin-secret");
    console.log("cross-platform Mac/Windows contract fixture passed");
  } finally {
    hub.kill();
    await Promise.all([
      new Promise((resolve) => macOrigin.server.close(resolve)),
      new Promise((resolve) => windowsOrigin.server.close(resolve))
    ]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
