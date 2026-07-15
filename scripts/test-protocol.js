#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  SCHEMAS,
  addDeviceProtocolFields,
  addTaskProtocolFields,
  assertProtocolRecord,
  protocolRecord,
  validateProtocolRecord
} = require("../lib/phonedex-protocol");

const now = "2026-07-15T12:00:00.000Z";

const task = addTaskProtocolFields({
  id: "task_fixture",
  at: now,
  title: "Run the native smoke test",
  text: "The simulator test passed.",
  machineName: "MacBook Air",
  deviceId: "macbook-air",
  status: "completed",
  sessionId: "session_fixture"
});
assert.equal(validateProtocolRecord("task", task).valid, true);
assert.equal(task.schema, SCHEMAS.task);
assert.equal(task.origin.deviceId, "macbook-air");

const device = addDeviceProtocolFields({
  deviceId: "macbook-air",
  machineName: "MacBook Air",
  platform: "macos",
  role: "agent",
  lastSeenAt: now,
  capabilities: ["task.reply.v1", "task.cancel.v1"]
});
assert.equal(validateProtocolRecord("device", device).valid, true);

const legacySafe = addTaskProtocolFields({
  id: "task_legacy",
  at: now,
  title: "x".repeat(400),
  text: "y".repeat(12000),
  machineName: "MacBook Air",
  deviceId: "macbook-air"
});
assert.equal(legacySafe.title.length, 240);
assert.equal(legacySafe.text.length, 10000);
const localDevice = addDeviceProtocolFields({
  deviceId: "local-mac",
  machineName: "Local Mac",
  platform: "darwin",
  role: "hub",
  lastSeenAt: now,
  capabilities: ["", "task.reply.v1", 42]
});
assert.equal(localDevice.platform, "macos");
assert.deepEqual(localDevice.capabilities, ["task.reply.v1"]);

const fixtures = {
  event: protocolRecord("event", {
    id: "event_fixture",
    taskId: task.id,
    createdAt: now,
    sequence: 1,
    type: "task_completed",
    data: { summary: "Tests passed" }
  }),
  workspace: protocolRecord("workspace", {
    workspaceId: "workspace_fixture",
    deviceId: device.deviceId,
    name: "PhoneDex",
    createdAt: now,
    repository: "nash226/phonedex",
    branch: "main"
  }),
  capability: protocolRecord("capability", {
    id: "task.reply",
    version: "1",
    scope: "task",
    supported: true
  }),
  command: protocolRecord("command", {
    commandId: "command_fixture",
    createdAt: now,
    kind: "reply",
    target: { taskId: task.id, deviceId: device.deviceId },
    idempotencyKey: "phone-123-command-1",
    state: "pending",
    payload: { text: "Please summarize the result." },
    requestedBy: "phone_fixture"
  }),
  commandReceipt: protocolRecord("commandReceipt", {
    commandId: "command_fixture",
    createdAt: now,
    state: "accepted",
    taskId: task.id,
    taskVersion: 1
  })
};

for (const [kind, fixture] of Object.entries(fixtures)) {
  assert.equal(validateProtocolRecord(kind, fixture).valid, true, `${kind} fixture should validate`);
}

const invalidCommand = {
  ...fixtures.command,
  protocolVersion: 2,
  state: "done",
  target: {}
};
const invalidResult = validateProtocolRecord("command", invalidCommand);
assert.equal(invalidResult.valid, false);
assert.match(invalidResult.errors.join(" "), /protocolVersion/);
assert.match(invalidResult.errors.join(" "), /state/);
assert.match(invalidResult.errors.join(" "), /target/);
assert.throws(
  () => assertProtocolRecord("command", invalidCommand),
  /Invalid phonedex\.command\.v1/
);

const unknownSchema = { ...task, schema: "phonedex.task.v2" };
assert.equal(validateProtocolRecord("task", unknownSchema).valid, false);

console.log("versioned protocol schema fixture test passed");
