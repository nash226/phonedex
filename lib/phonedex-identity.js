"use strict";

const crypto = require("node:crypto");

const IDENTITY_SCHEMA = "phonedex.identity.v1";
const PAIRING_GRANT_SCHEMA = "phonedex.pairing-grant.v1";
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_NAME_LENGTH = 160;
const MAX_ID_LENGTH = 120;
const MAX_PLATFORM_LENGTH = 40;
const PAIRING_CODE_LENGTH = 6;

const SUPPORTED_SCOPES = Object.freeze([
  "tasks.read",
  "tasks.reply",
  "tasks.ingest",
  "tasks.approve",
  "devices.heartbeat",
  "privacy.read",
  "privacy.manage",
  "admin"
]);

const ROLE_SCOPES = Object.freeze({
  phone: ["tasks.read", "tasks.reply"],
  agent: ["tasks.read", "tasks.ingest", "devices.heartbeat"]
});

function createPairingGrant(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const ttlMs = positiveInteger(options.ttlMs, DEFAULT_PAIRING_TTL_MS);
  const role = normalizeRole(options.role);
  const requestedScopes = options.scopes === undefined ? ROLE_SCOPES[role] : options.scopes;
  const scopes = assertSupportedScopes(requestedScopes);
  const grant = crypto.randomBytes(18).toString("base64url");
  const verificationCode = String(crypto.randomInt(0, 10 ** PAIRING_CODE_LENGTH))
    .padStart(PAIRING_CODE_LENGTH, "0");
  const stored = {
    schema: PAIRING_GRANT_SCHEMA,
    id: makeId("pairing"),
    grantHash: hashSecret(grant),
    verificationCodeHash: hashSecret(verificationCode),
    role,
    scopes,
    name: boundedString(options.name, "PhoneDex device"),
    platform: boundedString(options.platform, role === "phone" ? "ios" : "unknown"),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    usedAt: null
  };

  return {
    stored,
    public: {
      grant,
      verificationCode,
      role: stored.role,
      scopes: stored.scopes,
      createdAt: stored.createdAt,
      expiresAt: stored.expiresAt
    }
  };
}

function createIdentity({ grant, deviceId, name, platform, now = new Date() } = {}) {
  const credential = crypto.randomBytes(32).toString("base64url");
  const identity = {
    schema: IDENTITY_SCHEMA,
    id: makeId("identity"),
    deviceId: boundedString(deviceId, makeId("device"), MAX_ID_LENGTH),
    name: boundedString(name, grant?.name || "PhoneDex device"),
    role: normalizeRole(grant?.role),
    platform: boundedString(platform, grant?.platform || "unknown", MAX_PLATFORM_LENGTH),
    scopes: normalizeScopes(grant?.scopes || ROLE_SCOPES[normalizeRole(grant?.role)]),
    status: "active",
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    credentialHash: hashSecret(credential)
  };

  return { credential, identity };
}

function publicIdentity(identity) {
  if (!identity || typeof identity !== "object") return null;
  return {
    schema: IDENTITY_SCHEMA,
    id: identity.id,
    deviceId: identity.deviceId,
    name: identity.name,
    role: identity.role,
    platform: identity.platform,
    scopes: normalizeScopes(identity.scopes),
    status: identity.status,
    createdAt: identity.createdAt,
    lastSeenAt: identity.lastSeenAt,
    ...(identity.revokedAt ? { revokedAt: identity.revokedAt } : {})
  };
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function secretsMatch(leftHash, rightHash) {
  const left = Buffer.from(String(leftHash || ""), "utf8");
  const right = Buffer.from(String(rightHash || ""), "utf8");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function normalizeRole(value) {
  return value === "agent" ? "agent" : "phone";
}

function normalizeScopes(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((scope) => typeof scope === "string" && SUPPORTED_SCOPES.includes(scope))
    .slice(0, 12))];
}

function assertSupportedScopes(value) {
  if (!Array.isArray(value)) {
    throw new Error("Pairing scopes must be a comma-separated list of supported scopes.");
  }

  const invalid = value.filter((scope) => !SUPPORTED_SCOPES.includes(scope));
  if (invalid.length > 0) {
    throw new Error(`Unsupported PhoneDex pairing scope: ${invalid.join(", ")}`);
  }

  return normalizeScopes(value);
}

function hasScope(identity, scope) {
  return Boolean(
    identity &&
      identity.status === "active" &&
      (Array.isArray(identity.scopes) ? identity.scopes : [])
        .some((candidate) => candidate === scope || candidate === "admin")
  );
}

function boundedString(value, fallback, maxLength = MAX_NAME_LENGTH) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, maxLength);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

module.exports = {
  DEFAULT_PAIRING_TTL_MS,
  IDENTITY_SCHEMA,
  PAIRING_CODE_LENGTH,
  PAIRING_GRANT_SCHEMA,
  SUPPORTED_SCOPES,
  ROLE_SCOPES,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLATFORM_LENGTH,
  createIdentity,
  createPairingGrant,
  assertSupportedScopes,
  hasScope,
  hashSecret,
  normalizeRole,
  normalizeScopes,
  publicIdentity,
  secretsMatch
};
