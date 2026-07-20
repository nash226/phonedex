"use strict";

const crypto = require("node:crypto");
const { normalizeTaskEvidence } = require("./phonedex-evidence");

const PROTOCOL_VERSION = 1;
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_VERSION]);

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
    "canceling",
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
  commandKind: new Set(["reply", "create_task", "cancel", "retry", "handoff", "approve", "reject"]),
  commandState: new Set(["pending", "sent", "acknowledged", "failed", "expired", "rejected"]),
  receiptState: new Set(["accepted", "duplicate", "completed", "failed", "expired", "rejected"]),
  approvalState: new Set(["pending", "approved", "rejected", "expired", "stale"])
});

const CAPABILITY_IDS = Object.freeze({
  syncSnapshot: "sync.snapshot",
  deviceHealth: "device.health",
  taskCapture: "task.capture",
  taskReply: "task.reply",
  desktopHandoff: "desktop.handoff"
});

const MAX = Object.freeze({
  id: 160,
  title: 240,
  text: 10000,
  machineName: 160,
  workspaceName: 240,
  version: 64,
  message: 1000,
  questionId: 160,
  questionPrompt: 2000,
  questionChoiceId: 160,
  questionChoiceLabel: 240,
  approvalId: 160,
  approvalText: 1000,
  branch: 240,
  repository: 400,
  idempotencyKey: 240,
  captureSource: 80
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
  const messageId = optionalBoundedString(task.messageId, MAX.id);
  const derivedLogicalEventId = buildLogicalTaskEventId({
    deviceId,
    sessionId: task.sessionId,
    messageId
  });
  const logicalEventId = derivedLogicalEventId || optionalBoundedString(task.logicalEventId, MAX.id);
  const captureSources = normalizeCaptureSources(task.captureSources, {
    source: task.source,
    messageId,
    observedAt: task.at || createdAt
  });
  const question = normalizeTaskQuestion(task.question);
  const evidence = normalizeTaskEvidence(task.evidence);
  const approvalRequest = normalizeApprovalRequest(task.approvalRequest);
  const record = {
    ...task,
    title: boundedString(stringOr(task.title, "Codex done"), MAX.title),
    text: typeof task.text === "string" ? task.text.slice(0, MAX.text) : "",
    machineName,
    deviceId,
    sessionId: optionalBoundedString(task.sessionId, MAX.id),
    ...(messageId ? { messageId } : {}),
    ...(logicalEventId ? { logicalEventId } : {}),
    ...(captureSources.length > 0 ? { captureSources } : {}),
    ...(question ? { question } : {}),
    ...(evidence ? { evidence } : {}),
    ...(approvalRequest ? { approvalRequest } : {}),
    workspaceId,
    branch: optionalBoundedString(task.branch, MAX.branch),
    repository: optionalBoundedString(task.repository, MAX.repository),
    createdAt,
    updatedAt: validTimestamp(task.updatedAt) ? task.updatedAt : createdAt,
    version: positiveInteger(task.version) ? task.version : 1,
    status: ENUMS.taskStatus.has(task.status)
      ? task.status
      : approvalRequest
        ? "awaiting_approval"
        : "completed",
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

function buildLogicalTaskEventId({ deviceId, sessionId, messageId } = {}) {
  const identity = [deviceId, sessionId, messageId]
    .map((value) => String(value || "").trim())
    .join("\u0000");
  if (!identity.split("\u0000").every(Boolean)) return "";
  return `completion_${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

function normalizeCaptureSources(value, fallback) {
  const candidates = Array.isArray(value) ? [...value] : [];
  if (fallback && typeof fallback === "object") candidates.push(fallback);

  const seen = new Set();
  return candidates
    .filter((capture) => capture && typeof capture === "object" && !Array.isArray(capture))
    .map((capture) => {
      const source = boundedString(stringOr(capture.source, "unknown"), MAX.captureSource);
      const messageId = optionalBoundedString(capture.messageId, MAX.id);
      const observedAt = validTimestamp(capture.observedAt) ? capture.observedAt : "";
      return {
        source,
        ...(messageId ? { messageId } : {}),
        ...(observedAt ? { observedAt } : {})
      };
    })
    .filter((capture) => {
      const key = `${capture.source}\u0000${capture.messageId || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
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
  const legacyCapabilities = Array.isArray(device.capabilities)
    ? device.capabilities
      .filter((capability) => typeof capability === "string" && capability.length > 0)
      .map((capability) => capability.slice(0, MAX.id))
    : [];
  const capabilityDetails = normalizeCapabilityRecords(
    device.capabilityDetails || legacyCapabilities
  );
  const record = {
    ...device,
    deviceId,
    machineName,
    lastSeenAt,
    status: reachability,
    platform: normalizePlatform(device.platform),
    role: ENUMS.deviceRole.has(device.role) ? device.role : "agent",
    capabilities: legacyCapabilities,
    ...(capabilityDetails.length > 0 ? { capabilityDetails } : {}),
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
  if (value.question !== undefined) {
    validateTaskQuestion(value.question, errors);
    if (value.status !== "needs_input") {
      errors.push("question is only valid when task.status is needs_input");
    }
  }
  if (value.evidence !== undefined) validateTaskEvidence(value.evidence, errors);
  if (value.approvalRequest !== undefined) {
    validateApprovalRequest(value.approvalRequest, errors);
    const approvalState = value.approvalRequest?.state;
    const approvalStateMatchesTask =
      (approvalState === "pending" && value.status === "awaiting_approval") ||
      (approvalState === "approved" && ["running", "completed"].includes(value.status)) ||
      (approvalState === "rejected" && ["failed", "cancelled", "completed"].includes(value.status)) ||
      (approvalState === "expired" && ["failed", "completed"].includes(value.status)) ||
      (approvalState === "stale" && !["awaiting_approval"].includes(value.status));
    if (!approvalStateMatchesTask) {
      errors.push("approvalRequest state does not match task.status");
    }
    if (!positiveInteger(value.version)) {
      errors.push("approvalRequest requires task.version");
    } else if (isPlainObject(value.approvalRequest) &&
               value.approvalRequest.taskVersion !== value.version) {
      errors.push("approvalRequest.taskVersion must match task.version");
    }
  }
}

function validateTaskEvidence(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("evidence must be an object");
    return;
  }
  for (const field of ["changedFiles", "artifacts", "validations"]) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      errors.push(`evidence.${field} must be an array`);
    }
  }
}

function validateTaskQuestion(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("question must be an object");
    return;
  }
  requiredStringValue(value.id, "question.id", MAX.questionId, errors);
  requiredStringValue(value.prompt, "question.prompt", MAX.questionPrompt, errors);
  if (!Array.isArray(value.choices)) {
    errors.push("question.choices must be an array");
  } else {
    if (value.choices.length > 8) errors.push("question.choices must contain at most 8 choices");
    const ids = new Set();
    value.choices.forEach((choice, index) => {
      if (!isPlainObject(choice)) {
        errors.push(`question.choices[${index}] must be an object`);
        return;
      }
      requiredStringValue(choice.id, `question.choices[${index}].id`, MAX.questionChoiceId, errors);
      requiredStringValue(choice.label, `question.choices[${index}].label`, MAX.questionChoiceLabel, errors);
      if (typeof choice.id === "string") {
        if (ids.has(choice.id)) errors.push(`question.choices[${index}].id must be unique`);
        ids.add(choice.id);
      }
    });
  }
  if (typeof value.allowsFreeText !== "boolean") {
    errors.push("question.allowsFreeText must be a boolean");
  }
  if (Array.isArray(value.choices) && value.choices.length === 0 && value.allowsFreeText !== true) {
    errors.push("question must provide a choice or allow free text");
  }
}

function normalizeTaskQuestion(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw new Error("Task question must be an object");

  const question = {
    id: optionalBoundedString(value.id, MAX.questionId),
    prompt: optionalBoundedString(value.prompt, MAX.questionPrompt),
    choices: Array.isArray(value.choices)
      ? value.choices.slice(0, 8).map((choice) => ({
        id: optionalBoundedString(choice?.id, MAX.questionChoiceId),
        label: optionalBoundedString(choice?.label, MAX.questionChoiceLabel)
      }))
      : [],
    allowsFreeText: value.allowsFreeText === true
  };
  return assertTaskQuestion(question);
}

function assertTaskQuestion(question) {
  const errors = [];
  validateTaskQuestion(question, errors);
  if (errors.length > 0) {
    const error = new Error(`Invalid task question: ${errors.join("; ")}`);
    error.validationErrors = errors;
    throw error;
  }
  return question;
}

function normalizeApprovalRequest(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw new Error("Approval request must be an object");

  return assertApprovalRequest({
    id: optionalBoundedString(value.id || value.approvalId, MAX.approvalId),
    taskVersion: positiveInteger(value.taskVersion) ? value.taskVersion : 1,
    operation: optionalBoundedString(value.operation, MAX.approvalText),
    scope: optionalBoundedString(value.scope, MAX.approvalText),
    origin: normalizeApprovalOrigin(value.origin),
    reason: optionalBoundedString(value.reason, MAX.approvalText),
    risk: optionalBoundedString(value.risk, MAX.approvalText),
    requestedAt: value.requestedAt,
    expiresAt: value.expiresAt,
    state: value.state || "pending"
  });
}

function normalizeApprovalOrigin(value) {
  if (!isPlainObject(value)) return value;
  return {
    deviceId: optionalBoundedString(value.deviceId, MAX.id),
    machineName: optionalBoundedString(value.machineName, MAX.machineName),
    ...(typeof value.workspaceName === "string"
      ? { workspaceName: boundedString(value.workspaceName, MAX.workspaceName) }
      : {})
  };
}

function assertApprovalRequest(request) {
  const errors = [];
  validateApprovalRequest(request, errors);
  if (errors.length > 0) {
    const error = new Error(`Invalid approval request: ${errors.join("; ")}`);
    error.validationErrors = errors;
    throw error;
  }
  return request;
}

function validateApprovalRequest(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("approvalRequest must be an object");
    return;
  }
  requiredStringValue(value.id, "approvalRequest.id", MAX.approvalId, errors);
  requiredInteger(value, "taskVersion", 1, errors);
  requiredStringValue(value.operation, "approvalRequest.operation", MAX.approvalText, errors);
  requiredStringValue(value.scope, "approvalRequest.scope", MAX.approvalText, errors);
  if (!isPlainObject(value.origin)) errors.push("approvalRequest.origin must be an object");
  if (isPlainObject(value.origin)) {
    requiredStringValue(value.origin.deviceId, "approvalRequest.origin.deviceId", MAX.id, errors);
    requiredStringValue(value.origin.machineName, "approvalRequest.origin.machineName", MAX.machineName, errors);
    optionalStringValue(value.origin.workspaceName, "approvalRequest.origin.workspaceName", MAX.workspaceName, errors);
  }
  requiredStringValue(value.reason, "approvalRequest.reason", MAX.approvalText, errors);
  requiredStringValue(value.risk, "approvalRequest.risk", MAX.approvalText, errors);
  requiredTimestamp(value, "requestedAt", errors);
  requiredTimestamp(value, "expiresAt", errors);
  enumValue(value, "state", ENUMS.approvalState, errors);
  if (validTimestamp(value.requestedAt) && validTimestamp(value.expiresAt) &&
      Date.parse(value.expiresAt) <= Date.parse(value.requestedAt)) {
    errors.push("approvalRequest.expiresAt must be after requestedAt");
  }
}

function validateEvent(value, errors) {
  requiredString(value, "id", MAX.id, errors);
  requiredString(value, "taskId", MAX.id, errors);
  requiredTimestamp(value, "createdAt", errors);
  requiredInteger(value, "sequence", 1, errors);
  enumValue(value, "type", ENUMS.eventType, errors);
  requiredObject(value, "data", errors);
  if (isPlainObject(value.data)) validateEventData(value.data, errors);
}

function normalizeEventData(data) {
  if (!isPlainObject(data)) return {};
  const normalized = { ...data };
  if (normalized.progressPercent !== undefined) {
    const percent = Number(normalized.progressPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new Error("progressPercent must be a number between 0 and 100");
    }
    normalized.progressPercent = String(Math.round(percent));
  }
  if (normalized.progressPhase !== undefined) {
    if (typeof normalized.progressPhase !== "string") {
      throw new Error("progressPhase must be a string");
    }
    normalized.progressPhase = normalized.progressPhase.trim().slice(0, 120);
    if (!normalized.progressPhase) delete normalized.progressPhase;
  }
  return normalized;
}

function validateEventData(data, errors) {
  if (data.progressPercent !== undefined) {
    const percent = Number(data.progressPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      errors.push("data.progressPercent must be a number between 0 and 100");
    }
  }
  if (data.progressPhase !== undefined) {
    if (typeof data.progressPhase !== "string" || data.progressPhase.length > 120) {
      errors.push("data.progressPhase must be a string of at most 120 characters");
    }
  }
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
  if (value.capabilityDetails !== undefined) {
    if (!Array.isArray(value.capabilityDetails)) errors.push("capabilityDetails must be an array");
    else value.capabilityDetails.forEach((capability, index) => {
      const result = validateProtocolRecord("capability", capability);
      if (!result.valid) {
        errors.push(`capabilityDetails[${index}] ${result.errors.join(", ")}`);
      }
    });
  }
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
  if (isPlainObject(value.payload) && ["approve", "reject"].includes(value.kind)) {
    requiredStringValue(value.payload.approvalId, "payload.approvalId", MAX.approvalId, errors);
    requiredInteger(value.payload, "taskVersion", 1, errors);
    requiredInteger(value, "expectedTaskVersion", 1, errors);
  }
  optionalStringValue(value.requestedBy, "requestedBy", MAX.id, errors);
  optionalStringValue(value.actor, "actor", MAX.id, errors);
  optionalInteger(value, "expectedTaskVersion", 1, errors);
  optionalTimestamp(value, "expiresAt", errors);
  optionalStringValue(value.requestedCapability, "requestedCapability", MAX.id, errors);
}

function validateCommandReceipt(value, errors) {
  requiredString(value, "commandId", MAX.id, errors);
  requiredTimestamp(value, "createdAt", errors);
  enumValue(value, "state", ENUMS.receiptState, errors);
  optionalStringValue(value.taskId, "taskId", MAX.id, errors);
  optionalStringValue(value.eventId, "eventId", MAX.id, errors);
  optionalStringValue(value.message, "message", MAX.message, errors);
  optionalInteger(value, "taskVersion", 1, errors);
  optionalStringValue(value.idempotencyKey, "idempotencyKey", MAX.idempotencyKey, errors);
  optionalStringValue(value.duplicateOf, "duplicateOf", MAX.id, errors);
  optionalStringValue(value.approvalId, "approvalId", MAX.approvalId, errors);
  if (value.approvalId !== undefined) {
    requiredInteger(value, "taskVersion", 1, errors);
    enumValue(value, "approvalState", ENUMS.approvalState, errors);
  } else if (value.approvalState !== undefined) {
    enumValue(value, "approvalState", ENUMS.approvalState, errors);
  }
  optionalTimestamp(value, "approvalExpiresAt", errors);
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

function normalizeCapabilityRecords(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate) => {
      if (typeof candidate === "string") {
        const match = candidate.match(/^(.*)\.v(\d+)$/);
        if (!match) return null;
        return {
          id: match[1],
          version: match[2],
          scope: defaultCapabilityScope(match[1]),
          supported: true
        };
      }
      if (!isPlainObject(candidate)) return null;
      return {
        id: optionalBoundedString(candidate.id, MAX.id),
        version: optionalBoundedString(candidate.version, MAX.version),
        scope: candidate.scope,
        supported: candidate.supported
      };
    })
    .filter(Boolean)
    .map((candidate) => {
      try {
        return protocolRecord("capability", candidate);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((candidate, index, records) => records.findIndex((item) =>
      item.id === candidate.id && item.version === candidate.version && item.scope === candidate.scope
    ) === index);
}

function defaultCapabilityScope(id) {
  return [CAPABILITY_IDS.taskReply, CAPABILITY_IDS.desktopHandoff].includes(id) ? "task" : "device";
}

function defaultCapabilities(role = "agent") {
  const ids = role === "hub"
    ? [CAPABILITY_IDS.syncSnapshot, CAPABILITY_IDS.deviceHealth]
    : [CAPABILITY_IDS.taskCapture, CAPABILITY_IDS.taskReply, CAPABILITY_IDS.desktopHandoff, CAPABILITY_IDS.deviceHealth];
  return ids.map((id) => protocolRecord("capability", {
    id,
    version: "1",
    scope: defaultCapabilityScope(id),
    supported: true
  }));
}

function protocolCompatibilityError(requestedVersion) {
  const error = new Error(
    `PhoneDex protocol version ${requestedVersion} is unsupported; supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`
  );
  error.code = "protocol_incompatible";
  error.statusCode = 426;
  error.supportedVersions = [...SUPPORTED_PROTOCOL_VERSIONS];
  return error;
}

function capabilityCompatibilityError(unsupportedCapabilities) {
  const bounded = [...new Set(unsupportedCapabilities)].slice(0, 16);
  const error = new Error(
    `PhoneDex hub does not support required capabilities: ${bounded.join(", ")}.`
  );
  error.code = "capability_unsupported";
  error.statusCode = 426;
  error.unsupportedCapabilities = bounded;
  return error;
}

function negotiateProtocolVersion(requestedVersion) {
  if (requestedVersion === undefined || requestedVersion === null || requestedVersion === "") {
    return PROTOCOL_VERSION;
  }
  const parsed = Number(requestedVersion);
  if (!Number.isInteger(parsed) || !SUPPORTED_PROTOCOL_VERSIONS.includes(parsed)) {
    throw protocolCompatibilityError(requestedVersion);
  }
  return parsed;
}

function negotiateCapabilities(requestedCapabilities) {
  if (requestedCapabilities === undefined || requestedCapabilities === null || requestedCapabilities === "") {
    return defaultCapabilities("hub");
  }
  const requested = String(requestedCapabilities)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const supported = new Set(defaultCapabilities("hub").map((capability) =>
    `${capability.id}.v${capability.version}`
  ));
  const unsupported = requested.filter((capability) => !supported.has(capability));
  if (unsupported.length > 0) throw capabilityCompatibilityError(unsupported);
  return defaultCapabilities("hub").filter((capability) =>
    requested.includes(`${capability.id}.v${capability.version}`)
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  CAPABILITY_IDS,
  ENUMS,
  PROTOCOL_VERSION,
  SCHEMAS,
  SUPPORTED_PROTOCOL_VERSIONS,
  addDeviceProtocolFields,
  addTaskProtocolFields,
  normalizeApprovalRequest,
  normalizeEventData,
  normalizeTaskQuestion,
  assertProtocolRecord,
  buildLogicalTaskEventId,
  defaultCapabilities,
  negotiateCapabilities,
  negotiateProtocolVersion,
  normalizeCaptureSources,
  normalizeCapabilityRecords,
  protocolCompatibilityError,
  protocolRecord,
  validateProtocolRecord
};
