#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  CAPABILITY_IDS,
  SCHEMAS,
  SUPPORTED_PROTOCOL_VERSIONS,
  addDeviceProtocolFields,
  addTaskProtocolFields,
  assertProtocolRecord,
  defaultCapabilities,
  negotiateCapabilities,
  negotiateProtocolVersion,
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
  status: "needs_input",
  sessionId: "session_fixture",
  question: {
    id: "next-step",
    prompt: "What should happen next?",
    choices: [{ id: "tests", label: "Run the focused tests" }],
    allowsFreeText: true
  }
});
assert.equal(validateProtocolRecord("task", task).valid, true);
assert.equal(task.schema, SCHEMAS.task);
assert.equal(task.origin.deviceId, "macbook-air");
assert.equal(task.question.choices[0].id, "tests");

const approvalTask = addTaskProtocolFields({
  id: "task_approval",
  at: now,
  title: "Review a file operation",
  text: "The task is ready for a consequential workspace change.",
  machineName: "Build Mac",
  deviceId: "mac_1",
  version: 4,
  status: "awaiting_approval",
  approvalRequest: {
    id: "approval_1",
    taskVersion: 4,
    operation: "Write generated files",
    scope: "PhoneDex workspace",
    origin: {
      deviceId: "mac_1",
      machineName: "Build Mac",
      workspaceName: "PhoneDex",
      path: "/Users/example/PhoneDex"
    },
    reason: "The task is ready to update the generated project.",
    risk: "Changes files in the selected workspace.",
    requestedAt: now,
    expiresAt: "2026-07-15T12:15:00.000Z",
    state: "pending"
  }
});
assert.equal(validateProtocolRecord("task", approvalTask).valid, true);
assert.equal(approvalTask.approvalRequest.origin.deviceId, "mac_1");
assert.equal(approvalTask.approvalRequest.origin.path, undefined);
assert.throws(
  () => addTaskProtocolFields({
    ...approvalTask,
    id: "task_invalid_approval",
    approvalRequest: { ...approvalTask.approvalRequest, taskVersion: 3 }
  }),
  /approvalRequest\.taskVersion/
);
assert.throws(
  () => addTaskProtocolFields({
    ...approvalTask,
    id: "task_expired_approval",
    approvalRequest: {
      ...approvalTask.approvalRequest,
      requestedAt: now,
      expiresAt: now
    }
  }),
  /expiresAt must be after requestedAt/
);

assert.throws(
  () => addTaskProtocolFields({
    id: "task_invalid_question",
    at: now,
    title: "Invalid question",
    question: {
      id: "invalid",
      prompt: "Choose",
      choices: [{ id: "same", label: "One" }, { id: "same", label: "Two" }],
      allowsFreeText: false
    }
  }),
  /Invalid task question/
);

const capturedTask = addTaskProtocolFields({
  id: "task_capture",
  at: now,
  source: "codex-stop-hook",
  title: "Captured completion",
  text: "One logical event",
  machineName: "MacBook Air",
  deviceId: "macbook-air",
  sessionId: "session_capture",
  messageId: "turn_capture",
  captureSources: [
    { source: "codex-stop-hook", messageId: "turn_capture", observedAt: now },
    { source: "codex-session-watch", messageId: "turn_capture", observedAt: now },
    { source: "codex-stop-hook", messageId: "turn_capture", observedAt: now }
  ]
});
assert.match(capturedTask.logicalEventId, /^completion_[0-9a-f]{32}$/);
assert.deepEqual(
  capturedTask.captureSources.map((capture) => capture.source),
  ["codex-stop-hook", "codex-session-watch"]
);

const device = addDeviceProtocolFields({
  deviceId: "macbook-air",
  machineName: "MacBook Air",
  platform: "macos",
  role: "agent",
  lastSeenAt: now,
  capabilities: ["task.reply.v1", "task.cancel.v1"]
});
assert.equal(validateProtocolRecord("device", device).valid, true);
assert.deepEqual(device.health, {
  reachability: "online",
  agent: "unknown",
  adapter: "unknown"
});

assert.deepEqual(
  device.capabilityDetails.map((capability) => `${capability.id}.v${capability.version}`),
  ["task.reply.v1", "task.cancel.v1"]
);

const separatedHealthDevice = addDeviceProtocolFields({
  deviceId: "windows-desktop",
  machineName: "Windows Desktop",
  platform: "windows",
  role: "agent",
  status: "stale",
  health: { agent: "degraded", adapter: "healthy" },
  lastSeenAt: now
});
assert.equal(validateProtocolRecord("device", separatedHealthDevice).valid, true);
assert.deepEqual(separatedHealthDevice.health, {
  reachability: "stale",
  agent: "degraded",
  adapter: "healthy"
});

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

const negotiated = addDeviceProtocolFields({
  deviceId: "negotiated-device",
  machineName: "Negotiated Device",
  platform: "windows",
  capabilityDetails: [
    { id: CAPABILITY_IDS.taskReply, version: "1", scope: "task", supported: true },
    { id: CAPABILITY_IDS.taskReply, version: "1", scope: "task", supported: true },
    { id: "future.control", version: "2", scope: "task", supported: false }
  ],
  lastSeenAt: now
});
assert.equal(validateProtocolRecord("device", negotiated).valid, true);
assert.deepEqual(negotiated.capabilityDetails, [
  { schema: SCHEMAS.capability, protocolVersion: 1, id: "task.reply", version: "1", scope: "task", supported: true },
  { schema: SCHEMAS.capability, protocolVersion: 1, id: "future.control", version: "2", scope: "task", supported: false }
]);
assert.equal(defaultCapabilities("hub").some((capability) => capability.id === "sync.snapshot"), true);
assert.equal(negotiateProtocolVersion(1), 1);
assert.deepEqual(SUPPORTED_PROTOCOL_VERSIONS, [1]);
assert.deepEqual(
  negotiateCapabilities("sync.snapshot.v1,device.health.v1").map((capability) => capability.id),
  ["sync.snapshot", "device.health"]
);
assert.throws(
  () => negotiateProtocolVersion(99),
  (error) => error.code === "protocol_incompatible" && error.statusCode === 426
);
assert.throws(
  () => negotiateCapabilities("task.cancel.v1"),
  (error) => error.code === "capability_unsupported" && error.statusCode === 426
);

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

const approvalCommand = protocolRecord("command", {
  commandId: "approval_command_fixture",
  createdAt: now,
  kind: "approve",
  target: { taskId: approvalTask.id, deviceId: "mac_1" },
  idempotencyKey: "phone-approval-1",
  state: "pending",
  payload: { approvalId: "approval_1", taskVersion: 4 },
  expectedTaskVersion: 4,
  requestedCapability: "approval.respond.v1",
  requestedBy: "phone_fixture"
});
const approvalReceipt = protocolRecord("commandReceipt", {
  commandId: "approval_command_fixture",
  createdAt: now,
  state: "accepted",
  taskId: approvalTask.id,
  taskVersion: 4,
  approvalId: "approval_1",
  approvalState: "approved",
  approvalExpiresAt: "2026-07-15T12:15:00.000Z"
});
assert.equal(validateProtocolRecord("command", approvalCommand).valid, true);
assert.equal(validateProtocolRecord("commandReceipt", approvalReceipt).valid, true);

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
