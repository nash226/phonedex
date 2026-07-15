"use strict";

const DEFAULT_TASK_LIMIT = 25;
const MAX_TASK_LIMIT = 500;

/**
 * Normalize fields accepted by the original JSONL /tasks clients into the
 * stable internal names used by the versioned hub. Older Mac and Windows
 * agents may still send snake_case or nested task data.
 */
function normalizeLegacyTaskInput(fields, request = {}) {
  const input = isPlainObject(fields?.task) ? fields.task : isPlainObject(fields) ? fields : {};
  const machineName = firstString(input, ["machineName", "machine", "host"]) || "Unknown device";

  return {
    originTaskId: firstString(input, ["id", "taskId", "task_id"]),
    at: firstString(input, ["at"]) || new Date().toISOString(),
    source: firstString(input, ["source"]),
    title: firstString(input, ["title"]) || "Codex done",
    text: firstString(input, ["text", "body", "message"]) || "Task completed",
    cwd: firstString(input, ["cwd"]) || "",
    machineName,
    deviceId:
      firstString(input, ["deviceId", "machineId", "host"]) ||
      firstString(request, ["deviceId"]) ||
      machineName,
    sessionId: firstString(input, ["sessionId", "session_id"]),
    messageId: firstString(input, ["messageId", "message_id"]),
    logicalEventId: firstString(input, ["logicalEventId", "logical_event_id"]),
    captureSources: input.captureSources,
    replyUrl: firstString(input, ["replyUrl", "reply_url"]),
    publicUrl: firstString(input, ["publicUrl", "public_url"]),
    replyToken: firstString(input, ["replyToken", "reply_token"]),
    hookPayload: input.hookPayload,
    rawHookInputBytes: input.rawHookInputBytes
  };
}

/**
 * Normalize the reply fields used by notification actions and installed
 * agents. The route owns task lookup, version checks, and idempotency policy;
 * this adapter only keeps the old field aliases stable.
 */
function normalizeLegacyReplyInput(fields) {
  const input = isPlainObject(fields) ? fields : {};
  return {
    requestedTaskId: firstString(input, ["taskId", "task_id"]),
    requestedSessionId: firstString(input, ["sessionId", "session_id"]),
    expectedTaskVersion: firstValue(input, ["expectedTaskVersion", "expected_task_version"]),
    idempotencyKey: firstString(input, ["idempotencyKey", "idempotency_key"]),
    commandId: firstString(input, ["commandId", "command_id"]),
    actor: firstString(input, ["actor", "requestedBy"]) || "iphone",
    choice: firstString(input, ["choice"]) || "okay_whats_next",
    prompt: firstString(input, ["prompt", "reply_text", "replyText"]),
    action: firstString(input, ["action"]),
    replyText: firstString(input, ["reply_text", "replyText"]),
    machineName: firstString(input, ["machineName", "machine"])
  };
}

function buildLegacyReplyForwardBody(task, reply) {
  return {
    token: task.originToken || task.replyToken || "",
    commandId: reply.commandId,
    idempotencyKey: reply.idempotencyKey,
    expectedTaskVersion: reply.expectedTaskVersion,
    actor: "phonedex-hub",
    taskId: task.originTaskId || task.id,
    choice: reply.choice,
    prompt: reply.prompt,
    reply_text: reply.replyText || "",
    machineName: task.machineName || ""
  };
}

function parseLegacyTaskListLimit(value) {
  if (value === null || value === "") return DEFAULT_TASK_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TASK_LIMIT;
  return Math.min(parsed, MAX_TASK_LIMIT);
}

function legacyTaskList(tasks, value, toPublicTask = (task) => task) {
  const entries = Array.isArray(tasks) ? tasks : [];
  if (value === "all") return entries.map(toPublicTask);
  return entries.slice(-parseLegacyTaskListLimit(value)).map(toPublicTask);
}

function firstString(value, keys) {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  return "";
}

function firstValue(value, keys) {
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
  }
  return undefined;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  buildLegacyReplyForwardBody,
  legacyTaskList,
  normalizeLegacyReplyInput,
  normalizeLegacyTaskInput,
  parseLegacyTaskListLimit
};
