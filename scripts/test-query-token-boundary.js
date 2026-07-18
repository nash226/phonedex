#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function freePort() {
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
  try { json = JSON.parse(text); } catch {}
  return { response, json };
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const result = await request(url);
      if (result.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for PhoneDex health");
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-query-token-"));
  const port = await freePort();
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
      WATCH_BRIDGE_PROVIDER: "pushcut",
      WATCH_BRIDGE_AUTO_RESUME: "false",
      PHONEDEX_ADAPTER_MODE: "cli",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });

  try {
    await waitForHealth(`${hubUrl}/health`);

    const query = await request(`${hubUrl}/tasks?token=hub-token&limit=all`);
    assert.equal(query.response.status, 401);

    const bearer = await request(`${hubUrl}/tasks?limit=all`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(bearer.response.status, 200);

    const bodyToken = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: "hub-token",
        id: "body-token-task",
        title: "Body token compatibility",
        text: "Legacy body authentication remains available during migration.",
        machineName: "Windows Workstation"
      })
    });
    assert.equal(bodyToken.response.status, 201);

    const privacyQuery = await request(`${hubUrl}/privacy?token=hub-token`);
    assert.equal(privacyQuery.response.status, 401);
    const privacyBearer = await request(`${hubUrl}/privacy`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(privacyBearer.response.status, 200);
  } finally {
    if (hub.exitCode === null) hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log("query-token boundary fixture passed");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
