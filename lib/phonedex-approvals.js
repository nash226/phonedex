"use strict";

const { normalizeApprovalRequest } = require("./phonedex-protocol");

const APPROVAL_CAPABILITY = "approval.respond.v1";
const APPROVAL_KINDS = Object.freeze(["approve", "reject"]);

function validateApprovalCommand(task, command, now = new Date()) {
  const request = task?.approvalRequest;
  if (!request) {
    throw approvalError("approval_not_available", "This task has no approval request.", 409);
  }
  if (!APPROVAL_KINDS.includes(command?.kind)) {
    throw approvalError("approval_command_invalid", "This approval action is not supported.", 422);
  }
  if (command.requestedCapability !== APPROVAL_CAPABILITY) {
    throw approvalError(
      "capability_unsupported",
      "The approval action did not request the supported approval contract.",
      409
    );
  }
  if (!Array.isArray(task.lifecycleCapabilities) || !task.lifecycleCapabilities.includes(APPROVAL_CAPABILITY)) {
    throw approvalError(
      "capability_unsupported",
      "The originating agent has not advertised approval responses for this task.",
      409
    );
  }

  const taskVersion = Number.isInteger(task.version) && task.version >= 1 ? task.version : 1;
  const expectedTaskVersion = command.expectedTaskVersion;
  const requestedTaskVersion = command.payload?.taskVersion;
  if (
    expectedTaskVersion !== taskVersion ||
    requestedTaskVersion !== taskVersion ||
    request.taskVersion !== taskVersion
  ) {
    throw approvalError(
      "task_stale",
      "The approval changed before this action arrived. Refresh and review the latest request.",
      409,
      { currentTaskVersion: taskVersion, task }
    );
  }
  if (String(command.payload?.approvalId || "") !== request.id) {
    throw approvalError(
      "approval_mismatch",
      "This approval no longer matches the selected task.",
      409,
      { currentTaskVersion: taskVersion, task }
    );
  }
  if (request.state !== "pending") {
    throw approvalError(
      "approval_already_handled",
      `This approval is already ${request.state || "handled"}. Refresh before trying again.`,
      409,
      { currentTaskVersion: taskVersion, task }
    );
  }
  if (Date.parse(request.expiresAt) <= now.getTime()) {
    throw approvalError(
      "approval_expired",
      "This approval has expired. Refresh the task before relying on it.",
      409,
      { currentTaskVersion: taskVersion, task }
    );
  }
  if (task.status !== "awaiting_approval") {
    throw approvalError(
      "approval_stale",
      "This task is no longer awaiting the reviewed approval.",
      409,
      { currentTaskVersion: taskVersion, task }
    );
  }

  return {
    approvalId: request.id,
    approvalState: command.kind === "approve" ? "approved" : "rejected",
    taskVersion,
    approvalExpiresAt: request.expiresAt
  };
}

function validateApprovalReceipt(payload, decision, task) {
  const receipt = payload?.receipt;
  if (!receipt || !["accepted", "completed", "duplicate"].includes(receipt.state)) {
    throw approvalError(
      "origin_invalid_receipt",
      "The originating agent did not return a valid approval receipt.",
      502
    );
  }
  if (receipt.approvalId !== decision.approvalId || receipt.approvalState !== decision.approvalState) {
    throw approvalError(
      "origin_invalid_receipt",
      "The originating agent returned a receipt for a different approval.",
      502
    );
  }
  if (!Number.isInteger(receipt.taskVersion) || receipt.taskVersion <= decision.taskVersion) {
    throw approvalError(
      "origin_invalid_receipt",
      "The originating agent did not advance the approved task version.",
      502
    );
  }
  if (payload.task) {
    const returnedRequest = normalizeApprovalRequest(payload.task.approvalRequest);
    if (
      payload.task.id !== task.id ||
      payload.task.version !== receipt.taskVersion ||
      returnedRequest?.id !== decision.approvalId ||
      returnedRequest?.state !== decision.approvalState
    ) {
      throw approvalError(
        "origin_invalid_receipt",
        "The originating agent returned task state that does not match the approval receipt.",
        502
      );
    }
  }
  return receipt;
}

function projectApprovalDecision(task, decision, now = new Date()) {
  const nextVersion = decision.taskVersion + 1;
  const approvalRequest = {
    ...task.approvalRequest,
    state: decision.approvalState
  };
  return {
    ...task,
    updatedAt: now.toISOString(),
    version: nextVersion,
    status: decision.approvalState === "approved" ? "running" : "failed",
    text: decision.approvalState === "approved"
      ? "Approval accepted. Waiting for the originating agent to continue."
      : "Approval rejected from PhoneDex.",
    approvalRequest
  };
}

function approvalError(code, message, statusCode, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

module.exports = {
  APPROVAL_CAPABILITY,
  APPROVAL_KINDS,
  approvalError,
  projectApprovalDecision,
  validateApprovalCommand,
  validateApprovalReceipt
};
