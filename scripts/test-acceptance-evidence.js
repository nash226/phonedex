#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { REQUIRED_SCENARIOS, evaluateAcceptanceEvidence } = require("../lib/phonedex-acceptance");

const now = new Date("2026-07-17T12:00:00.000Z");
const sourceRevision = "0123456789abcdef0123456789abcdef01234567";
const passing = REQUIRED_SCENARIOS.map((id) => ({
  id,
  status: "pass",
  platforms: id === "multi-machine-inbox" ? ["ios", "macos", "windows"] : ["ios"],
  validatedAt: "2026-07-16T12:00:00.000Z"
}));

const report = evaluateAcceptanceEvidence({ sourceRevision, scenarios: passing }, { now });
assert.equal(report.ok, true);
assert.deepEqual(report.issues, []);
assert.equal(report.sourceRevision, sourceRevision);

const missingSourceRevision = evaluateAcceptanceEvidence({ scenarios: passing }, { now });
assert.equal(missingSourceRevision.ok, false);
assert.equal(missingSourceRevision.issues.some((issue) => issue.code === "missing-source-revision"), true);

const malformedSourceRevision = evaluateAcceptanceEvidence({ sourceRevision: "deadbeef", scenarios: passing }, { now });
assert.equal(malformedSourceRevision.ok, false);
assert.equal(malformedSourceRevision.sourceRevision, null);

const missing = evaluateAcceptanceEvidence({ sourceRevision, scenarios: passing.slice(1) }, { now });
assert.equal(missing.ok, false);
assert.equal(missing.issues.some((issue) => issue.code === "missing-scenario" && issue.id === "secure-pair"), true);

const stale = evaluateAcceptanceEvidence({ sourceRevision, scenarios: [{ ...passing[0], validatedAt: "2026-05-01T12:00:00.000Z" }] }, { now });
assert.equal(stale.ok, false);
assert.match(stale.issues.map((issue) => issue.message).join(" "), /older than/);

const unsafe = evaluateAcceptanceEvidence({ sourceRevision, scenarios: [{ ...passing[0], platforms: ["ios", "android"], id: "unknown", status: "pass" }] }, { now });
assert.equal(unsafe.ok, false);
assert.match(unsafe.issues.map((issue) => issue.message).join(" "), /unknown scenario/);
assert.match(unsafe.issues.map((issue) => issue.message).join(" "), /unsupported platform/);
assert.deepEqual(unsafe.scenarios[0].platforms, ["ios"]);

const unsupportedOnly = evaluateAcceptanceEvidence({ sourceRevision, scenarios: [{ ...passing[0], platforms: ["android"] }] }, { now });
assert.equal(unsupportedOnly.ok, false);
assert.match(unsupportedOnly.issues.map((issue) => issue.message).join(" "), /at least one supported platform/);

const duplicatePlatform = evaluateAcceptanceEvidence({ sourceRevision, scenarios: [{ ...passing[0], platforms: ["ios", "ios"] }] }, { now });
assert.equal(duplicatePlatform.ok, false);
assert.match(duplicatePlatform.issues.map((issue) => issue.message).join(" "), /platform is duplicated/);

const overBroadPlatforms = evaluateAcceptanceEvidence({ sourceRevision, scenarios: [{ ...passing[0], platforms: ["ios", "macos", "windows", "android"] }] }, { now });
assert.equal(overBroadPlatforms.ok, false);
assert.match(overBroadPlatforms.issues.map((issue) => issue.message).join(" "), /no more than 3 platforms/);
assert.match(overBroadPlatforms.issues.map((issue) => issue.message).join(" "), /unsupported platform/);

const oversized = evaluateAcceptanceEvidence({ sourceRevision, scenarios: [...passing, ...Array.from({ length: 21 }, (_, index) => ({
  id: `extra-${index}`,
  status: "pass",
  platforms: ["ios"],
  validatedAt: "2026-07-16T12:00:00.000Z"
}))] }, { now });
assert.equal(oversized.ok, false);
assert.equal(oversized.issues.some((issue) => issue.code === "evidence-too-large"), true);

console.log("acceptance evidence fixture passed");
