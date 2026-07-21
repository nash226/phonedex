"use strict";

const SCHEMA = "phonedex.quality-gates.v1";
const DEFAULT_MAX_AGE_DAYS = 30;
const STATUSES = new Set(["pass", "fail", "not-run"]);
const PLATFORMS = new Set(["ios", "macos", "windows"]);
const REQUIRED_GATES = Object.freeze(["performance", "battery", "accessibility", "localization", "crash"]);
const MAX_RECORDS = REQUIRED_GATES.length;
const MAX_PLATFORMS = PLATFORMS.size;
const MAX_EVIDENCE_ID_LENGTH = 120;
const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40,64}$/i;
const ALLOWED_KEYS = new Set(["id", "status", "platforms", "validatedAt", "evidenceId"]);

function evaluateQualityGates(input, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const records = Array.isArray(input) ? input : input?.gates;
  const issues = [];
  const gates = [];
  const sourceRevision = typeof input === "object" && input !== null ? input.sourceRevision : null;

  if (!SOURCE_REVISION_PATTERN.test(typeof sourceRevision === "string" ? sourceRevision : "")) {
    issues.push({ code: "missing-source-revision", message: "quality-gate evidence must identify the source revision" });
  }

  if (!Array.isArray(records)) {
    issues.push({ code: "invalid-evidence", message: "Evidence must contain a gates array." });
  } else {
    if (records.length > MAX_RECORDS) {
      issues.push({ code: "evidence-too-large", message: `Evidence contains more than ${MAX_RECORDS} quality-gate records.` });
    }
    const seen = new Set();
    for (const record of records.slice(0, MAX_RECORDS)) {
      const id = boundedString(record?.id, 40).toLowerCase();
      const status = boundedString(record?.status, 20).toLowerCase();
      const { platforms, invalidPlatforms, duplicatePlatforms, tooManyPlatforms } = normalizePlatforms(record?.platforms);
      const validatedAt = record?.validatedAt;
      const evidenceId = boundedIdentifier(record?.evidenceId);
      const recordIssues = [];

      for (const key of Object.keys(record ?? {})) {
        if (!ALLOWED_KEYS.has(key)) recordIssues.push("record contains an unsupported field");
      }
      if (!REQUIRED_GATES.includes(id)) recordIssues.push("unknown quality gate");
      if (id && seen.has(id)) recordIssues.push("quality gate is duplicated");
      if (id) seen.add(id);
      if (!STATUSES.has(status)) recordIssues.push("status must be pass, fail, or not-run");
      if (platforms.length === 0) recordIssues.push("at least one supported platform is required");
      if (invalidPlatforms.length > 0) recordIssues.push("unsupported platform listed");
      if (duplicatePlatforms.length > 0) recordIssues.push("platform is duplicated");
      if (tooManyPlatforms) recordIssues.push(`no more than ${MAX_PLATFORMS} platforms may be listed`);
      if (!validTimestamp(validatedAt)) {
        recordIssues.push("validatedAt must be an ISO-8601 UTC timestamp");
      } else if (new Date(validatedAt).getTime() > now.getTime() + 5 * 60 * 1000) {
        recordIssues.push("validatedAt is in the future");
      } else if (now.getTime() - new Date(validatedAt).getTime() > maxAgeDays * 24 * 60 * 60 * 1000) {
        recordIssues.push(`evidence is older than ${maxAgeDays} days`);
      }
      if (!/^[A-Za-z0-9._:-]{1,120}$/.test(evidenceId)) {
        recordIssues.push("evidenceId must be a bounded content-free identifier");
      }

      const ok = recordIssues.length === 0 && status === "pass";
      gates.push({ id, status: STATUSES.has(status) ? status : "not-run", platforms, validatedAt: validTimestamp(validatedAt) ? validatedAt : null, evidenceId: evidenceId || null, ok, issues: recordIssues });
      if (recordIssues.length > 0 || status !== "pass") {
        issues.push({ code: recordIssues.length > 0 ? "invalid-gate" : "gate-not-passed", id: id || "unknown", message: recordIssues.join("; ") || `status is ${status}` });
      }
    }
  }

  const present = new Set(gates.map((gate) => gate.id));
  for (const id of REQUIRED_GATES) {
    if (!present.has(id)) issues.push({ code: "missing-gate", id, message: "quality-gate evidence is missing" });
  }

  return {
    schema: SCHEMA,
    generatedAt: now.toISOString(),
    sourceRevision: SOURCE_REVISION_PATTERN.test(typeof sourceRevision === "string" ? sourceRevision : "") ? sourceRevision.toLowerCase() : null,
    maxAgeDays,
    requiredGates: REQUIRED_GATES,
    gates,
    ok: issues.length === 0,
    issues
  };
}

function normalizePlatforms(value) {
  if (!Array.isArray(value)) return { platforms: [], invalidPlatforms: [], duplicatePlatforms: [], tooManyPlatforms: false };
  const platforms = [];
  const invalidPlatforms = [];
  const duplicatePlatforms = [];
  for (const candidate of value) {
    const platform = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
    if (PLATFORMS.has(platform)) {
      if (platforms.includes(platform)) {
        if (!duplicatePlatforms.includes(platform)) duplicatePlatforms.push(platform);
      } else {
        platforms.push(platform);
      }
    } else if (!invalidPlatforms.includes(platform || "invalid")) {
      invalidPlatforms.push(platform || "invalid");
    }
  }
  return { platforms, invalidPlatforms, duplicatePlatforms, tooManyPlatforms: value.length > MAX_PLATFORMS };
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function boundedString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function boundedIdentifier(value) {
  if (typeof value !== "string") return "";
  const identifier = value.trim();
  return identifier.length <= MAX_EVIDENCE_ID_LENGTH ? identifier : "";
}

module.exports = { DEFAULT_MAX_AGE_DAYS, MAX_RECORDS, REQUIRED_GATES, SCHEMA, SOURCE_REVISION_PATTERN, evaluateQualityGates };
