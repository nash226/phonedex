#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

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

  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      PHONEDEX_AGENT_BUNDLE_DIR: bundleDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(port),
      WATCH_BRIDGE_PUBLIC_URL: hubUrl,
      WATCH_BRIDGE_TOKEN: "hub-token",
      WATCH_BRIDGE_PROVIDER: "pushcut",
      PUSHCUT_WEBHOOK_URL: ""
    }
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

    const traversal = await fetchText(
      `${hubUrl}/agent-bootstrap/%2Ftmp%2Fsecret?token=hub-token`
    );
    assert.equal(traversal.status, 400);

    const missing = await fetchText(`${hubUrl}/agent-bootstrap/missing.sh?token=hub-token`);
    assert.equal(missing.status, 404);
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
