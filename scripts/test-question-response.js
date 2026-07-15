#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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
  return { response, json: text ? JSON.parse(text) : null };
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
  throw new Error("Timed out waiting for question-response bridge health");
}

async function main() {
  const bridgePort = await getFreePort();
  const originPort = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-question-response-"));
  let forwardedBody;
  const origin = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/reply") {
      res.writeHead(404).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    forwardedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => origin.listen(originPort, "127.0.0.1", resolve));

  const hubUrl = `http://127.0.0.1:${bridgePort}`;
  const hub = spawn(process.execPath, [bridge, "server"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      WATCH_BRIDGE_HOST: "127.0.0.1",
      WATCH_BRIDGE_PORT: String(bridgePort),
      WATCH_BRIDGE_PUBLIC_URL: hubUrl,
      WATCH_BRIDGE_TOKEN: "hub-token",
      PUSHCUT_WEBHOOK_URL: ""
    }
  });
  let stderr = "";
  hub.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

  try {
    await waitForHealth(`${hubUrl}/health`);
    const invalidTask = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: {
        authorization: "Bearer hub-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Invalid question",
        question: {
          id: "duplicate-choice",
          prompt: "Choose one",
          choices: [
            { id: "same", label: "One" },
            { id: "same", label: "Two" }
          ],
          allowsFreeText: false
        }
      })
    });
    assert.equal(invalidTask.response.status, 400);
    assert.equal(invalidTask.json.code, "invalid_task_question");

    const task = await request(`${hubUrl}/tasks`, {
      method: "POST",
      headers: {
        authorization: "Bearer hub-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: "origin-question-task",
        title: "Choose a deployment target",
        text: "The release is ready for your decision.",
        status: "needs_input",
        version: 4,
        machineName: "Windows Workstation",
        deviceId: "windows-workstation",
        replyUrl: `http://127.0.0.1:${originPort}/reply`,
        replyToken: "origin-token",
        question: {
          id: "deploy-target",
          prompt: "Where should the release go?",
          choices: [
            { id: "staging", label: "Deploy to staging" },
            { id: "production", label: "Deploy to production" }
          ],
          allowsFreeText: true
        }
      })
    });
    assert.equal(task.response.status, 201);
    assert.deepEqual(task.json.task.question, {
      id: "deploy-target",
      prompt: "Where should the release go?",
      choices: [
        { id: "staging", label: "Deploy to staging" },
        { id: "production", label: "Deploy to production" }
      ],
      allowsFreeText: true
    });
    const taskId = task.json.task.id;

    const missingQuestionId = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({ taskId, expectedTaskVersion: 4, response: { kind: "choice", choiceId: "staging" } })
    });
    assert.equal(missingQuestionId.response.status, 400);
    assert.equal(missingQuestionId.json.code, "question_required");

    const invalidChoice = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 4,
        questionId: "deploy-target",
        response: { kind: "choice", choiceId: "later" }
      })
    });
    assert.equal(invalidChoice.response.status, 422);
    assert.equal(invalidChoice.json.code, "question_choice_invalid");

    const staleQuestion = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 4,
        questionId: "old-question",
        response: { kind: "choice", choiceId: "staging" }
      })
    });
    assert.equal(staleQuestion.response.status, 409);
    assert.equal(staleQuestion.json.code, "question_stale");

    const accepted = await request(`${hubUrl}/reply`, {
      method: "POST",
      headers: { authorization: "Bearer hub-token", "content-type": "application/json" },
      body: JSON.stringify({
        taskId,
        expectedTaskVersion: 4,
        questionId: "deploy-target",
        response: { kind: "choice", choiceId: "staging" },
        commandId: "question-command-1",
        idempotencyKey: "question-reply-1"
      })
    });
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.json.receipt.state, "completed");
    assert.deepEqual(accepted.json.recorded.questionResponse, {
      kind: "choice",
      choiceId: "staging"
    });
    assert.equal(accepted.json.recorded.prompt, "Deploy to staging");
    assert.equal(forwardedBody.questionId, "deploy-target");
    assert.deepEqual(forwardedBody.response, { kind: "choice", choiceId: "staging" });
    assert.equal(forwardedBody.token, "origin-token");

    const commands = fs.readFileSync(path.join(dataDir, "commands.jsonl"), "utf8");
    assert.match(commands, /"questionId":"deploy-target"/);
    assert.match(commands, /"choiceId":"staging"/);
  } finally {
    hub.kill();
    await new Promise((resolve) => origin.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  assert.equal(stderr, "");
  console.log("structured question-response fixture passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
