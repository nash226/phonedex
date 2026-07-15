#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createPhoneDexStore } = require("../lib/phonedex-store");
const {
  createPhoneDexPrivacy,
  redactSensitiveText
} = require("../lib/phonedex-privacy");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");
const secret = "security-regression-secret";

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
  return { response, text, json };
}

async function main() {
  const redacted = redactSensitiveText(
    `Bearer ${secret} token: ${secret} https://bridge.test/reply?token=${secret}`
  );
  assert.equal(redacted.includes(secret), false);
  assert.match(redacted, /Bearer \[redacted\]/);
  assert.match(redacted, /token: \[redacted\]/);
  assert.match(redacted, /[?&]token=\[redacted\]/);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-security-"));
  const store = createPhoneDexStore(dataDir);
  const at = new Date().toISOString();
  store.appendTask(
    {
      id: "security-task",
      at,
      title: "Security fixture",
      text: `Result includes Bearer ${secret} and token: ${secret}`,
      cwd: "/Users/private/PhoneDex",
      machineName: "Studio Mac",
      replyToken: secret,
      originReplyUrl: `https://agent.test/reply?token=${secret}`,
      status: "completed"
    },
    () => false
  );
  store.upsertDevice({
    deviceId: "studio-mac",
    machineName: "Studio Mac",
    platform: "macos",
    status: "online",
    lastSeenAt: at,
    codexHome: "/Users/private/.codex"
  });

  const privacy = createPhoneDexPrivacy(dataDir);
  assert.equal(JSON.stringify(privacy.exportData()).includes(secret), false);

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
    const headers = { authorization: "Bearer hub-token" };

    const tasks = await request(`${hubUrl}/tasks?limit=all`, { headers });
    assert.equal(tasks.response.status, 200);
    assert.equal(tasks.json.length, 1);
    assert.equal(JSON.stringify(tasks.json).includes(secret), false);
    assert.match(tasks.json[0].text, /Bearer \[redacted\]/);
    assert.equal(Object.hasOwn(tasks.json[0], "replyToken"), false);
    assert.equal(Object.hasOwn(tasks.json[0], "cwd"), false);
    assert.equal(tasks.json[0].workspaceName, "PhoneDex");

    const sync = await request(`${hubUrl}/sync`, { headers });
    assert.equal(sync.response.status, 200);
    assert.equal(JSON.stringify(sync.json).includes(secret), false);
    assert.equal(Object.hasOwn(sync.json.snapshot.tasks[0], "cwd"), false);
    assert.equal(Object.hasOwn(sync.json.snapshot.devices[0], "codexHome"), false);

    const queryAuthenticated = await request(`${hubUrl}/privacy?token=hub-token`);
    assert.equal(queryAuthenticated.response.status, 401);
    const authenticated = await request(`${hubUrl}/privacy`, { headers });
    assert.equal(authenticated.response.status, 200);
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("security regression fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
