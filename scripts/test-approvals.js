#!/usr/bin/env node

const assert = require("node:assert/strict");
const http = require("node:http");
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

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Keep the raw body for useful assertion failures.
  }
  return { response, json, text };
}

async function waitForHealth(url) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const result = await request(`${url}/health`);
      if (result.response.ok) return;
    } catch {
      // The child may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for PhoneDex health.");
}

function approvalRequest(
  id,
  state = "pending",
  expiresAt = "2099-07-15T12:15:00.000Z",
  requestedAt = "2026-07-15T12:00:00.000Z"
) {
  return {
    id,
    taskVersion: 5,
    operation: "Write generated files",
    scope: "PhoneDex workspace",
    origin: {
      deviceId: "agent-mac",
      machineName: "Build Mac",
      workspaceName: "PhoneDex"
    },
    reason: "The task is ready to update the generated project.",
    risk: "Changes files in the selected workspace.",
    requestedAt,
    expiresAt,
    state
  };
}

async function main() {
  const hubPort = await getFreePort();
  const originPort = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-approvals-"));
  const originRequests = [];
  const origin = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/command") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    originRequests.push(body.command);
    const command = body.command;
    const decision = command.kind === "approve" ? "approved" : "rejected";
    const nextVersion = command.expectedTaskVersion + 1;
    const receiptApprovalId = command.payload.approvalId === "approval_bad_receipt"
      ? "approval_other"
      : command.payload.approvalId;
    const task = {
      id: command.target.taskId,
      version: nextVersion,
      status: decision === "approved" ? "running" : "failed",
      title: "Approval task",
      text: decision === "approved" ? "Approval accepted." : "Approval rejected.",
      machineName: "Build Mac",
      deviceId: "agent-mac",
      lifecycleCapabilities: ["approval.respond.v1"],
      approvalRequest: {
        ...approvalRequest(command.payload.approvalId),
        taskVersion: nextVersion,
        state: decision
      }
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      state: "accepted",
      task,
      receipt: {
        schema: "phonedex.command-receipt.v1",
        protocolVersion: 1,
        commandId: command.commandId,
        createdAt: "2026-07-15T12:01:00.000Z",
        state: "accepted",
        taskId: task.id,
        taskVersion: nextVersion,
        idempotencyKey: command.idempotencyKey,
        approvalId: receiptApprovalId,
        approvalState: decision,
        approvalExpiresAt: task.approvalRequest.expiresAt,
        message: "Approval recorded by the supported agent."
      }
    }));
  });
  await new Promise((resolve) => origin.listen(originPort, "127.0.0.1", resolve));

  const env = {
    ...process.env,
    WATCH_BRIDGE_DATA_DIR: dataDir,
    WATCH_BRIDGE_HOST: "127.0.0.1",
    WATCH_BRIDGE_PORT: String(hubPort),
    WATCH_BRIDGE_PUBLIC_URL: `http://127.0.0.1:${hubPort}`,
    WATCH_BRIDGE_TOKEN: "hub-token",
    PHONEDEX_DEVICE_ID: "hub",
    PHONEDEX_ADAPTER_PLATFORM: "macos",
    PHONEDEX_WORKSPACE_ROOTS: dataDir,
    PUSHCUT_WEBHOOK_URL: ""
  };
  const hubURL = env.WATCH_BRIDGE_PUBLIC_URL;
  const server = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(hubURL);
    const baseTask = {
      title: "Approval task",
      text: "Review the pending operation.",
      status: "awaiting_approval",
      version: 5,
      machineName: "Build Mac",
      deviceId: "agent-mac",
      lifecycleCapabilities: ["approval.respond.v1"],
      approvalRequest: approvalRequest("approval_1"),
      commandUrl: `http://127.0.0.1:${originPort}/command`
    };
    const ingested = await request(`${hubURL}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({ task: baseTask })
    });
    assert.equal(ingested.response.status, 201);
    const taskId = ingested.json.task.id;

    const approved = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approve",
        taskId,
        approvalId: "approval_1",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-1",
        idempotencyKey: "approval-key-1"
      })
    });
    assert.equal(approved.response.status, 200, approved.text);
    assert.equal(approved.json.receipt.approvalId, "approval_1");
    assert.equal(approved.json.receipt.approvalState, "approved");
    assert.equal(approved.json.receipt.taskVersion, 6);
    assert.equal(approved.json.task.approvalRequest.state, "approved");
    assert.equal(originRequests.length, 1);

    const rejectedIngest = await request(`${hubURL}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        task: {
          ...baseTask,
          title: "Rejected approval",
          approvalRequest: approvalRequest("approval_rejected")
        }
      })
    });
    const rejected = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "reject",
        taskId: rejectedIngest.json.task.id,
        approvalId: "approval_rejected",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-rejected",
        idempotencyKey: "approval-key-rejected"
      })
    });
    assert.equal(rejected.response.status, 200, rejected.text);
    assert.equal(rejected.json.receipt.approvalState, "rejected");
    assert.equal(rejected.json.task.approvalRequest.state, "rejected");
    assert.equal(originRequests.length, 2);

    const duplicate = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approve",
        taskId,
        approvalId: "approval_1",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-1",
        idempotencyKey: "approval-key-1"
      })
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.json.duplicate, true);
    assert.equal(originRequests.length, 2);

    const stale = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "reject",
        taskId,
        approvalId: "approval_1",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-stale",
        idempotencyKey: "approval-key-stale"
      })
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.json.code, "task_stale");
    assert.equal(originRequests.length, 2);

    const badReceiptIngest = await request(`${hubURL}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        task: {
          ...baseTask,
          title: "Invalid origin receipt",
          approvalRequest: approvalRequest("approval_bad_receipt")
        }
      })
    });
    const badReceipt = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approve",
        taskId: badReceiptIngest.json.task.id,
        approvalId: "approval_bad_receipt",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-bad-receipt",
        idempotencyKey: "approval-key-bad-receipt"
      })
    });
    assert.equal(badReceipt.response.status, 502);
    assert.equal(badReceipt.json.code, "origin_invalid_receipt");
    assert.equal(originRequests.length, 3);

    const expiredIngest = await request(`${hubURL}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        task: {
          ...baseTask,
          title: "Expired approval",
          approvalRequest: approvalRequest(
            "approval_expired",
            "pending",
            "2020-01-01T00:00:00.000Z",
            "2019-12-31T23:00:00.000Z"
          )
        }
      })
    });
    assert.equal(expiredIngest.response.status, 201);
    const expired = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approve",
        taskId: expiredIngest.json.task.id,
        approvalId: "approval_expired",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-expired",
        idempotencyKey: "approval-key-expired"
      })
    });
    assert.equal(expired.response.status, 409);
    assert.equal(expired.json.code, "approval_expired");
    assert.equal(originRequests.length, 3);

    const noCapability = await request(`${hubURL}/tasks`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        task: {
          ...baseTask,
          title: "Unsupported approval",
          approvalRequest: approvalRequest("approval_unsupported"),
          lifecycleCapabilities: []
        }
      })
    });
    const unsupported = await request(`${hubURL}/command`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        kind: "approve",
        taskId: noCapability.json.task.id,
        approvalId: "approval_unsupported",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-unsupported",
        idempotencyKey: "approval-key-unsupported"
      })
    });
    assert.equal(unsupported.response.status, 409);
    assert.equal(unsupported.json.code, "capability_unsupported");
    assert.equal(originRequests.length, 3);

    const audit = fs.readFileSync(path.join(dataDir, "security-audit.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.action === "approval.decision");
    assert.ok(audit.some((entry) => entry.outcome === "approved" && entry.reason === "origin_receipt_accepted"));
    assert.ok(audit.some((entry) => entry.outcome === "rejected" && entry.reason === "origin_receipt_accepted"));
    assert.ok(audit.some((entry) => entry.outcome === "blocked" && entry.reason === "task_stale"));
    assert.ok(audit.some((entry) => entry.outcome === "blocked" && entry.reason === "origin_invalid_receipt"));
    assert.ok(audit.some((entry) => entry.outcome === "blocked" && entry.reason === "approval_expired"));
    assert.ok(audit.some((entry) => entry.outcome === "blocked" && entry.reason === "capability_unsupported"));
    assert.equal(JSON.stringify(audit).includes("Write files"), false);
    assert.equal(JSON.stringify(audit).includes("PhoneDex workspace"), false);
    assert.equal(JSON.stringify(audit).includes("Writes generated files"), false);
    assert.equal(JSON.stringify(audit).includes("Security fixture"), false);
  } finally {
    server.kill();
    await new Promise((resolve) => origin.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("approval response fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
