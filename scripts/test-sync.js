#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { addTaskProtocolFields, protocolRecord } = require("../lib/phonedex-protocol");
const { createPhoneDexStore } = require("../lib/phonedex-store");

const now = "2026-07-15T12:00:00.000Z";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-sync-"));

function task(id) {
  return addTaskProtocolFields({
    id,
    at: now,
    createdAt: now,
    updatedAt: now,
    title: id,
    text: `${id} text`,
    machineName: "Studio Mac",
    deviceId: "studio-mac",
    status: "completed"
  });
}

try {
  const store = createPhoneDexStore(root);
  store.appendTask(task("task_1"));
  store.appendTask(task("task_2"));
  store.appendTask(task("task_3"));
  store.upsertDevice({
    deviceId: "studio-mac",
    machineName: "Studio Mac",
    platform: "macos",
    role: "agent",
    lastSeenAt: now
  });

  const first = store.readSync({ limit: 2 });
  assert.equal(first.snapshot.tasks.length, 2);
  assert.equal(first.snapshot.devices.length, 0);
  assert.equal(first.snapshot.complete, false);
  assert.equal(first.changes.length, 0);

  const second = store.readSync({ cursor: first.cursor, limit: 2 });
  assert.equal(second.snapshot.tasks.length, 1);
  assert.equal(second.snapshot.devices.length, 1);
  assert.equal(second.snapshot.complete, true);
  assert.equal(second.hasMore, false);

  store.appendTask(task("task_4"));
  const stream = store.readSync({ cursor: second.cursor, limit: 10 });
  assert.equal(stream.snapshot, null);
  assert.equal(stream.changes.length, 1);
  assert.equal(stream.changes[0].id, "task_4");
  assert.equal(stream.changes[0].deleted, false);

  store.removeTask("task_4");
  const tombstone = store.readSync({ cursor: stream.cursor, limit: 10 });
  assert.deepEqual(tombstone.changes.map(({ id, kind, deleted }) => ({ id, kind, deleted })), [
    { id: "task_4", kind: "task", deleted: true }
  ]);

  store.appendEvent(protocolRecord("event", {
    id: "event_1",
    taskId: "task_1",
    createdAt: now,
    sequence: 1,
    type: "progress",
    data: { summary: "Running focused checks" }
  }));
  const eventStream = store.readSync({ cursor: tombstone.cursor, limit: 10 });
  assert.deepEqual(eventStream.changes.map(({ id, kind }) => ({ id, kind })), [
    { id: "event_1", kind: "event" }
  ]);

  assert.throws(
    () => store.readSync({ cursor: "not-a-cursor" }),
    (error) => error.code === "sync_cursor_invalid"
  );

  const changingRoot = path.join(root, "changing");
  const changingStore = createPhoneDexStore(changingRoot);
  changingStore.appendTask(task("task_a"));
  changingStore.appendTask(task("task_b"));
  const changingFirst = changingStore.readSync({ limit: 1 });
  changingStore.appendTask(task("task_c"));
  assert.throws(
    () => changingStore.readSync({ cursor: changingFirst.cursor, limit: 1 }),
    (error) => error.code === "sync_snapshot_changed"
  );

  console.log("snapshot cursor sync fixture test passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
