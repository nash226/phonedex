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
  return { response, json: text ? JSON.parse(text) : null };
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const result = await request(url);
      if (result.response.ok) return;
    } catch {
      // Keep polling until the bridge is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for reply bridge health");
}

async function main() {
  const bridgePort = await getFreePort();
  const originPort = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-reply-delivery-"));
  let originRequests = 0;
  const origin = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/reply") {
      res.writeHead(404).end();
      return;
    }
    originRequests += 1;
    res.writeHead(originRequests === 1 ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: originRequests > 1 }));
  });
  await new Promise((resolve) => origin.listen(originPort, "127.0.0.1", resolve));

  const hubUrl = `http://127.0.0.1:${bridgePort}`;
  const originUrl = `http://127.0.0.1:${originPort}`;
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(bridgePort),
      WATCH_BRIDGE_PUBLIC_URL: hubUrl,
      WATCH_BRIDGE_TOKEN: "hub-token",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);
    const task = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: {
        authorization: "Bearer hub-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: "origin-task",
        title: "Needs a reply",
        text: "Please choose the next step.",
        machineName: "Windows Workstation",
        deviceId: "windows-workstation",
        replyUrl: `${originUrl}/reply`,
        replyToken: "origin-token"
      })
    });
    assert.equal(task.response.status, 201);
    const taskId = task.json.task.id;

    const stale = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 2,
        idempotencyKey: "stale-reply",
        prompt: "Do the stale thing"
      })
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.json.code, "task_stale");
    assert.equal(stale.json.currentTaskVersion, 1);

    const first = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 1,
        idempotencyKey: "reply-1",
        commandId: "command-1",
        prompt: "Continue safely"
      })
    });
    assert.equal(first.response.status, 200);
    assert.equal(first.json.receipt.state, "failed");
    assert.equal(first.json.recorded.deliveryState, "failed");
    assert.equal(originRequests, 1);

    const retry = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 1,
        idempotencyKey: "reply-1",
        commandId: "command-1",
        prompt: "Continue safely"
      })
    });
    assert.equal(retry.response.status, 200);
    assert.equal(retry.json.duplicate, true);
    assert.equal(retry.json.receipt.state, "duplicate");
    assert.equal(retry.json.recorded.deliveryState, "completed");
    assert.equal(originRequests, 2);

    const duplicate = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 1,
        idempotencyKey: "reply-1",
        commandId: "command-1",
        prompt: "Continue safely"
      })
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.json.receipt.state, "duplicate");
    assert.equal(originRequests, 2);

    const commands = fs.readFileSync(path.join(dataDir, "commands.jsonl"), "utf8");
    const receipts = fs.readFileSync(path.join(dataDir, "command-receipts.jsonl"), "utf8");
    assert.equal(commands.includes("reply-1"), true);
    assert.equal(receipts.includes('"state":"failed"'), true);
    assert.equal(receipts.includes('"state":"duplicate"'), true);
  } finally {
    hub.kill();
    await new Promise((resolve) => origin.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("reply delivery receipt fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
