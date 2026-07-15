#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-foreground-submit-"));
const dataDir = path.join(tmp, "data");
const fakeBin = path.join(tmp, "bin");
const callsPath = path.join(tmp, "calls.jsonl");

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  writeRecorder("open");
  writeRecorder("osascript");

  const task = {
    id: "task-thread-route",
    title: "Targeted thread reply",
    cwd: root,
    sessionId: "thread/with spaces"
  };
  fs.writeFileSync(path.join(dataDir, "tasks.jsonl"), `${JSON.stringify(task)}\n`);

  const result = spawnSync(
    process.execPath,
    [bridge, "foreground-submit", "--taskId", task.id, "--prompt", "reply fixture"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        WATCH_BRIDGE_DATA_DIR: dataDir,
        PHONEDEX_FOREGROUND_APP: "ChatGPT",
        PHONEDEX_FOREGROUND_THREAD_OPEN_DELAY_MS: "0",
        PHONEDEX_TEST_CALLS_PATH: callsPath
      }
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = readJsonl(callsPath);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    command: "open",
    args: ["codex://threads/thread%2Fwith%20spaces"]
  });
  assert.equal(calls[1].command, "osascript");
  assert.deepEqual(calls[1].args.slice(-2), ["reply fixture", "ChatGPT"]);

  const events = readJsonl(path.join(dataDir, "events.jsonl"));
  const started = events.find((event) => event.type === "foreground-resume-worker-started");
  const submitted = events.find((event) => event.type === "foreground-resume-submitted");
  assert.equal(started.threadUrl, "codex://threads/thread%2Fwith%20spaces");
  assert.equal(started.foregroundApp, "ChatGPT");
  assert.equal(submitted.sessionId, task.sessionId);

  console.log("foreground thread routing fixture passed");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function writeRecorder(command) {
  const filePath = path.join(fakeBin, command);
  fs.writeFileSync(
    filePath,
    `#!/bin/sh\nnode -e 'const fs=require("node:fs"); fs.appendFileSync(process.env.PHONEDEX_TEST_CALLS_PATH, JSON.stringify({command:process.argv[1],args:process.argv.slice(2)})+"\\n")' ${shellQuote(command)} "$@"\n`
  );
  fs.chmodSync(filePath, 0o755);
}

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}
