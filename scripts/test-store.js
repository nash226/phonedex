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

const now = "2026-07-15T12:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-store-"));

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

try {
  const dataDir = path.join(root, "legacy");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "tasks.jsonl"),
    `${JSON.stringify({
      id: "task_legacy",
      at: now,
      title: "Migrated task",
      text: "The legacy record survived migration.",
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
  const migrated = store.read();
  assert.equal(migrated.schema, "phonedex.store.v1");
  assert.equal(migrated.version, CURRENT_VERSION);
  assert.equal(migrated.tasks[0].schema, "phonedex.task.v1");
  assert.equal(migrated.devices[0].schema, "phonedex.device.v1");
  assert.equal(migrated.migrations[0].from, "legacy-jsonl");
  assert.equal(fs.existsSync(path.join(dataDir, STORE_FILE)), true);

  assert.equal(store.appendTask(task("task_first", "first")).created, true);
  assert.equal(store.appendTask(task("task_second", "second")).created, true);

  const backup = JSON.parse(
    fs.readFileSync(path.join(dataDir, `${STORE_FILE}.bak`), "utf8")
  );
  assert.equal(backup.tasks.some((candidate) => candidate.id === "task_first"), true);
  assert.equal(backup.tasks.some((candidate) => candidate.id === "task_second"), false);

  fs.writeFileSync(path.join(dataDir, STORE_FILE), "not-json\n");
  const recovered = createPhoneDexStore(dataDir);
  assert.equal(recovered.listTasks().some((candidate) => candidate.id === "task_first"), true);
  assert.equal(recovered.listTasks().some((candidate) => candidate.id === "task_second"), false);
  assert.equal(
    fs.readdirSync(dataDir).some((name) => name.startsWith(`${STORE_FILE}.corrupt-`)),
    true
  );

  const merged = recovered.appendTask(
    task("task_first", "first"),
    (candidate) => candidate.id === "task_first",
    (existing) => ({
      ...existing,
      captureSources: [{ source: "codex-stop-hook" }]
    })
  );
  assert.equal(merged.created, false);
  assert.equal(merged.merged, true);
  assert.deepEqual(recovered.listTasks().find((candidate) => candidate.id === "task_first").captureSources, [
    { source: "codex-stop-hook" }
  ]);

  const unchangedRevision = recovered.read().revision;
  const unchanged = recovered.appendTask(
    task("task_first", "first"),
    (candidate) => candidate.id === "task_first",
    (existing) => existing
  );
  assert.equal(unchanged.created, false);
  assert.equal(unchanged.merged, false);
  assert.equal(recovered.read().revision, unchangedRevision);

  const versionedDir = path.join(root, "versioned");
  fs.mkdirSync(versionedDir, { recursive: true });
  fs.writeFileSync(
    path.join(versionedDir, STORE_FILE),
    JSON.stringify({
      schema: "phonedex.store.v1",
      version: 0,
      revision: 2,
      updatedAt: now,
      tasks: [],
      devices: [],
      migrations: []
    })
  );
  const versioned = createPhoneDexStore(versionedDir);
  assert.equal(versioned.read().version, CURRENT_VERSION);
  assert.equal(versioned.read().migrations.at(-1).reason, "store-version-upgrade");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(versionedDir, STORE_FILE))).version,
    CURRENT_VERSION
  );

  const futureDir = path.join(root, "future");
  fs.mkdirSync(futureDir, { recursive: true });
  fs.writeFileSync(
    path.join(futureDir, STORE_FILE),
    JSON.stringify({
      schema: "phonedex.store.v1",
      version: CURRENT_VERSION + 1,
      tasks: [],
      devices: []
    })
  );
  assert.throws(
    () => createPhoneDexStore(futureDir),
    /Unsupported PhoneDex store version/
  );

  console.log("transactional store fixture test passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
