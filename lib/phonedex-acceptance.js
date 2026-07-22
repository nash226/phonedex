"use strict";

const SCHEMA = "phonedex.acceptance-evidence.v1";
const DEFAULT_MAX_AGE_DAYS = 30;
const STATUSES = new Set(["pass", "fail", "not-run"]);
const PLATFORMS = new Set(["ios", "macos", "windows"]);
const REQUIRED_SCENARIOS = Object.freeze([
  "secure-pair",
  "restore",
  "multi-machine-inbox",
  "deduplication",
  "reply-receipt",
  "dictated-reply",
  "stale-protection",
  "approval-safety",
  "create-and-control",
  "review",
  "offline",
  "notification-privacy",
  "revoke",
  "accessibility",
  "upgrade-and-rollback"
]);
const MAX_RECORDS = REQUIRED_SCENARIOS.length + 20;
const SOURCE_REVISION_PATTERN = /^[0-9a-f]{40,64}$/i;

function evaluateAcceptanceEvidence(input, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const records = Array.isArray(input) ? input : input?.scenarios;
  const issues = [];
  const scenarios = [];
  const sourceRevision = typeof input === "object" && input !== null ? input.sourceRevision : null;

  if (!SOURCE_REVISION_PATTERN.test(typeof sourceRevision === "string" ? sourceRevision : "")) {
    issues.push({ code: "missing-source-revision", message: "acceptance evidence must identify the source revision" });
  }

  if (!Array.isArray(records)) {
    issues.push({ code: "invalid-evidence", message: "Evidence must contain a scenarios array." });
  } else {
    const seen = new Set();
    if (records.length > MAX_RECORDS) {
      issues.push({ code: "evidence-too-large", message: `Evidence contains more than ${MAX_RECORDS} scenario records.` });
    }
    for (const record of records.slice(0, MAX_RECORDS)) {
      const id = boundedString(record?.id, 80);
      const status = boundedString(record?.status, 20).toLowerCase();
      const { platforms, invalidPlatforms, duplicatePlatforms, tooManyPlatforms } = normalizePlatforms(record?.platforms);
      const validatedAt = record?.validatedAt;
      const recordIssues = [];

      if (!REQUIRED_SCENARIOS.includes(id)) recordIssues.push("unknown scenario");
      if (id && seen.has(id)) recordIssues.push("scenario is duplicated");
      if (id) seen.add(id);
      if (!STATUSES.has(status)) recordIssues.push("status must be pass, fail, or not-run");
      if (platforms.length === 0) recordIssues.push("at least one supported platform is required");
      if (invalidPlatforms.length > 0) recordIssues.push("unsupported platform listed");
      if (duplicatePlatforms.length > 0) recordIssues.push("platform is duplicated");
      if (tooManyPlatforms) recordIssues.push("no more than 3 platforms may be listed");
      if (!validTimestamp(validatedAt)) {
        recordIssues.push("validatedAt must be an ISO-8601 UTC timestamp");
      } else if (new Date(validatedAt).getTime() > now.getTime() + 5 * 60 * 1000) {
        recordIssues.push("validatedAt is in the future");
      } else if (now.getTime() - new Date(validatedAt).getTime() > maxAgeDays * 24 * 60 * 60 * 1000) {
        recordIssues.push(`evidence is older than ${maxAgeDays} days`);
      }

      const ok = recordIssues.length === 0 && status === "pass";
      scenarios.push({ id, status: STATUSES.has(status) ? status : "not-run", platforms, validatedAt: validTimestamp(validatedAt) ? validatedAt : null, ok, issues: recordIssues });
      if (recordIssues.length > 0 || status !== "pass") {
        issues.push({ code: recordIssues.length > 0 ? "invalid-scenario" : "scenario-not-passed", id: id || "unknown", message: recordIssues.join("; ") || `status is ${status}` });
      }
    }
  }

  const present = new Set(scenarios.map((scenario) => scenario.id));
  for (const id of REQUIRED_SCENARIOS) {
    if (!present.has(id)) issues.push({ code: "missing-scenario", id, message: "acceptance scenario evidence is missing" });
  }

  return {
    schema: SCHEMA,
    generatedAt: now.toISOString(),
    sourceRevision: SOURCE_REVISION_PATTERN.test(typeof sourceRevision === "string" ? sourceRevision : "") ? sourceRevision.toLowerCase() : null,
    maxAgeDays,
    requiredScenarios: REQUIRED_SCENARIOS,
    scenarios,
    ok: issues.length === 0,
    issues
  };
}

function normalizePlatforms(value) {
  if (!Array.isArray(value)) return { platforms: [], invalidPlatforms: [], duplicatePlatforms: [], tooManyPlatforms: false };
  const platforms = [];
  const invalidPlatforms = [];
  const duplicatePlatforms = [];
  for (const candidate of value.slice(0, 4)) {
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
  return { platforms: platforms.slice(0, 3), invalidPlatforms, duplicatePlatforms, tooManyPlatforms: value.length > 3 };
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function boundedString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

module.exports = { DEFAULT_MAX_AGE_DAYS, MAX_RECORDS, REQUIRED_SCENARIOS, SCHEMA, SOURCE_REVISION_PATTERN, evaluateAcceptanceEvidence };
