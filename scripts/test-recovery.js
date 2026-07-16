#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { CURRENT_VERSION, STORE_FILE, createPhoneDexStore } = require("../lib/phonedex-store");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-recovery-"));
const legacyDir = path.join(root, "legacy");
const backupDir = path.join(root, "backup");
const restoredDir = path.join(root, "restored");
const now = "2026-07-15T12:00:00.000Z";

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyDataDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function digestDirectory(directory) {
  return fs.readdirSync(directory).sort().reduce((result, name) => {
    const filePath = path.join(directory, name);
    if (fs.statSync(filePath).isDirectory()) return result;
    result[name] = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    return result;
  }, {});
}

function task(id, text) {
  return {
    id,
    at: now,
    createdAt: now,
    title: id,
    text,
    machineName: "Recovery Mac",
    deviceId: "recovery-mac",
    status: "completed"
  };
}

try {
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyDir, "tasks.jsonl"),
    `${JSON.stringify(task("legacy-task", "preserve this task"))}\n`
  );
  writeJson(path.join(legacyDir, "devices.json"), {
    devices: [{
      deviceId: "recovery-mac",
      machineName: "Recovery Mac",
      platform: "macos",
      role: "agent",
      lastSeenAt: now
    }]
  });
  fs.writeFileSync(path.join(legacyDir, "commands.jsonl"), '{"commandId":"command-1"}\n');
  fs.writeFileSync(path.join(legacyDir, "command-receipts.jsonl"), '{"commandId":"command-1","state":"completed"}\n');

  // Stage 1: migrate legacy files, then add records that must survive upgrade.
  const migrated = createPhoneDexStore(legacyDir);
  migrated.appendTask(task("new-task", "preserve this newer task"));
  migrated.upsertDevice({
    deviceId: "recovery-windows",
    machineName: "Recovery Windows",
    platform: "windows",
    role: "agent",
    lastSeenAt: now
  });
  migrated.appendEvent({
    id: "event-1",
    taskId: "new-task",
    type: "completed",
    createdAt: now,
    sequence: 1
  });
  const stagedState = migrated.read();
  assert.equal(stagedState.version, CURRENT_VERSION);
  assert.equal(stagedState.tasks.length, 2);
  assert.equal(stagedState.devices.length, 2);
  assert.equal(stagedState.events.length, 1);
  assert.equal(stagedState.migrations[0].from, "legacy-jsonl");

  // Stage 2: a quiesced directory copy is the recovery unit. It includes the
  // store backup plus compatibility command/receipt logs.
  copyDataDirectory(legacyDir, backupDir);

  // Stage 3: exercise a version upgrade against the copied snapshot.
  const versioned = JSON.parse(fs.readFileSync(path.join(backupDir, STORE_FILE), "utf8"));
  versioned.version = CURRENT_VERSION - 1;
  writeJson(path.join(backupDir, STORE_FILE), versioned);
  const upgraded = createPhoneDexStore(backupDir);
  assert.equal(upgraded.read().version, CURRENT_VERSION);
  assert.equal(upgraded.read().migrations.at(-1).reason, "store-version-upgrade");
  assert.equal(upgraded.listTasks().length, 2);
  upgraded.appendTask(task("post-upgrade-task", "rollback should omit this task"));

  // Stage 4: failed migration rolls back to the last valid store backup and
  // never silently accepts a future schema.
  fs.writeFileSync(path.join(backupDir, STORE_FILE), "{ migration failed\n");
  const rolledBack = createPhoneDexStore(backupDir);
  assert.equal(rolledBack.listTasks().some((item) => item.id === "legacy-task"), true);
  assert.equal(rolledBack.listTasks().some((item) => item.id === "new-task"), true);
  assert.equal(rolledBack.listTasks().some((item) => item.id === "post-upgrade-task"), false);
  assert.throws(() => {
    writeJson(path.join(backupDir, STORE_FILE), {
      schema: "phonedex.store.v1",
      version: CURRENT_VERSION + 1,
      tasks: [],
      devices: []
    });
    createPhoneDexStore(backupDir);
  }, /Unsupported PhoneDex store version/);

  // Stage 5: restore the complete quiesced data directory and verify the
  // compatibility logs are present alongside the durable store projection.
  copyDataDirectory(legacyDir, restoredDir);
  const restored = createPhoneDexStore(restoredDir);
  assert.equal(restored.listTasks().some((item) => item.id === "legacy-task"), true);
  assert.deepEqual(digestDirectory(restoredDir), digestDirectory(legacyDir));
  assert.match(fs.readFileSync(path.join(restoredDir, "commands.jsonl"), "utf8"), /command-1/);
  assert.match(fs.readFileSync(path.join(restoredDir, "command-receipts.jsonl"), "utf8"), /completed/);

  console.log("staged migration, rollback, and disaster-recovery drill passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
