#!/usr/bin/env node

const assert = require("node:assert/strict");
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

  const hook = runHook({
    sessionId: "019faaaa-1111-7222-8333-444444444444",
    messageId: "2026-06-30T01:01:00.000Z",
    last_assistant_message: "Agent message final answer fixture"
  });
  if (hook.status !== 0) {
    process.stderr.write(hook.stdout);
    process.stderr.write(hook.stderr);
    process.exit(hook.status || 1);
  }

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
  if (parsed.notified !== 1) {
    throw new Error(`Expected 1 fixture notification after hook convergence, got ${parsed.notified}`);
  }

  const storePath = path.join(dataDir, "phonedex-store.json");
  const initialStore = JSON.parse(fs.readFileSync(storePath, "utf8"));
  assert.equal(initialStore.tasks.length, 2);
  assertCaptureSources(
    initialStore.tasks,
    "Agent message final answer fixture",
    ["codex-stop-hook", "codex-session-watch"]
  );
  assertCaptureSources(initialStore.tasks, "Task complete final answer fixture", ["codex-session-watch"]);

  const hookAfterWatcher = runHook({
    sessionId: "019fbbbb-1111-7222-8333-555555555555",
    messageId: "turn-fixture-b",
    last_assistant_message: "Task complete final answer fixture"
  });
  if (hookAfterWatcher.status !== 0) {
    process.stderr.write(hookAfterWatcher.stdout);
    process.stderr.write(hookAfterWatcher.stderr);
    process.exit(hookAfterWatcher.status || 1);
  }

  const convergedStore = JSON.parse(fs.readFileSync(storePath, "utf8"));
  assert.equal(convergedStore.tasks.length, 2);
  assertCaptureSources(
    convergedStore.tasks,
    "Task complete final answer fixture",
    ["codex-session-watch", "codex-stop-hook"]
  );

  const statePath = path.join(dataDir, "session-watch-state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.seen = {};
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

  const replay = runSessionScan();
  if (replay.status !== 0) {
    process.stderr.write(replay.stdout);
    process.stderr.write(replay.stderr);
    process.exit(replay.status || 1);
  }

  const replayResult = JSON.parse(replay.stdout);
  if (replayResult.notified !== 0) {
    throw new Error(`Expected file cursors to suppress replay, got ${replayResult.notified}`);
  }
  const eventsPath = path.join(dataDir, "events.jsonl");
  const duplicateEvents = fs.existsSync(eventsPath)
    ? readJsonl(eventsPath).filter((event) => event.type === "duplicate-task-ignored")
    : [];
  if (duplicateEvents.length !== 0) {
    throw new Error(`Expected no duplicate-task audit writes, got ${duplicateEvents.length}`);
  }

  console.log("session watcher fixture test passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function runSessionScan() {
  return spawnSync(
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
}

function runHook(payload) {
  return spawnSync(
    process.execPath,
    [path.join(root, "bin", "codex-watch.js"), "hook"],
    {
      cwd: root,
      input: `${JSON.stringify(payload)}\n`,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        WATCH_BRIDGE_DATA_DIR: dataDir,
        WATCH_BRIDGE_PROVIDER: "pushcut",
        PUSHCUT_WEBHOOK_URL: "",
        WATCH_BRIDGE_TOKEN: "test-token",
        WATCHDEX_SESSION_WATCH_DEBOUNCE_MS: "0",
        PHONEDEX_MACHINE_NAME: "Session Fixture",
        PHONEDEX_DEVICE_ID: "session-fixture"
      },
      encoding: "utf8"
    }
  );
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

function assertCaptureSources(storeTasks, text, expectedSources) {
  const task = storeTasks.find((candidate) => candidate.text === text);
  assert.ok(task, `Missing store task text: ${text}`);
  assert.deepEqual(
    task.captureSources.map((capture) => capture.source),
    expectedSources
  );
  assert.match(task.logicalEventId, /^completion_[0-9a-f]{32}$/);
}
