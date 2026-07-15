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
  throw lastError || new Error("Timed out waiting for PhoneDex health");
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, json, text };
}

async function waitForTask(url, taskId, status) {
  const deadline = Date.now() + 5000;
  let latest;
  while (Date.now() < deadline) {
    const result = await request(`${url}/tasks?limit=all`, {
      headers: { authorization: "Bearer phone-token" }
    });
    latest = result.json?.find((task) => task.id === taskId);
    if (latest?.status === status) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${taskId} to become ${status}; got ${latest?.status || "missing"}`);
}

async function main() {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-lifecycle-"));
  const workspace = path.join(dataDir, "workspace");
  fs.mkdirSync(workspace);
  const fakeCodex = path.join(dataDir, "fake-codex.js");
  fs.writeFileSync(fakeCodex, `#!/usr/bin/env node
const prompt = process.argv.at(-1) || "";
if (prompt.includes("sleep")) setTimeout(() => console.log("finished after wait"), 2000);
else if (prompt.includes("fail")) { console.error("simulated failure"); process.exit(1); }
else console.log("completed: " + prompt);
`);
  fs.chmodSync(fakeCodex, 0o700);

  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(port),
    WATCH_BRIDGE_PUBLIC_URL: `http://127.0.0.1:${port}`,
    WATCH_BRIDGE_TOKEN: "phone-token",
    PHONEDEX_ADAPTER_PLATFORM: "macos",
    PHONEDEX_ADAPTER_MODE: "cli",
    PHONEDEX_WORKSPACE_ROOTS: workspace,
    CODEX_BIN: fakeCodex,
    PUSHCUT_WEBHOOK_URL: ""
  };
  const url = env.WATCH_BRIDGE_PUBLIC_URL;
  const server = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${url}/health`);
    const health = await request(`${url}/health`);
    assert.equal(health.json.adapter.capabilities.find((capability) => capability.id === "task.create").supported, true);

    const created = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "create_task",
        deviceId: health.json.deviceId,
        workspaceName: path.basename(workspace),
        prompt: "finish this small task",
        commandId: "lifecycle-create-1",
        idempotencyKey: "lifecycle-create-key"
      })
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.json.receipt.state, "accepted");
    assert.equal(created.json.task.workspaceName, path.basename(workspace));
    assert.equal(Object.hasOwn(created.json.task, "cwd"), false);
    assert.equal(JSON.stringify(created.json).includes("fake-codex"), false);
    const completed = await waitForTask(url, created.json.task.id, "completed");
    assert.match(completed.text, /completed: finish this small task/);

    const handoffTask = await request(`${url}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        token: "phone-token",
        task: {
          id: "origin-handoff-task",
          title: "Review the desktop task",
          text: "The desktop task is ready.",
          machineName: "MacBook Air",
          deviceId: health.json.deviceId,
          workspaceName: path.basename(workspace),
          sessionId: "session-handoff-123",
          lifecycleCapabilities: ["desktop.handoff.v1"],
          status: "completed"
        }
      })
    });
    assert.equal(handoffTask.response.status, 201);
    const handoff = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "handoff",
        taskId: handoffTask.json.task.id,
        expectedTaskVersion: handoffTask.json.task.version,
        commandId: "lifecycle-handoff-1",
        idempotencyKey: "lifecycle-handoff-key"
      })
    });
    assert.equal(handoff.response.status, 200);
    assert.equal(handoff.json.receipt.state, "completed");
    assert.equal(handoff.json.handoff.capability, "desktop.handoff.v1");
    assert.equal(handoff.json.handoff.sessionId, "session-handoff-123");
    assert.equal(Object.hasOwn(handoff.json.handoff, "cwd"), false);
    assert.equal(JSON.stringify(handoff.json).includes("phone-token"), false);

    const handoffDuplicate = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "handoff",
        taskId: handoffTask.json.task.id,
        expectedTaskVersion: handoffTask.json.task.version,
        commandId: "lifecycle-handoff-1",
        idempotencyKey: "lifecycle-handoff-key"
      })
    });
    assert.equal(handoffDuplicate.response.status, 200);
    assert.equal(handoffDuplicate.json.duplicate, true);
    assert.equal(handoffDuplicate.json.handoff.sessionId, "session-handoff-123");

    const missingSessionTask = await request(`${url}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "phone-token",
        task: {
          id: "origin-missing-session",
          title: "Missing session",
          text: "This cannot be handed off.",
          machineName: "MacBook Air",
          deviceId: health.json.deviceId,
          workspaceName: path.basename(workspace),
          lifecycleCapabilities: ["desktop.handoff.v1"],
          status: "completed"
        }
      })
    });
    const missingSessionHandoff = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "handoff",
        taskId: missingSessionTask.json.task.id,
        expectedTaskVersion: missingSessionTask.json.task.version,
        commandId: "lifecycle-handoff-missing-session",
        idempotencyKey: "lifecycle-handoff-missing-session-key"
      })
    });
    assert.equal(missingSessionHandoff.response.status, 409);
    assert.equal(missingSessionHandoff.json.code, "task_handoff_unavailable");

    const duplicate = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "create_task",
        deviceId: health.json.deviceId,
        workspaceName: path.basename(workspace),
        prompt: "finish this small task",
        commandId: "lifecycle-create-1",
        idempotencyKey: "lifecycle-create-key"
      })
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.json.duplicate, true);

    const running = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "create_task",
        deviceId: health.json.deviceId,
        workspaceName: path.basename(workspace),
        prompt: "sleep until cancelled",
        commandId: "lifecycle-create-2",
        idempotencyKey: "lifecycle-create-key-2"
      })
    });
    const runningTask = await waitForTask(url, running.json.task.id, "running");
    const cancelled = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "cancel",
        taskId: runningTask.id,
        expectedTaskVersion: runningTask.version,
        commandId: "lifecycle-cancel-1",
        idempotencyKey: "lifecycle-cancel-key"
      })
    });
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.json.receipt.state, "accepted");
    const cancelledTask = await waitForTask(url, runningTask.id, "cancelled");
    assert.equal(cancelledTask.status, "cancelled");

    const retried = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "retry",
        taskId: cancelledTask.id,
        expectedTaskVersion: cancelledTask.version,
        commandId: "lifecycle-retry-1",
        idempotencyKey: "lifecycle-retry-key"
      })
    });
    assert.equal(retried.response.status, 200);
    assert.equal(retried.json.receipt.state, "accepted");
    await waitForTask(url, cancelledTask.id, "running");

    const stale = await request(`${url}/command`, {
      method: "POST",
      headers: { authorization: "Bearer phone-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "cancel",
        taskId: cancelledTask.id,
        expectedTaskVersion: 1,
        commandId: "lifecycle-cancel-stale",
        idempotencyKey: "lifecycle-cancel-stale-key"
      })
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.json.code, "task_stale");
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("managed task lifecycle fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
