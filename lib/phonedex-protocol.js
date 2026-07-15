"use strict";

const PROTOCOL_VERSION = 1;

const SCHEMAS = Object.freeze({
  task: "phonedex.task.v1",
  event: "phonedex.event.v1",
  device: "phonedex.device.v1",
  workspace: "phonedex.workspace.v1",
  capability: "phonedex.capability.v1",
  command: "phonedex.command.v1",
  commandReceipt: "phonedex.command-receipt.v1"
});

const ENUMS = Object.freeze({
  taskStatus: new Set([
    "queued",
    "running",
    "needs_input",
    "needs_review",
    "awaiting_approval",
    "completed",
    "failed",
    "cancelled",
    "unknown"
  ]),
  eventType: new Set([
    "task_created",
    "task_started",
    "progress",
    "needs_input",
    "approval_requested",
    "task_completed",
    "task_failed",
    "task_cancelled",
    "artifact_available",
    "command_receipt"
  ]),
  devicePlatform: new Set(["macos", "windows", "ios", "unknown"]),
  deviceRole: new Set(["hub", "agent", "phone"]),
  deviceStatus: new Set(["online", "stale", "missing", "revoked", "unknown"]),
  deviceHealth: new Set(["healthy", "degraded", "unhealthy", "unknown"]),
  capabilityScope: new Set(["device", "workspace", "task"]),
  commandKind: new Set(["reply", "create_task", "cancel", "retry", "approve", "reject"]),
  commandState: new Set(["pending", "sent", "acknowledged", "failed", "expired", "rejected"]),
  receiptState: new Set(["accepted", "duplicate", "completed", "failed", "expired", "rejected"])
});

const MAX = Object.freeze({
  id: 160,
  title: 240,
  text: 10000,
  machineName: 160,
  workspaceName: 240,
  version: 64,
  message: 1000,
  branch: 240,
  repository: 400,
  idempotencyKey: 240
});

function protocolRecord(kind, fields = {}) {
  const schema = SCHEMAS[kind];
  if (!schema) throw new Error(`Unknown PhoneDex protocol record kind: ${kind}`);

  const record = {
    ...fields,
    schema,
    protocolVersion: PROTOCOL_VERSION
  };
  assertProtocolRecord(kind, record);
  return record;
}

function validateProtocolRecord(kind, value) {
  const errors = [];
  const schema = SCHEMAS[kind];

  if (!schema) return { valid: false, errors: [`Unknown record kind: ${kind}`] };
  if (!isPlainObject(value)) {
    return { valid: false, errors: ["record must be an object"] };
  }
  if (value.schema !== schema) errors.push(`schema must be ${schema}`);
  if (value.protocolVersion !== PROTOCOL_VERSION) {
    errors.push(`protocolVersion must be ${PROTOCOL_VERSION}`);
  }

  switch (kind) {
    case "task":
      validateTask(value, errors);
      break;
    case "event":
      validateEvent(value, errors);
      break;
    case "device":
      validateDevice(value, errors);
      break;
    case "workspace":
      validateWorkspace(value, errors);
      break;
    case "capability":
      validateCapability(value, errors);
      break;
    case "command":
      validateCommand(value, errors);
      break;
    case "commandReceipt":
      validateCommandReceipt(value, errors);
      break;
  }

  return { valid: errors.length === 0, errors };
}

function assertProtocolRecord(kind, value) {
  const result = validateProtocolRecord(kind, value);
  if (!result.valid) {
    const error = new Error(`Invalid ${SCHEMAS[kind] || kind}: ${result.errors.join("; ")}`);
    error.validationErrors = result.errors;
    throw error;
  }
  return value;
}

function addTaskProtocolFields(task, now = new Date().toISOString()) {
  const createdAt = validTimestamp(task.createdAt || task.at) ? task.createdAt || task.at : now;
  const machineName = boundedString(stringOr(task.machineName, "Unknown device"), MAX.machineName);
  const deviceId = boundedString(stringOr(task.deviceId, machineName), MAX.id);
  const workspaceId = optionalBoundedString(task.workspaceId, MAX.id);
  const record = {
    ...task,
    title: boundedString(stringOr(task.title, "Codex done"), MAX.title),
    text: typeof task.text === "string" ? task.text.slice(0, MAX.text) : "",
    machineName,
    deviceId,
    sessionId: optionalBoundedString(task.sessionId, MAX.id),
    workspaceId,
    branch: optionalBoundedString(task.branch, MAX.branch),
    repository: optionalBoundedString(task.repository, MAX.repository),
    createdAt,
    updatedAt: validTimestamp(task.updatedAt) ? task.updatedAt : createdAt,
    version: positiveInteger(task.version) ? task.version : 1,
    status: ENUMS.taskStatus.has(task.status) ? task.status : "completed",
    origin: {
      deviceId,
      machineName,
      ...(workspaceId ? { workspaceId } : {})
    },
    schema: SCHEMAS.task,
    protocolVersion: PROTOCOL_VERSION
  };
  return assertProtocolRecord("task", record);
}

function addDeviceProtocolFields(device, now = new Date().toISOString()) {
  const lastSeenAt = validTimestamp(device.lastSeenAt || device.at)
    ? device.lastSeenAt || device.at
    : now;
  const deviceId = boundedString(stringOr(device.deviceId || device.id, "unknown-device"), MAX.id);
  const machineName = boundedString(stringOr(device.machineName, deviceId), MAX.machineName);
  const inputHealth = isPlainObject(device.health) ? device.health : {};
  const reachability = ENUMS.deviceStatus.has(inputHealth.reachability)
    ? inputHealth.reachability
    : ENUMS.deviceStatus.has(device.status)
      ? device.status
      : "online";
  const record = {
    ...device,
    deviceId,
    machineName,
    lastSeenAt,
    status: reachability,
    platform: normalizePlatform(device.platform),
    role: ENUMS.deviceRole.has(device.role) ? device.role : "agent",
    capabilities: Array.isArray(device.capabilities)
      ? device.capabilities
        .filter((capability) => typeof capability === "string" && capability.length > 0)
        .map((capability) => capability.slice(0, MAX.id))
      : [],
    agentVersion: optionalBoundedString(device.agentVersion, MAX.version),
    adapterVersion: optionalBoundedString(device.adapterVersion, MAX.version),
    health: {
      reachability,
      agent: normalizeDeviceHealth(inputHealth.agent),
      adapter: normalizeDeviceHealth(inputHealth.adapter)
    },
    schema: SCHEMAS.device,
    protocolVersion: PROTOCOL_VERSION
  };
  return assertProtocolRecord("device", record);
}

function validateTask(value, errors) {
  requiredString(value, "id", MAX.id, errors);
  requiredTimestamp(value, "createdAt", errors);
  requiredString(value, "title", MAX.title, errors);
  enumValue(value, "status", ENUMS.taskStatus, errors);
  requiredObject(value, "origin", errors);
  if (isPlainObject(value.origin)) {
    requiredStringValue(value.origin.deviceId, "origin.deviceId", MAX.id, errors);
    requiredStringValue(value.origin.machineName, "origin.machineName", MAX.machineName, errors);
    optionalStringValue(value.origin.workspaceId, "origin.workspaceId", MAX.id, errors);
  }
  optionalTimestamp(value.updatedAt, "updatedAt", errors);
  optionalInteger(value.version, "version", 1, errors);
  optionalStringValue(value.text, "text", MAX.text, errors);
  optionalStringValue(value.sessionId, "sessionId", MAX.id, errors);
  optionalStringValue(value.workspaceId, "workspaceId", MAX.id, errors);
  optionalStringValue(value.branch, "branch", MAX.branch, errors);
  optionalStringValue(value.repository, "repository", MAX.repository, errors);
}

function validateEvent(value, errors) {
  requiredString(value, "id", MAX.id, errors);
  requiredString(value, "taskId", MAX.id, errors);
  requiredTimestamp(value, "createdAt", errors);
  requiredInteger(value, "sequence", 1, errors);
  enumValue(value, "type", ENUMS.eventType, errors);
  requiredObject(value, "data", errors);
}

function validateDevice(value, errors) {
  requiredString(value, "deviceId", MAX.id, errors);
  requiredString(value, "machineName", MAX.machineName, errors);
  enumValue(value, "platform", ENUMS.devicePlatform, errors);
  enumValue(value, "role", ENUMS.deviceRole, errors);
  enumValue(value, "status", ENUMS.deviceStatus, errors);
  requiredTimestamp(value, "lastSeenAt", errors);
  if (!Array.isArray(value.capabilities)) errors.push("capabilities must be an array");
  else value.capabilities.forEach((capability, index) => {
    if (typeof capability !== "string" || capability.length === 0 || capability.length > MAX.id) {
      errors.push(`capabilities[${index}] must be a non-empty string of at most ${MAX.id} characters`);
    }
  });
  optionalStringValue(value.agentVersion, "agentVersion", MAX.version, errors);
  optionalStringValue(value.adapterVersion, "adapterVersion", MAX.version, errors);
  if (value.health !== undefined) {
    requiredObject(value, "health", errors);
    if (isPlainObject(value.health)) {
      nestedEnumValue(value.health, "reachability", "health.reachability", ENUMS.deviceStatus, errors);
      nestedEnumValue(value.health, "agent", "health.agent", ENUMS.deviceHealth, errors);
      nestedEnumValue(value.health, "adapter", "health.adapter", ENUMS.deviceHealth, errors);
    }
  }
}

function validateWorkspace(value, errors) {
  requiredString(value, "workspaceId", MAX.id, errors);
  requiredString(value, "deviceId", MAX.id, errors);
  requiredString(value, "name", MAX.workspaceName, errors);
  requiredTimestamp(value, "createdAt", errors);
  optionalStringValue(value.repository, "repository", MAX.repository, errors);
  optionalStringValue(value.branch, "branch", MAX.branch, errors);
  optionalStringValue(value.path, "path", 1000, errors);
}

function validateCapability(value, errors) {
  requiredString(value, "id", MAX.id, errors);
  requiredString(value, "version", MAX.version, errors);
  enumValue(value, "scope", ENUMS.capabilityScope, errors);
  if (typeof value.supported !== "boolean") errors.push("supported must be a boolean");
}

function validateCommand(value, errors) {
  requiredString(value, "commandId", MAX.id, errors);
  requiredTimestamp(value, "createdAt", errors);
  enumValue(value, "kind", ENUMS.commandKind, errors);
  requiredObject(value, "target", errors);
  if (isPlainObject(value.target)) {
    optionalStringValue(value.target.taskId, "target.taskId", MAX.id, errors);
    optionalStringValue(value.target.deviceId, "target.deviceId", MAX.id, errors);
    if (!value.target.taskId && !value.target.deviceId) {
      errors.push("target must include taskId or deviceId");
    }
  }
  requiredString(value, "idempotencyKey", MAX.idempotencyKey, errors);
  enumValue(value, "state", ENUMS.commandState, errors);
  requiredObject(value, "payload", errors);
  optionalStringValue(value.requestedBy, "requestedBy", MAX.id, errors);
}

function validateCommandReceipt(value, errors) {
  requiredString(value, "commandId", MAX.id, errors);
  requiredTimestamp(value, "createdAt", errors);
  enumValue(value, "state", ENUMS.receiptState, errors);
  optionalStringValue(value.taskId, "taskId", MAX.id, errors);
  optionalStringValue(value.eventId, "eventId", MAX.id, errors);
  optionalStringValue(value.message, "message", MAX.message, errors);
  optionalInteger(value.taskVersion, "taskVersion", 1, errors);
}

function requiredString(value, field, maxLength, errors) {
  requiredStringValue(value[field], field, maxLength, errors);
}

function requiredStringValue(fieldValue, field, maxLength, errors) {
  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
  } else if (fieldValue.length > maxLength) {
    errors.push(`${field} must be at most ${maxLength} characters`);
  }
}

function optionalStringValue(fieldValue, field, maxLength, errors) {
  if (fieldValue === undefined || fieldValue === null) return;
  if (typeof fieldValue !== "string") errors.push(`${field} must be a string`);
  else if (fieldValue.length > maxLength) errors.push(`${field} must be at most ${maxLength} characters`);
}

function requiredTimestamp(value, field, errors) {
  if (!validTimestamp(value[field])) errors.push(`${field} must be an ISO-8601 timestamp`);
}

function optionalTimestamp(value, field, errors) {
  if (value[field] !== undefined && !validTimestamp(value[field])) {
    errors.push(`${field} must be an ISO-8601 timestamp`);
  }
}

function requiredInteger(value, field, minimum, errors) {
  if (!Number.isInteger(value[field]) || value[field] < minimum) {
    errors.push(`${field} must be an integer greater than or equal to ${minimum}`);
  }
}

function optionalInteger(value, field, minimum, errors) {
  if (value[field] !== undefined) requiredInteger(value, field, minimum, errors);
}

function requiredObject(value, field, errors) {
  if (!isPlainObject(value[field])) errors.push(`${field} must be an object`);
}

function enumValue(value, field, allowed, errors) {
  if (!allowed.has(value[field])) errors.push(`${field} must be one of: ${[...allowed].join(", ")}`);
}

function nestedEnumValue(value, field, label, allowed, errors) {
  if (!allowed.has(value[field])) errors.push(`${label} must be one of: ${[...allowed].join(", ")}`);
}

function validTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function boundedString(value, maxLength) {
  return value.slice(0, maxLength);
}

function optionalBoundedString(value, maxLength) {
  return typeof value === "string" ? boundedString(value, maxLength) : undefined;
}

function normalizePlatform(value) {
  if (value === "darwin") return "macos";
  if (value === "win32") return "windows";
  return ENUMS.devicePlatform.has(value) ? value : "unknown";
}

function normalizeDeviceHealth(value) {
  return ENUMS.deviceHealth.has(value) ? value : "unknown";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  ENUMS,
  PROTOCOL_VERSION,
  SCHEMAS,
  addDeviceProtocolFields,
  addTaskProtocolFields,
  assertProtocolRecord,
  protocolRecord,
  validateProtocolRecord
};
