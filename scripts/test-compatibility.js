#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  buildLegacyReplyForwardBody,
  legacyTaskList,
  normalizeLegacyReplyInput,
  normalizeLegacyTaskInput,
  parseLegacyTaskListLimit
} = require("../lib/phonedex-compat");

const task = normalizeLegacyTaskInput(
  {
    task: {
      task_id: "windows-task-7",
      body: "The Windows agent finished.",
      machine: "Windows Workstation",
      machineId: "windows-agent",
      session_id: "thread-7",
      message_id: "message-7",
      reply_url: "http://windows.local/reply",
      reply_token: "origin-secret"
    }
  },
  { deviceId: "header-device" }
);
assert.deepEqual(
  {
    originTaskId: task.originTaskId,
    text: task.text,
    machineName: task.machineName,
    deviceId: task.deviceId,
    sessionId: task.sessionId,
    messageId: task.messageId,
    replyUrl: task.replyUrl,
    replyToken: task.replyToken
  },
  {
    originTaskId: "windows-task-7",
    text: "The Windows agent finished.",
    machineName: "Windows Workstation",
    deviceId: "windows-agent",
    sessionId: "thread-7",
    messageId: "message-7",
    replyUrl: "http://windows.local/reply",
    replyToken: "origin-secret"
  }
);

const reply = normalizeLegacyReplyInput({
  task_id: "windows-task-7",
  session_id: "thread-7",
  expected_task_version: "3",
  idempotency_key: "legacy-reply-7",
  command_id: "legacy-command-7",
  requestedBy: "notification",
  reply_text: "Please continue with the safe option.",
  machine: "Windows Workstation"
});
assert.deepEqual(reply, {
  requestedTaskId: "windows-task-7",
  requestedSessionId: "thread-7",
  expectedTaskVersion: "3",
  idempotencyKey: "legacy-reply-7",
  commandId: "legacy-command-7",
  actor: "notification",
  choice: "okay_whats_next",
  prompt: "Please continue with the safe option.",
  action: "",
  replyText: "Please continue with the safe option.",
  machineName: "Windows Workstation"
});

assert.deepEqual(buildLegacyReplyForwardBody(
  { id: "hub-task", originTaskId: "windows-task-7", originToken: "origin-secret", machineName: "Windows Workstation" },
  {
    commandId: "legacy-command-7",
    idempotencyKey: "legacy-reply-7",
    expectedTaskVersion: 3,
    choice: "okay_whats_next",
    prompt: "Please continue with the safe option.",
    replyText: "Please continue with the safe option."
  }
), {
  token: "origin-secret",
  commandId: "legacy-command-7",
  idempotencyKey: "legacy-reply-7",
  expectedTaskVersion: 3,
  actor: "phonedex-hub",
  taskId: "windows-task-7",
  choice: "okay_whats_next",
  prompt: "Please continue with the safe option.",
  reply_text: "Please continue with the safe option.",
  machineName: "Windows Workstation"
});

const tasks = Array.from({ length: 30 }, (_, index) => ({ id: `task-${index + 1}`, token: "secret" }));
assert.equal(parseLegacyTaskListLimit("invalid"), 25);
assert.equal(parseLegacyTaskListLimit("999"), 500);
assert.deepEqual(legacyTaskList(tasks, "2", (entry) => ({ id: entry.id })), [
  { id: "task-29" },
  { id: "task-30" }
]);
const publicTasks = legacyTaskList(tasks, "all", (entry) => ({ id: entry.id }));
assert.equal(publicTasks.length, 30);
assert.equal(publicTasks.every((entry) => !Object.hasOwn(entry, "token")), true);
console.log("legacy compatibility adapter fixture passed");
