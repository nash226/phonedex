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
    // Keep raw text for assertion failures.
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-identity-lifecycle-"));
  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(port),
    WATCH_BRIDGE_PUBLIC_URL: hubUrl,
    WATCH_BRIDGE_TOKEN: "hub-token",
    PHONEDEX_AUTH_RATE_LIMIT: "2",
    PHONEDEX_AUTH_RATE_WINDOW_MS: "100",
    PUSHCUT_WEBHOOK_URL: ""
  };
  const grantProcess = spawnSync(
    process.execPath,
    [bridge, "pair:create", "--name", "Lifecycle iPhone"],
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
    const oldCredential = paired.json.credential;
    const identityId = paired.json.identity.id;
    const auth = { authorization: `Bearer ${oldCredential}` };

    assert.equal((await request(`${hubUrl}/sync`, { headers: auth })).response.status, 200);
    assert.equal((await request(`${hubUrl}/devices`, { headers: auth })).response.status, 200);
    const rateLimited = await request(`${hubUrl}/devices`, { headers: auth });
    assert.equal(rateLimited.response.status, 429);
    assert.equal(rateLimited.json.code, "rate_limited");
    assert.ok(Number(rateLimited.response.headers.get("retry-after")) >= 1);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const ingested = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: {
        authorization: "Bearer hub-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: "lifecycle-task",
        title: "Lifecycle task",
        text: "Choose the safe continuation.",
        machineName: "MacBook Air",
        deviceId: "macbook-air"
      })
    });
    assert.equal(ingested.response.status, 201);
    const taskId = ingested.json.task.id;

    const firstReply = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        commandId: "lifecycle-command",
        idempotencyKey: "lifecycle-key",
        prompt: "Continue safely"
      })
    });
    assert.equal(firstReply.response.status, 200);
    assert.equal(firstReply.json.receipt.state, "completed");

    const mutatedReplay = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        commandId: "lifecycle-command",
        idempotencyKey: "lifecycle-key",
        prompt: "Run a different action"
      })
    });
    assert.equal(mutatedReplay.response.status, 409);
    assert.equal(mutatedReplay.json.code, "replay_conflict");

    const rotationProcess = spawnSync(
      process.execPath,
      [bridge, "pair:rotate", "--identity", identityId, "--json"],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(rotationProcess.status, 0, rotationProcess.stderr);
    const rotation = JSON.parse(rotationProcess.stdout);
    assert.notEqual(rotation.credential, oldCredential);
    assert.equal(rotation.identity.credentialVersion, 2);

    await new Promise((resolve) => setTimeout(resolve, 120));
    const oldCredentialResult = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${oldCredential}` }
    });
    assert.equal(oldCredentialResult.response.status, 401);
    const newCredentialResult = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${rotation.credential}` }
    });
    assert.equal(newCredentialResult.response.status, 200);

    const audit = fs.readFileSync(path.join(dataDir, "security-audit.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.ok(audit.some((entry) => entry.action === "identity.pair" && entry.outcome === "success"));
    assert.ok(audit.some((entry) => entry.action === "identity.rotate" && entry.outcome === "success"));
    assert.ok(audit.some((entry) => entry.action === "request.rate-limit" && entry.outcome === "blocked"));
    assert.ok(audit.some((entry) => entry.action === "reply.replay" && entry.outcome === "blocked"));
    assert.equal(audit.some((entry) => JSON.stringify(entry).includes(oldCredential)), false);
    assert.equal(audit.some((entry) => JSON.stringify(entry).includes(rotation.credential)), false);
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("identity lifecycle fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
