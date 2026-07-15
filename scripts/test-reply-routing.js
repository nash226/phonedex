"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-reply-routing-"));
const token = "reply-routing-fixture";

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function run() {
  const port = await availablePort();
  const task = {
    id: "task_exact",
    at: "2026-07-15T12:00:00.000Z",
    title: "Exact routing fixture",
    text: "Done",
    cwd: root,
    machineName: "Fixture Mac",
    sessionId: "thread_exact"
  };
  fs.writeFileSync(path.join(dataDir, "tasks.jsonl"), `${JSON.stringify(task)}\n`);

  const child = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(port),
      WATCH_BRIDGE_PUBLIC_URL: `http://127.0.0.1:${port}`,
      WATCH_BRIDGE_TOKEN: token,
      WATCH_BRIDGE_AUTO_RESUME: "false"
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(port);

    const missing = await postReply(port, {
      taskId: "task_missing",
      sessionId: "thread_exact"
    });
    assert.equal(missing.status, 404);

    const mismatch = await postReply(port, {
      taskId: task.id,
      sessionId: "thread_wrong"
    });
    assert.equal(mismatch.status, 409);

    const exact = await postReply(port, {
      taskId: task.id,
      sessionId: task.sessionId
    }, { useHeader: true, omitBodyToken: true });
    assert.equal(exact.status, 200);
    assert.equal(exact.body.recorded.taskId, task.id);
    assert.equal(exact.body.recorded.sessionId, task.sessionId);

    const replies = readJsonl(path.join(dataDir, "replies.jsonl"));
    assert.equal(replies.length, 1);
    assert.equal(replies[0].taskId, task.id);
    assert.equal(replies[0].sessionId, task.sessionId);
    console.log("exact reply routing fixture passed");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("close", resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (stderr) process.stderr.write(stderr);
  }
}

async function postReply(port, fields, options = {}) {
  const body = {
    choice: "custom",
    prompt: "Route this exactly",
    ...fields
  };
  if (!options.omitBodyToken) body.token = token;

  const response = await fetch(`http://127.0.0.1:${port}/reply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.useHeader ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for reply routing fixture server");
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(JSON.parse);
}
