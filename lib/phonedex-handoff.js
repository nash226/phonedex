"use strict";

const { supportsAdapterCapability } = require("./phonedex-adapter");
const { redactSensitiveText } = require("./phonedex-privacy");

const HANDOFF_SCHEMA = "phonedex.desktop-handoff.v1";
const HANDOFF_CAPABILITY = "desktop.handoff.v1";
const MAX_ID_LENGTH = 160;
const MAX_LABEL_LENGTH = 240;

function createDesktopHandoff({ task, adapter, machineName = "Unknown device" } = {}) {
  if (!supportsAdapterCapability(adapter, "desktop.handoff")) {
    throw handoffError(
      "capability_unsupported",
      "This agent cannot prepare a desktop handoff through its supported Codex adapter.",
      409
    );
  }

  const taskId = boundedIdentifier(task?.id);
  const sessionId = boundedIdentifier(task?.sessionId);
  if (!taskId || !sessionId) {
    throw handoffError(
      "task_handoff_unavailable",
      "This task does not include a stable Codex session identity for desktop handoff.",
      409
    );
  }

  const handoff = {
    schema: HANDOFF_SCHEMA,
    protocolVersion: 1,
    capability: HANDOFF_CAPABILITY,
    taskId,
    sessionId,
    machineName: boundedLabel(task?.machineName || machineName, "Unknown device"),
    workspaceName: boundedLabel(task?.workspaceName, "Unknown workspace"),
    platform: boundedLabel(adapter.platform, "unknown", 40),
    adapterId: boundedLabel(adapter.id, "unknown", MAX_ID_LENGTH),
    adapterMode: boundedLabel(adapter.mode, "unknown", 40),
    ...(task?.repository ? { repository: boundedLabel(redactSensitiveText(task.repository), "", 400) } : {}),
    ...(task?.branch ? { branch: boundedLabel(task.branch, "", 240) } : {}),
    createdAt: new Date().toISOString()
  };

  return Object.freeze(handoff);
}

function handoffError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function boundedIdentifier(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || /[\u0000\r\n]/.test(normalized)) return "";
  return normalized.slice(0, MAX_ID_LENGTH);
}

function boundedLabel(value, fallback, maxLength = MAX_LABEL_LENGTH) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).replace(/[\u0000\r\n]/g, " ").slice(0, maxLength);
}

module.exports = {
  HANDOFF_CAPABILITY,
  HANDOFF_SCHEMA,
  createDesktopHandoff
};
