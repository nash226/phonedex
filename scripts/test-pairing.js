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
    // Keep the raw response for assertion failures.
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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-pairing-"));
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
    [bridge, "pair:create", "--name", "Nash iPhone", "--ttl-ms", "600000"],
    { cwd: root, env, encoding: "utf8" }
  );
  assert.equal(grantProcess.status, 0, grantProcess.stderr);
  const grant = JSON.parse(grantProcess.stdout);
  assert.equal(grant.bridgeUrl, hubUrl);
  assert.equal(grant.role, "phone");
  assert.match(grant.grant, /^[A-Za-z0-9_-]{16,}$/);
  assert.match(grant.verificationCode, /^\d{6}$/);

  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);

    const invalidCode = await request(`${hubUrl}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: grant.grant,
        verificationCode: "000000",
        deviceName: "Nash iPhone",
        platform: "ios"
      })
    });
    assert.equal(invalidCode.response.status, 400);
    assert.equal(invalidCode.json.code, "pairing_invalid");

    const paired = await request(`${hubUrl}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: grant.grant,
        verificationCode: grant.verificationCode,
        deviceName: "Nash iPhone",
        platform: "ios"
      })
    });
    assert.equal(paired.response.status, 201);
    assert.equal(paired.json.ok, true);
    assert.match(paired.json.credential, /^[A-Za-z0-9_-]{30,}$/);
    assert.deepEqual(paired.json.identity.scopes, ["tasks.read", "tasks.reply"]);
    assert.equal(paired.json.identity.platform, "ios");

    const pairedSync = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${paired.json.credential}` }
    });
    assert.equal(pairedSync.response.status, 200);
    assert.equal(pairedSync.json.snapshot.devices[0].deviceId, paired.json.identity.deviceId);

    const credentialInURL = await request(`${hubUrl}/sync?token=${encodeURIComponent(paired.json.credential)}`);
    assert.equal(credentialInURL.response.status, 401);

    const phoneIngest = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${paired.json.credential}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ id: "not-allowed", title: "No", text: "No" })
    });
    assert.equal(phoneIngest.response.status, 401);

    const reused = await request(`${hubUrl}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant: grant.grant, verificationCode: grant.verificationCode })
    });
    assert.equal(reused.response.status, 410);
    assert.equal(reused.json.code, "pairing_used");

    const storeText = fs.readFileSync(path.join(dataDir, "phonedex-store.json"), "utf8");
    assert.equal(storeText.includes(paired.json.credential), false);
    assert.equal(storeText.includes(grant.grant), false);
    assert.equal(storeText.includes(grant.verificationCode), false);
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("secure pairing fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
