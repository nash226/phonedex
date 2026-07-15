#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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
  const urlRedacted = redactSensitiveText(
    `https://support-user:${secret}@bridge.test/reply#token=${secret}&access_token=${secret}`
  );
  assert.equal(urlRedacted.includes(secret), false);
  assert.match(urlRedacted, /https:\/\/\[redacted\]@bridge\.test/);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-security-"));
  const pushcutPort = await getFreePort();
  let pushcutBody;
  const pushcut = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    pushcutBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => pushcut.listen(pushcutPort, "127.0.0.1", resolve));
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
      version: 1,
      status: "awaiting_approval",
      approvalRequest: {
        id: "approval-security",
        taskVersion: 1,
        operation: "Write files",
        scope: "PhoneDex workspace",
        origin: {
          deviceId: "studio-mac",
          machineName: "Studio Mac",
          workspaceName: "PhoneDex",
          path: "/Users/private/PhoneDex"
        },
        reason: "Security fixture",
        risk: "Writes generated files",
        requestedAt: at,
        expiresAt: new Date(Date.parse(at) + 15 * 60 * 1000).toISOString(),
        state: "pending"
      }
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
      WATCH_BRIDGE_PUBLIC_URL: `http://support-user:${secret}@127.0.0.1:${port}?token=${secret}`,
      WATCH_BRIDGE_TOKEN: "hub-token",
      WATCH_BRIDGE_PROVIDER: "pushcut",
      WATCH_BRIDGE_AUTO_RESUME: "false",
      PHONEDEX_ADAPTER_MODE: "cli",
      PUSHCUT_WEBHOOK_URL: `http://127.0.0.1:${pushcutPort}`
    }
  });
  let stdout = "";
  let stderr = "";
  hub.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);
    const health = await request(`${hubUrl}/health`);
    assert.equal(health.response.status, 200);
    assert.equal(JSON.stringify(health.json).includes(secret), false);
    assert.equal(health.json.publicUrl, `http://127.0.0.1:${port}`);
    assert.equal(health.json.replyUrl, `${hubUrl}/reply`);
    assert.equal(stdout.includes(secret), false);
    const headers = { authorization: "Bearer hub-token" };

    const notifiedTask = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        id: "notification-security-task",
        title: "Notification security fixture",
        text: `Completed with Bearer ${secret} and token: ${secret}`,
        machineName: "Studio Mac",
        deviceId: "studio-mac"
      })
    });
    assert.equal(notifiedTask.response.status, 201);
    assert.ok(pushcutBody);
    assert.equal(JSON.stringify(pushcutBody).includes(secret), false);
    assert.equal(pushcutBody.input.includes("cwd"), false);
    assert.equal(pushcutBody.input.includes("sessionId"), false);
    for (const action of pushcutBody.actions) {
      assert.equal(action.url.includes("token"), false);
      assert.equal(action.urlBackgroundOptions.httpBody.includes("token"), false);
      assert.match(action.url, /[?&]action=[A-Za-z0-9_-]{32,}/);
    }
    const actionToken = new URL(pushcutBody.actions[0].url).searchParams.get("action");
    const storedState = JSON.parse(fs.readFileSync(path.join(dataDir, "phonedex-store.json"), "utf8"));
    assert.equal(JSON.stringify(storedState.notificationActionGrants).includes(actionToken), false);
    const actionResponse = await request(pushcutBody.actions[0].url);
    assert.equal(actionResponse.response.status, 200);
    assert.equal(actionResponse.json.ok, true);
    const replayedAction = await request(pushcutBody.actions[0].url);
    assert.equal(replayedAction.response.status, 410);
    assert.equal(replayedAction.json.code, "notification_action_invalid");

    const tasks = await request(`${hubUrl}/tasks?limit=all`, { headers });
    assert.equal(tasks.response.status, 200);
    assert.equal(tasks.json.length, 2);
    assert.equal(JSON.stringify(tasks.json).includes(secret), false);
    const securityTask = tasks.json.find((candidate) => candidate.id === "security-task");
    assert.ok(securityTask);
    assert.match(securityTask.text, /Bearer \[redacted\]/);
    assert.equal(Object.hasOwn(securityTask, "replyToken"), false);
    assert.equal(Object.hasOwn(securityTask, "cwd"), false);
    assert.equal(securityTask.workspaceName, "PhoneDex");
    assert.equal(securityTask.approvalRequest.origin.path, undefined);
    assert.equal(Object.hasOwn(securityTask.approvalRequest.origin, "path"), false);

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
    await new Promise((resolve) => pushcut.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("security regression fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
