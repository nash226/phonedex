"use strict";

const SCHEMA = "phonedex.release-readiness.v1";
const ACCEPTANCE_SCHEMA = "phonedex.acceptance-evidence.v1";
const QUALITY_SCHEMA = "phonedex.quality-gates.v1";
const ACCEPTANCE_IDS = Object.freeze([
  "secure-pair", "restore", "multi-machine-inbox", "deduplication", "reply-receipt",
  "dictated-reply", "stale-protection", "approval-safety", "create-and-control",
  "review", "offline", "notification-privacy", "revoke", "accessibility",
  "upgrade-and-rollback"
]);
const QUALITY_IDS = Object.freeze(["performance", "battery", "accessibility", "localization", "crash"]);
const RELEASE_OWNER_GATES = Object.freeze([
  { id: "signing-and-entitlements", reason: "Apple signing and entitlements require release-owner credentials." },
  { id: "privacy-disclosures", reason: "Privacy policy and retention disclosures require release-owner/legal review." },
  { id: "real-device-matrix", reason: "Real-device and TestFlight validation require release-owner execution." },
  { id: "apns-operating-model", reason: "Remote notification delivery requires an APNs/provider decision." }
]);

function buildReleaseReadiness({ acceptance, quality, generatedAt = new Date() } = {}) {
  const acceptanceSummary = summarizeReport(acceptance, ACCEPTANCE_SCHEMA, ACCEPTANCE_IDS, "scenarios");
  const qualitySummary = summarizeReport(quality, QUALITY_SCHEMA, QUALITY_IDS, "gates");
  const automationReady = acceptanceSummary.ok && qualitySummary.ok;
  return {
    schema: SCHEMA,
    generatedAt: generatedAt.toISOString(),
    automationReady,
    releaseReady: false,
    evidence: { acceptance: acceptanceSummary, quality: qualitySummary },
    releaseOwnerGates: RELEASE_OWNER_GATES.map((gate) => ({ ...gate, status: "required" }))
  };
}

function summarizeReport(report, expectedSchema, expectedIds, collectionKey) {
  const records = report && Array.isArray(report[collectionKey]) ? report[collectionKey] : [];
  const ids = new Set();
  let passed = 0;
  let failed = 0;
  let notRun = 0;
  let invalid = 0;
  for (const record of records.slice(0, expectedIds.length + 20)) {
    const id = typeof record?.id === "string" ? record.id : "";
    const status = typeof record?.status === "string" ? record.status : "";
    if (!expectedIds.includes(id) || ids.has(id) || !["pass", "fail", "not-run"].includes(status) || record?.ok !== true) invalid += 1;
    ids.add(id);
    if (status === "pass") passed += 1;
    else if (status === "fail") failed += 1;
    else if (status === "not-run") notRun += 1;
  }
  const complete = expectedIds.every((id) => ids.has(id)) && records.length === expectedIds.length;
  const ok = report?.schema === expectedSchema && report?.ok === true && complete && invalid === 0 && passed === expectedIds.length;
  return { schema: expectedSchema, ok, requiredCount: expectedIds.length, passedCount: passed, failedCount: failed, notRunCount: notRun, invalidCount: invalid };
}

module.exports = { ACCEPTANCE_IDS, QUALITY_IDS, RELEASE_OWNER_GATES, SCHEMA, buildReleaseReadiness };
