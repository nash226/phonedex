"use strict";

const SYNC_SCHEMA = "phonedex.sync.v1";
const CURSOR_SCHEMA = "phonedex.cursor.v1";
const DEFAULT_SYNC_LIMIT = 50;
const MAX_SYNC_LIMIT = 100;

function normalizeSyncLimit(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_SYNC_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_SYNC_LIMIT;
  return Math.min(parsed, MAX_SYNC_LIMIT);
}

function encodeSyncCursor(cursor) {
  const payload = {
    schema: CURSOR_SCHEMA,
    mode: cursor.mode,
    position: cursor.position,
    ...(cursor.mode === "snapshot"
      ? {
          revision: cursor.revision,
          taskOffset: cursor.taskOffset,
          deviceOffset: cursor.deviceOffset,
          eventOffset: cursor.eventOffset
        }
      : {})
  };
  return `v1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function decodeSyncCursor(value) {
  if (!value) return null;
  if (typeof value !== "string" || !value.startsWith("v1.")) {
    throw syncError("sync_cursor_invalid", "Sync cursor is invalid.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8"));
  } catch {
    throw syncError("sync_cursor_invalid", "Sync cursor is invalid.");
  }

  if (
    !payload ||
    payload.schema !== CURSOR_SCHEMA ||
    !["snapshot", "stream"].includes(payload.mode) ||
    !Number.isInteger(payload.position) ||
    payload.position < 0
  ) {
    throw syncError("sync_cursor_invalid", "Sync cursor is invalid.");
  }

  if (payload.mode === "snapshot") {
    if (payload.eventOffset === undefined) payload.eventOffset = 0;
    if (
      !Number.isInteger(payload.revision) ||
      payload.revision < 0 ||
      !Number.isInteger(payload.taskOffset) ||
      payload.taskOffset < 0 ||
      !Number.isInteger(payload.deviceOffset) ||
      payload.deviceOffset < 0 ||
      !Number.isInteger(payload.eventOffset) ||
      payload.eventOffset < 0
    ) {
      throw syncError("sync_cursor_invalid", "Sync cursor is invalid.");
    }
  }

  return payload;
}

function syncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  CURSOR_SCHEMA,
  DEFAULT_SYNC_LIMIT,
  MAX_SYNC_LIMIT,
  SYNC_SCHEMA,
  decodeSyncCursor,
  encodeSyncCursor,
  normalizeSyncLimit,
  syncError
};
