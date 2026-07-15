#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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
    // Keep the raw response for useful assertion failures.
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
    state: "pending"
  };
}

function createGrant(dataDir, name, scopes) {
  const result = spawnSync(
    process.execPath,
    [bridge, "pair:create", "--name", name, "--scopes", scopes.join(",")],
    {
      cwd: root,
      env: { ...process.env, WATCH_BRIDGE_DATA_DIR: dataDir },
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function redeem(baseURL, grant, deviceName) {
  const paired = await request(`${baseURL}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant: grant.grant,
      verificationCode: grant.verificationCode,
      deviceName,
      platform: "ios"
    })
  });
  assert.equal(paired.response.status, 201, paired.text);
  return paired.json;
}

function command(taskId, approvalId, suffix, credential) {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      kind: "approve",
      taskId,
      approvalId,
      approvalTaskVersion: 5,
      expectedTaskVersion: 5,
      commandId: `approval-command-${suffix}`,
      idempotencyKey: `approval-key-${suffix}`
    })
  };
}

async function ingest(baseURL, approvalId, originPort, extra = {}) {
  const result = await request(`${baseURL}/tasks`, {
    method: "POST",
    headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
    body: JSON.stringify({
      task: {
        id: `task-${approvalId}`,
        title: `Approval ${approvalId}`,
        text: "Review the pending operation.",
        status: "awaiting_approval",
        version: 5,
        machineName: "Build Mac",
        deviceId: "agent-mac",
        lifecycleCapabilities: ["approval.respond.v1"],
        approvalRequest: approvalRequest(approvalId, extra.expiresAt, extra.requestedAt),
        commandUrl: `http://127.0.0.1:${originPort}/command`,
        ...extra
      }
    })
  });
  assert.equal(result.response.status, 201, result.text);
  return result.json.task.id;
}

async function main() {
  const hubPort = await getFreePort();
  const originPort = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-approval-adversarial-"));
  const originRequests = [];
  const origin = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/command") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const commandBody = body.command;
    const approvalId = commandBody.payload.approvalId;
    originRequests.push(approvalId);
    if (approvalId === "approval_outage") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "origin_unavailable", error: "Agent is offline." }));
      return;
    }

    const decision = commandBody.kind === "approve" ? "approved" : "rejected";
    const nextVersion = commandBody.expectedTaskVersion + 1;
    const returnedApprovalId = approvalId === "approval_bad_receipt" ? "approval_other" : approvalId;
    const task = {
      id: commandBody.target.taskId,
      version: nextVersion,
      status: "running",
      title: "Approved task",
      text: "Approval accepted.",
      machineName: "Build Mac",
      deviceId: "agent-mac",
      lifecycleCapabilities: ["approval.respond.v1"],
      approvalRequest: {
        ...approvalRequest(returnedApprovalId),
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
        commandId: commandBody.commandId,
        createdAt: "2026-07-15T12:01:00.000Z",
        state: "accepted",
        taskId: task.id,
        taskVersion: nextVersion,
        idempotencyKey: commandBody.idempotencyKey,
        approvalId: returnedApprovalId,
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
  const replyGrant = createGrant(dataDir, "Reply-only iPhone", ["tasks.read", "tasks.reply"]);
  const approvalGrant = createGrant(dataDir, "Approval iPhone", ["tasks.read", "tasks.reply", "tasks.approve"]);
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(hubURL);
    const replyIdentity = await redeem(hubURL, replyGrant, "Reply-only iPhone");
    const approvalIdentity = await redeem(hubURL, approvalGrant, "Approval iPhone");

    const leastPrivilegeTask = await ingest(hubURL, "approval_least_privilege", originPort);
    const denied = await request(
      `${hubURL}/command`,
      command(leastPrivilegeTask, "approval_least_privilege", "least-privilege", replyIdentity.credential)
    );
    assert.equal(denied.response.status, 401);
    assert.equal(originRequests.length, 0);

    const approvedTask = await ingest(hubURL, "approval_replay", originPort);
    const approved = await request(
      `${hubURL}/command`,
      command(approvedTask, "approval_replay", "replay", approvalIdentity.credential)
    );
    assert.equal(approved.response.status, 200, approved.text);
    assert.equal(originRequests.length, 1);

    const duplicate = await request(
      `${hubURL}/command`,
      command(approvedTask, "approval_replay", "replay", approvalIdentity.credential)
    );
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.json.duplicate, true);
    assert.equal(originRequests.length, 1);

    const mutatedReplay = await request(`${hubURL}/command`, {
      ...command(approvedTask, "approval_replay", "replay", approvalIdentity.credential),
      body: JSON.stringify({
        kind: "reject",
        taskId: approvedTask,
        approvalId: "approval_replay",
        approvalTaskVersion: 5,
        expectedTaskVersion: 5,
        commandId: "approval-command-mutated",
        idempotencyKey: "approval-key-replay"
      })
    });
    assert.equal(mutatedReplay.response.status, 409);
    assert.equal(mutatedReplay.json.code, "replay_conflict");
    assert.equal(originRequests.length, 1);

    const expiredTask = await ingest(hubURL, "approval_expired_adversarial", originPort, {
      expiresAt: "2020-01-01T00:00:00.000Z",
      requestedAt: "2019-12-31T23:00:00.000Z"
    });
    const expired = await request(
      `${hubURL}/command`,
      command(expiredTask, "approval_expired_adversarial", "expired", approvalIdentity.credential)
    );
    assert.equal(expired.response.status, 409);
    assert.equal(expired.json.code, "approval_expired");
    assert.equal(originRequests.length, 1);

    const outageTask = await ingest(hubURL, "approval_outage", originPort);
    const outage = await request(
      `${hubURL}/command`,
      command(outageTask, "approval_outage", "outage", approvalIdentity.credential)
    );
    assert.equal(outage.response.status, 503);
    assert.equal(outage.json.code, "origin_unavailable");
    assert.equal(originRequests.length, 2);
    const afterOutage = await request(`${hubURL}/tasks?limit=all`, {
      headers: { authorization: "Bearer hub-token" }
    });
    assert.equal(afterOutage.response.status, 200);
    assert.equal(afterOutage.json.find((task) => task.id === outageTask).status, "awaiting_approval");

    const badReceiptTask = await ingest(hubURL, "approval_bad_receipt", originPort);
    const badReceipt = await request(
      `${hubURL}/command`,
      command(badReceiptTask, "approval_bad_receipt", "bad-receipt", approvalIdentity.credential)
    );
    assert.equal(badReceipt.response.status, 502);
    assert.equal(badReceipt.json.code, "origin_invalid_receipt");
    assert.equal(originRequests.length, 3);

    const revokedTask = await ingest(hubURL, "approval_revoked", originPort);
    const revoke = spawnSync(
      process.execPath,
      [bridge, "pair:revoke", "--identity", approvalIdentity.identity.id],
      { cwd: root, env, encoding: "utf8" }
    );
    assert.equal(revoke.status, 0, revoke.stderr);
    const revoked = await request(
      `${hubURL}/command`,
      command(revokedTask, "approval_revoked", "revoked", approvalIdentity.credential)
    );
    assert.equal(revoked.response.status, 401);
    assert.equal(originRequests.length, 3);
  } finally {
    hub.kill();
    await new Promise((resolve) => origin.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("approval adversarial fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
