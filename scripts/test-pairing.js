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

  const invalidScopeGrant = spawnSync(
    process.execPath,
    [bridge, "pair:create", "--scopes", "tasks.read,not-a-phone-scope"],
    { cwd: root, env, encoding: "utf8" }
  );
  assert.notEqual(invalidScopeGrant.status, 0);
  assert.match(invalidScopeGrant.stderr, /Unsupported PhoneDex pairing scope/);

  const adminGrantProcess = spawnSync(
    process.execPath,
    [
      bridge,
      "pair:create",
      "--name",
      "PhoneDex Admin",
      "--scopes",
      "tasks.read,privacy.read,privacy.manage,admin",
      "--ttl-ms",
      "600000"
    ],
    { cwd: root, env, encoding: "utf8" }
  );
  assert.equal(adminGrantProcess.status, 0, adminGrantProcess.stderr);
  const adminGrant = JSON.parse(adminGrantProcess.stdout);
  assert.deepEqual(adminGrant.scopes, ["tasks.read", "privacy.read", "privacy.manage", "admin"]);

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

    const phonePrivacy = await request(`${hubUrl}/privacy`, {
      headers: { authorization: `Bearer ${paired.json.credential}` }
    });
    assert.equal(phonePrivacy.response.status, 401);

    const adminPaired = await request(`${hubUrl}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant: adminGrant.grant,
        verificationCode: adminGrant.verificationCode,
        deviceName: "PhoneDex Admin",
        platform: "ios"
      })
    });
    assert.equal(adminPaired.response.status, 201);
    assert.deepEqual(adminPaired.json.identity.scopes, adminGrant.scopes);

    const adminPrivacy = await request(`${hubUrl}/privacy`, {
      headers: { authorization: `Bearer ${adminPaired.json.credential}` }
    });
    assert.equal(adminPrivacy.response.status, 200);

    const phoneInstallReports = await request(`${hubUrl}/agent-installs`, {
      headers: { authorization: `Bearer ${paired.json.credential}` }
    });
    assert.equal(phoneInstallReports.response.status, 401);

    const adminInstallReports = await request(`${hubUrl}/agent-installs`, {
      headers: { authorization: `Bearer ${adminPaired.json.credential}` }
    });
    assert.equal(adminInstallReports.response.status, 200);

    const adminRetention = await request(`${hubUrl}/privacy/retention`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminPaired.json.credential}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ retentionDays: 0, confirmation: "APPLY_PHONEDEX_RETENTION" })
    });
    assert.equal(adminRetention.response.status, 200);

    const adminCredentialInURL = await request(
      `${hubUrl}/privacy?token=${encodeURIComponent(adminPaired.json.credential)}`
    );
    assert.equal(adminCredentialInURL.response.status, 401);

    const listed = spawnSync(
      process.execPath,
      [bridge, "pair:list", "--json"],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(listed.status, 0, listed.stderr);
    const identities = JSON.parse(listed.stdout);
    assert.equal(identities.length, 2);
    assert.equal(identities.find((identity) => identity.id === paired.json.identity.id).name, "Nash iPhone");
    assert.equal(identities.find((identity) => identity.id === adminPaired.json.identity.id).name, "PhoneDex Admin");
    assert.equal(listed.stdout.includes(paired.json.credential), false);

    const revoked = spawnSync(
      process.execPath,
      [bridge, "pair:revoke", "--identity", paired.json.identity.id, "--json"],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(revoked.status, 0, revoked.stderr);
    assert.equal(JSON.parse(revoked.stdout).identity.status, "revoked");

    const repeatedRevoke = spawnSync(
      process.execPath,
      [bridge, "pair:revoke", "--device-id", paired.json.identity.deviceId, "--json"],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(repeatedRevoke.status, 0, repeatedRevoke.stderr);
    assert.equal(JSON.parse(repeatedRevoke.stdout).changed, false);

    const revokedSync = await request(`${hubUrl}/sync`, {
      headers: { authorization: `Bearer ${paired.json.credential}` }
    });
    assert.equal(revokedSync.response.status, 401);

    const revokedDevices = await request(`${hubUrl}/devices`, {
      headers: { authorization: `Bearer ${env.WATCH_BRIDGE_TOKEN}` }
    });
    assert.equal(revokedDevices.response.status, 200);
    assert.equal(
      revokedDevices.json.find((device) => device.deviceId === paired.json.identity.deviceId).status,
      "revoked"
    );

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
