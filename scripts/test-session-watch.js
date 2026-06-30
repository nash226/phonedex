#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-session-watch-"));
const codexHome = path.join(tmp, "codex-home");
const dataDir = path.join(tmp, "data");
const sessionsDir = path.join(codexHome, "sessions", "2026", "06", "30");

try {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  writeJsonl(
    path.join(sessionsDir, "rollout-2026-06-30T01-00-00-019faaaa-1111-7222-8333-444444444444.jsonl"),
    [
      {
        type: "session_meta",
        timestamp: "2026-06-30T01:00:00.000Z",
        payload: { cwd: "/tmp/phonedex-fixture-a" }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-30T01:01:00.000Z",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "Agent message final answer fixture"
        }
      }
    ]
  );

  writeJsonl(
    path.join(sessionsDir, "rollout-2026-06-30T02-00-00-019fbbbb-1111-7222-8333-555555555555.jsonl"),
    [
      {
        type: "session_meta",
        timestamp: "2026-06-30T02:00:00.000Z",
        payload: { cwd: "/tmp/phonedex-fixture-b" }
      },
      {
        type: "event_msg",
        timestamp: "2026-06-30T02:02:00.000Z",
        payload: {
          type: "task_complete",
          turn_id: "turn-fixture-b",
          completed_at: 1782784920,
          last_agent_message: "Task complete final answer fixture"
        }
      }
    ]
  );

  const result = spawnSync(
    process.execPath,
    [path.join(root, "bin", "codex-watch.js"), "scan-sessions", "--notify-existing"],
    {
      cwd: root,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        WATCH_BRIDGE_DATA_DIR: dataDir,
        WATCH_BRIDGE_PROVIDER: "pushcut",
        PUSHCUT_WEBHOOK_URL: "",
        WATCH_BRIDGE_TOKEN: "test-token",
        WATCHDEX_SESSION_WATCH_DEBOUNCE_MS: "0",
        WATCHDEX_SESSION_WATCH_LOOKBACK_HOURS: "87600",
        WATCHDEX_SESSION_WATCH_FILE_LIMIT: "20",
        PHONEDEX_MACHINE_NAME: "Session Fixture",
        PHONEDEX_DEVICE_ID: "session-fixture"
      },
      encoding: "utf8"
    }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }

  const tasks = readJsonl(path.join(dataDir, "tasks.jsonl"));
  assertTask(tasks, "Agent message final answer fixture", "019faaaa-1111-7222-8333-444444444444");
  assertTask(tasks, "Task complete final answer fixture", "019fbbbb-1111-7222-8333-555555555555");

  const parsed = JSON.parse(result.stdout);
  if (parsed.notified !== 2) {
    throw new Error(`Expected 2 fixture notifications, got ${parsed.notified}`);
  }

  console.log("session watcher fixture test passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function writeJsonl(filePath, records) {
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertTask(tasks, text, sessionId) {
  const task = tasks.find((candidate) => candidate.text === text);
  if (!task) {
    throw new Error(`Missing task text: ${text}`);
  }
  if (task.sessionId !== sessionId) {
    throw new Error(`Expected session ${sessionId} for ${text}, got ${task.sessionId}`);
  }
}
