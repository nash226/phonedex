#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

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
    json = JSON.parse(text);
  } catch {
    // Preserve the status for bounded error assertions.
  }
  return { response, json, text };
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const result = await request(url);
      if (result.response.ok) return;
    } catch {
      // The child may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for PhoneDex hub health");
}

async function main() {
  const port = await getFreePort();
  const hubUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-credential-lifecycle-"));
  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(port),
    WATCH_BRIDGE_PUBLIC_URL: hubUrl,
    WATCH_BRIDGE_TOKEN: "hub-token",
    PUSHCUT_WEBHOOK_URL: ""
  };
  const grantProcess = spawnSync(
    process.execPath,
    [bridge, "pair:create", "--name", "Lifecycle iPhone", "--ttl-ms", "600000"],
    { cwd: root, env, encoding: "utf8" }
  );
  assert.equal(grantProcess.status, 0, grantProcess.stderr);
  const grant = JSON.parse(grantProcess.stdout);
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);
    const paired = await request(`${hubUrl}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: grant.grant,
        verificationCode: grant.verificationCode,
        deviceName: "Lifecycle iPhone",
        platform: "ios"
      })
    });
    assert.equal(paired.response.status, 201);
    const identity = paired.json.identity;
    const originalCredential = paired.json.credential;
    assert.equal(identity.credentialVersion, 1);

    const firstRotation = await request(`${hubUrl}/pair/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${originalCredential}` }
    });
    assert.equal(firstRotation.response.status, 200);
    assert.equal(firstRotation.json.identity.id, identity.id);
    assert.equal(firstRotation.json.identity.credentialVersion, 2);
    const rotatedCredential = firstRotation.json.credential;
    assert.notEqual(rotatedCredential, originalCredential);
    assert.equal(firstRotation.response.headers.get("cache-control"), "no-store");

    const oldCredentialSync = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${originalCredential}` }
    });
    assert.equal(oldCredentialSync.response.status, 401);
    const rotatedCredentialSync = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${rotatedCredential}` }
    });
    assert.equal(rotatedCredentialSync.response.status, 200);

    let currentCredential = rotatedCredential;
    for (let version = 3; version <= 6; version += 1) {
      const rotation = await request(`${hubUrl}/pair/rotate`, {
        method: "POST",
        headers: { authorization: `Bearer ${currentCredential}` }
      });
      assert.equal(rotation.response.status, 200);
      assert.equal(rotation.json.identity.credentialVersion, version);
      currentCredential = rotation.json.credential;
    }
    const rateLimitedRotation = await request(`${hubUrl}/pair/rotate`, {
      method: "POST",
      headers: { authorization: `Bearer ${currentCredential}` }
    });
    assert.equal(rateLimitedRotation.response.status, 429);
    assert.equal(rateLimitedRotation.json.code, "rotation_rate_limited");

    const ingested = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: {
        authorization: "Bearer hub-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: "lifecycle-task",
        title: "Replay protection",
        text: "Choose a safe next step.",
        machineName: "MacBook Air",
        deviceId: "macbook-air"
      })
    });
    assert.equal(ingested.response.status, 201);
    const taskId = ingested.json.task.id;

    const firstReply = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${currentCredential}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        taskId,
        commandId: "lifecycle-command",
        idempotencyKey: "lifecycle-key",
        prompt: "Continue safely"
      })
    });
    assert.equal(firstReply.response.status, 200);
    assert.equal(firstReply.json.receipt.state, "completed");

    const replay = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${currentCredential}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        taskId,
        commandId: "lifecycle-command",
        idempotencyKey: "different-lifecycle-key",
        prompt: "Run a different action"
      })
    });
    assert.equal(replay.response.status, 409);
    assert.equal(replay.json.code, "command_replay");

    const cliRotation = spawnSync(
      process.execPath,
      [bridge, "pair:rotate", "--identity", identity.id],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(cliRotation.status, 0, cliRotation.stderr);
    const cliRotationResult = JSON.parse(cliRotation.stdout);
    assert.equal(cliRotationResult.identity.credentialVersion, 7);
    const latestCredential = cliRotationResult.credential;
    const preCliCredentialSync = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${currentCredential}` }
    });
    assert.equal(preCliCredentialSync.response.status, 401);
    const latestCredentialSync = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${latestCredential}` }
    });
    assert.equal(latestCredentialSync.response.status, 200);

    const auditPath = path.join(dataDir, "security-audit.jsonl");
    const auditText = fs.readFileSync(auditPath, "utf8");
    assert.match(auditText, /identity-paired/);
    assert.match(auditText, /credential-rotated/);
    assert.match(auditText, /rate-limit-rejected/);
    assert.match(auditText, /replay-rejected/);
    assert.equal(auditText.includes(originalCredential), false);
    assert.equal(auditText.includes(latestCredential), false);
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("credential lifecycle fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
