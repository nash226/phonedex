#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-notification-policy-"));
const dataDir = path.join(tmp, "data");
const normalCwd = path.join(tmp, "projects", "PhoneDex");
const workerCwd = path.join(tmp, ".codex", "worktrees", "abcd", "PhoneDex");

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(normalCwd, { recursive: true });
  fs.mkdirSync(workerCwd, { recursive: true });

  runHook(normalCwd, "thread-normal", "Normal task completed");
  runHook(workerCwd, "thread-worker", "Automated worker completed");

  const events = readJsonl(path.join(dataDir, "events.jsonl"));
  const normalTask = findTask("Normal task completed");
  const workerTask = findTask("Automated worker completed");

  assert.equal(
    events.some((event) => event.type === "notification-attempt" && event.taskId === normalTask.id),
    true
  );
  assert.equal(
    events.some((event) => event.type === "notification-attempt" && event.taskId === workerTask.id),
    false
  );
  assert.equal(
    events.some((event) =>
      event.type === "notification-suppressed" &&
      event.taskId === workerTask.id &&
      event.reason === "Automated Codex git-worktree worker"
    ),
    true
  );
  console.log("notification policy fixture passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function runHook(cwd, sessionId, message) {
  const result = spawnSync(process.execPath, [bridge, "hook"], {
    cwd,
    input: `${JSON.stringify({
      session_id: sessionId,
      last_assistant_message: message
    })}\n`,
    env: {
      ...process.env,
      WATCH_BRIDGE_DATA_DIR: dataDir,
      WATCH_BRIDGE_PROVIDER: "pushcut",
      PUSHCUT_WEBHOOK_URL: "",
      WATCH_BRIDGE_TOKEN: "test-token",
      PHONEDEX_MACHINE_NAME: "Notification Fixture",
      PHONEDEX_DEVICE_ID: "notification-fixture"
    },
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Hook exited ${result.status}`);
  }
}

function findTask(text) {
  const store = JSON.parse(fs.readFileSync(path.join(dataDir, "phonedex-store.json"), "utf8"));
  return store.tasks.find((task) => task.text === text);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(JSON.parse);
}
