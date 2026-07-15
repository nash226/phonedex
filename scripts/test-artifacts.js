#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  prepareTaskEvidenceArtifacts,
  readVerifiedArtifact,
  storeArtifact
} = require("../lib/phonedex-artifacts");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");
const content = Buffer.from("PhoneDex artifact export\n", "utf8");

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
  const bytes = Buffer.from(await response.arrayBuffer());
  let json;
  try { json = JSON.parse(bytes.toString("utf8")); } catch { json = null; }
  return { response, bytes, json };
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const result = await request(url);
      if (result.response.ok) return;
    } catch {
      // Keep polling until the bridge is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for artifact bridge health");
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-artifacts-"));
  const prepared = prepareTaskEvidenceArtifacts(dataDir, {
    artifacts: [{
      id: "build-log",
      name: "Build log",
      kind: "log",
      sourceRef: "artifacts/build.log",
      mediaType: "text/plain",
      contentBase64: content.toString("base64")
    }]
  }, "task_local");
  const metadata = prepared.artifacts[0];
  assert.equal(Object.hasOwn(metadata, "contentBase64"), false);
  assert.equal(metadata.sizeBytes, content.length);
  assert.equal(metadata.sha256, require("node:crypto").createHash("sha256").update(content).digest("hex"));
  assert.ok(metadata.downloadId);
  assert.deepEqual(readVerifiedArtifact(dataDir, metadata.downloadId).bytes, content);
  assert.throws(
    () => storeArtifact(dataDir, {
      taskId: "task_local",
      artifact: { ...metadata, sha256: "0".repeat(64) },
      contentBase64: content.toString("base64")
    }),
    (error) => error.code === "artifact_digest_mismatch"
  );

  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const serverDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-artifacts-server-"));
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: serverDataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(port),
      WATCH_BRIDGE_PUBLIC_URL: url,
      WATCH_BRIDGE_TOKEN: "artifact-token",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${url}/health`);
    const unauthenticated = await request(`${url}/artifacts/${metadata.downloadId}`);
    assert.equal(unauthenticated.response.status, 401);

    const ingested = await request(`${url}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer artifact-token", "content-type": "application/json" },
      body: JSON.stringify({
        id: "artifact-task",
        title: "Review exported build",
        text: "The build log is ready.",
        evidence: {
          artifacts: [{
            id: "build-log",
            name: "Build log",
            kind: "log",
            sourceRef: "artifacts/build.log",
            mediaType: "text/plain",
            contentBase64: content.toString("base64")
          }]
        }
      })
    });
    assert.equal(ingested.response.status, 201);
    const artifact = ingested.json.task.evidence.artifacts[0];
    assert.equal(artifact.sizeBytes, content.length);
    assert.equal(artifact.sha256.length, 64);
    assert.ok(artifact.downloadId);

    const forwarded = await request(`${url}/artifacts`, {
      method: "POST",
      headers: { authorization: "Bearer artifact-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId: "artifact-task",
        artifactId: artifact.id,
        downloadId: artifact.downloadId,
        contentBase64: content.toString("base64")
      })
    });
    assert.equal(forwarded.response.status, 201);
    assert.equal(forwarded.json.artifact.sha256, artifact.sha256);

    const downloaded = await request(`${url}/artifacts/${artifact.downloadId}`, {
      headers: { authorization: "Bearer artifact-token" }
    });
    assert.equal(downloaded.response.status, 200);
    assert.deepEqual(downloaded.bytes, content);
    assert.equal(downloaded.response.headers.get("x-content-type-options"), "nosniff");
    assert.match(downloaded.response.headers.get("content-disposition"), /attachment;/);

    fs.writeFileSync(path.join(serverDataDir, "artifacts", `${artifact.downloadId}.bin`), "tampered");
    const tampered = await request(`${url}/artifacts/${artifact.downloadId}`, {
      headers: { authorization: "Bearer artifact-token" }
    });
    assert.equal(tampered.response.status, 409);
    assert.equal(tampered.json.code, "artifact_integrity_failed");
  } finally {
    hub.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(serverDataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("PhoneDex artifact delivery fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
