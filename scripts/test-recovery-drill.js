#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  CURRENT_VERSION,
  STORE_FILE,
  createPhoneDexStore
} = require("../lib/phonedex-store");

const now = "2026-07-15T12:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-recovery-drill-"));

function task(id, text) {
  return {
    id,
    at: now,
    createdAt: now,
    title: id,
    text,
    machineName: "MacBook Air",
    deviceId: "macbook-air",
    schema: "phonedex.task.v1",
    protocolVersion: 1,
    origin: { deviceId: "macbook-air", machineName: "MacBook Air" },
    status: "completed"
  };
}

function runReader(dataDir) {
  const script = [
    "const { createPhoneDexStore } = require(process.argv[1]);",
    "const store = createPhoneDexStore(process.argv[2]);",
    "process.stdout.write(JSON.stringify({ tasks: store.listTasks(), devices: store.listDevices() }));"
  ].join(" ");
  const result = spawnSync(process.execPath, ["-e", script, path.resolve(__dirname, "../lib/phonedex-store.js"), dataDir], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  const dataDir = path.join(root, "hub");
  fs.mkdirSync(dataDir, { recursive: true });

  // Stage 1: import the legacy projections without deleting the source files.
  fs.writeFileSync(
    path.join(dataDir, "tasks.jsonl"),
    `${JSON.stringify({
      id: "task_legacy",
      at: now,
      title: "Migrated task",
      text: "Legacy content survives the staged migration.",
      machineName: "MacBook Air",
      deviceId: "macbook-air"
    })}\n`
  );
  fs.writeFileSync(
    path.join(dataDir, "devices.json"),
    JSON.stringify({
      devices: [{
        deviceId: "macbook-air",
        machineName: "MacBook Air",
        platform: "macos",
        role: "agent",
        lastSeenAt: now
      }]
    })
  );

  const store = createPhoneDexStore(dataDir);
  assert.equal(store.read().migrations[0].from, "legacy-jsonl");
  assert.equal(fs.existsSync(path.join(dataDir, "tasks.jsonl")), true);
  assert.equal(fs.existsSync(path.join(dataDir, "devices.json")), true);

  // Stage 2: commit a known-good snapshot and verify the previous snapshot is
  // available before the next transaction.
  store.appendTask(task("task_after_migration", "Durable task"));
  store.upsertDevice({
    deviceId: "windows-desktop",
    machineName: "Windows Desktop",
    platform: "windows",
    role: "agent",
    lastSeenAt: now
  });
  const backup = JSON.parse(fs.readFileSync(store.paths.backupPath, "utf8"));
  assert.equal(backup.tasks.some((candidate) => candidate.id === "task_legacy"), true);
  assert.equal(backup.tasks.some((candidate) => candidate.id === "task_after_migration"), true);
  assert.equal(backup.devices.some((candidate) => candidate.deviceId === "windows-desktop"), false);

  // Stage 3: simulate an interrupted/corrupt replacement. A fresh process must
  // roll back to the last valid snapshot and quarantine the bad primary.
  fs.writeFileSync(store.paths.storePath, "{\"schema\":\"phonedex.store.v1\"}\n");
  const recovered = runReader(dataDir);
  assert.deepEqual(recovered.tasks.map((candidate) => candidate.id), [
    "task_legacy",
    "task_after_migration"
  ]);
  assert.deepEqual(recovered.devices.map((candidate) => candidate.deviceId), ["macbook-air"]);
  assert.equal(
    fs.readdirSync(dataDir).some((name) => name.startsWith(`${STORE_FILE}.corrupt-`)),
    true
  );

  // Stage 4: prove the recovered store remains writable and survives another
  // process restart without losing the rollback result.
  const restarted = createPhoneDexStore(dataDir);
  restarted.appendTask(task("task_after_recovery", "Recovery remained writable"));
  const finalState = runReader(dataDir);
  assert.deepEqual(finalState.tasks.map((candidate) => candidate.id), [
    "task_legacy",
    "task_after_migration",
    "task_after_recovery"
  ]);

  // Future schema versions must fail closed instead of silently rolling back
  // to an older interpretation of the data.
  const futureDir = path.join(root, "future");
  fs.mkdirSync(futureDir, { recursive: true });
  fs.writeFileSync(
    path.join(futureDir, STORE_FILE),
    JSON.stringify({ schema: "phonedex.store.v1", version: CURRENT_VERSION + 1 })
  );
  assert.throws(() => createPhoneDexStore(futureDir), /Unsupported PhoneDex store version/);

  console.log("staged migration and disaster-recovery drill passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
