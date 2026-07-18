#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `phonedex-${name}-`));
}

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Timed out waiting for hub health");
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    text: await response.text()
  };
}

function runAgentInvite(env) {
  const result = spawnSync(
    process.execPath,
    [bridge, "agent-invite", "--json", "--ttl-ms", "60000"],
    {
      cwd: root,
      encoding: "utf8",
      env
    }
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

function listAgentInvites(env) {
  const result = spawnSync(
    process.execPath,
    [bridge, "agent-invite", "--list", "--json"],
    {
      cwd: root,
      encoding: "utf8",
      env
    }
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

function createInvite(env, ttlMs = 60000) {
  const result = spawnSync(
    process.execPath,
    [bridge, "agent-invite", "--json", "--ttl-ms", String(ttlMs)],
    {
      cwd: root,
      encoding: "utf8",
      env
    }
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

async function main() {
  const port = await getFreePort();
  const hubUrl = `http://127.0.0.1:${port}`;
  const dataDir = makeTempDir("bootstrap-data");
  const bundleDir = makeTempDir("bootstrap-files");

  fs.writeFileSync(
    path.join(bundleDir, "manifest.json"),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      hubUrl,
      targets: [
        {
          deviceId: "macbook-air",
          machineName: "MacBook Air",
          platform: "macos",
          fileName: "macbook-air.sh"
        }
      ]
    })}\n`
  );
  fs.writeFileSync(
    path.join(bundleDir, "macbook-air.sh"),
    "#!/usr/bin/env bash\nPHONEDEX_HUB_TOKEN=hub-token\n"
  );

  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    PHONEDEX_AGENT_BUNDLE_DIR: bundleDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(port),
    WATCH_BRIDGE_PUBLIC_URL: hubUrl,
    WATCH_BRIDGE_TOKEN: "hub-token",
    PHONEDEX_ENABLE_LEGACY_QUERY_TOKENS: "true",
    PHONEDEX_AGENT_INVITE_MAX_ACTIVE: "3",
    WATCH_BRIDGE_PROVIDER: "pushcut",
    PUSHCUT_WEBHOOK_URL: ""
  };
  const invite = runAgentInvite(env);
  assert.match(invite.setupUrl, /\/agent-bootstrap\/invite\//);
  assert.doesNotMatch(invite.setupUrl, /hub-token/);

  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });

  let stdout = "";
  let stderr = "";
  hub.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  hub.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  try {
    await waitForHealth(`${hubUrl}/health`);

    const blocked = await fetchText(`${hubUrl}/agent-bootstrap/manifest.json`);
    assert.equal(blocked.status, 401);

    const manifest = await fetchText(`${hubUrl}/agent-bootstrap`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(manifest.status, 200);
    assert.match(manifest.contentType, /application\/json/);
    assert.equal(JSON.parse(manifest.text).targets[0].deviceId, "macbook-air");

    const script = await fetchText(`${hubUrl}/agent-bootstrap/macbook-air.sh?token=hub-token`);
    assert.equal(script.status, 200);
    assert.match(script.contentType, /text\/x-shellscript/);
    assert.equal(script.cacheControl, "no-store");
    assert.match(script.text, /PHONEDEX_HUB_TOKEN=hub-token/);

    const installReport = await fetchText(`${hubUrl}/agent-installs`, {
      method: "POST",
      body: new URLSearchParams({
        token: "hub-token",
        deviceId: "macbook-air",
        machineName: "MacBook Air",
        platform: "macos",
        stage: "self-test-passed",
        ok: "true",
        message: "ready"
      })
    });
    assert.equal(installReport.status, 201);

    const setupJson = await fetchText(`${hubUrl}/agent-bootstrap/setup.json`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(setupJson.status, 200);
    const setup = JSON.parse(setupJson.text);
    assert.equal(setup.targets[0].deviceId, "macbook-air");
    assert.equal(setup.targets[0].install.stage, "self-test-passed");
    assert.equal(setup.targets[0].install.ok, true);
    assert.match(setup.targets[0].downloadUrl, /token=hub-token/);
    assert.match(setup.targets[0].commands.join("\n"), /curl -fsSL/);

    const setupPage = await fetchText(`${hubUrl}/agent-bootstrap/setup?token=hub-token`);
    assert.equal(setupPage.status, 200);
    assert.match(setupPage.contentType, /text\/html/);
    assert.match(setupPage.text, /PhoneDex Agent Setup/);
    assert.match(setupPage.text, /MacBook Air/);
    assert.match(setupPage.text, /self-test-passed OK/);
    assert.match(setupPage.text, /curl -fsSL/);

    const invitePage = await fetchText(invite.setupUrl);
    assert.equal(invitePage.status, 200);
    assert.match(invitePage.contentType, /text\/html/);
    assert.equal(invitePage.cacheControl, "no-store");
    assert.match(invitePage.text, /PhoneDex Agent Setup/);
    assert.match(invitePage.text, /Invite expires/);
    assert.match(invitePage.text, /MacBook Air/);
    assert.match(invitePage.text, /agent-bootstrap\/invite/);
    assert.doesNotMatch(invitePage.text, /token=hub-token/);

    const inviteScriptUrl = `${invite.setupUrl}/macbook-air.sh`;
    const inviteScript = await fetchText(inviteScriptUrl);
    assert.equal(inviteScript.status, 200);
    assert.match(inviteScript.contentType, /text\/x-shellscript/);
    assert.equal(inviteScript.cacheControl, "no-store");
    assert.match(inviteScript.text, /PHONEDEX_HUB_TOKEN=hub-token/);

    const invitesAfterUse = listAgentInvites(env);
    const usedInvite = invitesAfterUse.find((candidate) => candidate.code === invite.code);
    assert.equal(usedInvite.uses, 2);
    assert.equal(usedInvite.lastEventType, "download");
    assert.equal(usedInvite.lastFileName, "macbook-air.sh");
    assert.deepEqual(
      usedInvite.events.map((event) => event.type),
      ["page", "download"]
    );

    const badInvite = await fetchText(`${hubUrl}/agent-bootstrap/invite/not-valid`);
    assert.equal(badInvite.status, 401);

    const badInvitePath = await fetchText(`${invite.setupUrl}/../../secret`);
    assert.equal(badInvitePath.status, 401);

    const traversal = await fetchText(
      `${hubUrl}/agent-bootstrap/%2Ftmp%2Fsecret?token=hub-token`
    );
    assert.equal(traversal.status, 400);

    const missing = await fetchText(`${hubUrl}/agent-bootstrap/missing.sh?token=hub-token`);
    assert.equal(missing.status, 404);

    const first = createInvite(env);
    const second = createInvite(env);
    const third = createInvite(env);
    const fourth = createInvite(env);
    const retained = listAgentInvites(env);
    assert.equal(retained.length, 3);
    assert.equal(retained.some((candidate) => candidate.code === invite.code), true);
    assert.equal(retained.some((candidate) => candidate.code === first.code), false);
    assert.equal(retained.some((candidate) => candidate.code === second.code), false);
    assert.equal(retained.some((candidate) => candidate.code === third.code), true);
    assert.equal(retained.some((candidate) => candidate.code === fourth.code), true);

    await fetchText(third.setupUrl);
    await fetchText(fourth.setupUrl);
    const newest = createInvite(env);
    const retainedAfterUsedLinks = listAgentInvites(env);
    assert.equal(retainedAfterUsedLinks.length, 3);
    assert.equal(
      retainedAfterUsedLinks.some((candidate) => candidate.code === newest.code),
      true
    );
  } finally {
    hub.kill();
  }

  assert.equal(stderr, "");
  assert.match(stdout, /PhoneDex listening/);
  console.log("agent bootstrap server fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
