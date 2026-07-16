#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  CURRENT_VERSION,
  STORE_FILE,
  createPhoneDexStore
} = require("../lib/phonedex-store");

const now = "2026-07-16T12:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-recovery-"));

function task(id) {
  return {
    id,
    at: now,
    createdAt: now,
    title: id,
    text: `Recovery drill task ${id}`,
    machineName: "MacBook Air",
    deviceId: "macbook-air",
    schema: "phonedex.task.v1",
    protocolVersion: 1,
    origin: { deviceId: "macbook-air", machineName: "MacBook Air" },
    status: "completed"
  };
}

try {
  const dataDir = path.join(root, "hub");
  const store = createPhoneDexStore(dataDir);
  assert.equal(store.appendTask(task("task_before_restart")).created, true);
  assert.equal(store.appendTask(task("task_after_restart")).created, true);

  const backupPath = path.join(dataDir, `${STORE_FILE}.bak`);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  assert.equal(backup.tasks.some((candidate) => candidate.id === "task_before_restart"), true);
  assert.equal(backup.tasks.some((candidate) => candidate.id === "task_after_restart"), false);

  fs.writeFileSync(path.join(dataDir, STORE_FILE), "corrupt snapshot\n");
  const recovered = createPhoneDexStore(dataDir);
  assert.deepEqual(
    recovered.listTasks().map((candidate) => candidate.id),
    ["task_before_restart"]
  );
  assert.equal(
    fs.readdirSync(dataDir).some((name) => name.startsWith(`${STORE_FILE}.corrupt-`)),
    true
  );

  const preservedState = recovered.read();
  fs.writeFileSync(
    path.join(dataDir, STORE_FILE),
    JSON.stringify({ schema: "phonedex.store.v1", version: CURRENT_VERSION + 1 })
  );
  assert.throws(() => createPhoneDexStore(dataDir), /Unsupported PhoneDex store version/);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dataDir, STORE_FILE), "utf8")).version,
    CURRENT_VERSION + 1
  );
  assert.equal(preservedState.tasks[0].id, "task_before_restart");

  console.log("PhoneDex recovery drill passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
