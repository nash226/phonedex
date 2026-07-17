"use strict";

const SCHEMA = "phonedex.release-matrix.v1";
const DEFAULT_MAX_AGE_DAYS = 30;
const REQUIRED_PLATFORMS = Object.freeze(["ios", "macos", "windows"]);
const REQUIRED_SCENARIOS = Object.freeze({
  ios: ["pairing", "transport", "sync", "replies", "approval", "review", "privacy", "recovery", "accessibility"],
  macos: ["enroll-heartbeat", "task-ingest", "reply", "restart-recovery", "offline-recovery"],
  windows: ["enroll-heartbeat", "task-ingest", "reply", "restart-recovery", "offline-recovery"]
});
const RESULT_VALUES = new Set(["pass", "fail", "not-run"]);

function evaluateReleaseMatrix(input, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS } = {}) {
  const records = Array.isArray(input) ? input : input?.devices;
  const issues = [];
  const normalized = [];

  if (!Array.isArray(records)) {
    issues.push({ code: "invalid-evidence", message: "Evidence must contain a devices array." });
  } else {
    const seen = new Set();
    for (const record of records.slice(0, 100)) {
      const deviceId = boundedString(record?.deviceId, 160);
      const platform = boundedString(record?.platform, 20).toLowerCase();
      const validatedAt = record?.validatedAt;
      const scenarios = normalizeScenarios(record?.scenarios);
      const deviceIssues = [];

      if (!deviceId) deviceIssues.push("deviceId is required");
      if (!REQUIRED_PLATFORMS.includes(platform)) deviceIssues.push("platform must be ios, macos, or windows");
      if (deviceId && seen.has(deviceId)) deviceIssues.push("deviceId is duplicated");
      if (deviceId) seen.add(deviceId);
      if (!validTimestamp(validatedAt)) {
        deviceIssues.push("validatedAt must be an ISO-8601 UTC timestamp");
      } else if (new Date(validatedAt).getTime() > now.getTime() + 5 * 60 * 1000) {
        deviceIssues.push("validatedAt is in the future");
      } else if (now.getTime() - new Date(validatedAt).getTime() > maxAgeDays * 24 * 60 * 60 * 1000) {
        deviceIssues.push(`evidence is older than ${maxAgeDays} days`);
      }

      for (const scenario of REQUIRED_SCENARIOS[platform] || []) {
        if (scenarios[scenario] !== "pass") deviceIssues.push(`${scenario} is ${scenarios[scenario] || "missing"}`);
      }

      normalized.push({ deviceId, platform, validatedAt: validTimestamp(validatedAt) ? validatedAt : null, scenarios, ok: deviceIssues.length === 0, issues: deviceIssues });
      if (deviceIssues.length > 0) issues.push({ code: "device-not-ready", deviceId: deviceId || "unknown", message: deviceIssues.join("; ") });
    }
  }

  for (const platform of REQUIRED_PLATFORMS) {
    if (!normalized.some((record) => record.platform === platform && record.ok)) {
      issues.push({ code: "platform-not-ready", platform, message: `No passing, current ${platform} evidence is available.` });
    }
  }

  return { schema: SCHEMA, generatedAt: now.toISOString(), maxAgeDays, requiredPlatforms: REQUIRED_PLATFORMS, devices: normalized, ok: issues.length === 0, issues };
}

function normalizeScenarios(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, result]) => /^[a-z][a-z0-9-]{0,60}$/.test(key) && RESULT_VALUES.has(result)).slice(0, 50));
}

function validTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function boundedString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

module.exports = { DEFAULT_MAX_AGE_DAYS, REQUIRED_PLATFORMS, REQUIRED_SCENARIOS, SCHEMA, evaluateReleaseMatrix };
