#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { REQUIRED_GATES, evaluateQualityGates } = require("../lib/phonedex-quality-gates");

const now = new Date("2026-07-17T12:00:00.000Z");
const passing = REQUIRED_GATES.map((id) => ({
  id,
  status: "pass",
  platforms: id === "performance" ? ["ios", "macos", "windows"] : ["ios"],
  validatedAt: "2026-07-16T12:00:00.000Z",
  evidenceId: `run-${id}`
}));
const sourceRevision = "a".repeat(40);

const report = evaluateQualityGates({ gates: passing, sourceRevision }, { now });
assert.equal(report.ok, true);
assert.deepEqual(report.issues, []);
assert.equal(report.sourceRevision, sourceRevision);

const missing = evaluateQualityGates({ gates: passing.slice(1), sourceRevision }, { now });
assert.equal(missing.ok, false);
assert.equal(missing.issues.some((issue) => issue.code === "missing-gate" && issue.id === "performance"), true);

const stale = evaluateQualityGates({ gates: [{ ...passing[0], validatedAt: "2026-05-01T12:00:00.000Z" }, ...passing.slice(1)], sourceRevision }, { now });
assert.equal(stale.ok, false);
assert.match(stale.issues.map((issue) => issue.message).join(" "), /older than/);

const unsafe = evaluateQualityGates({ gates: [{ ...passing[0], platforms: ["android"], evidenceId: "task prompt" }, ...passing.slice(1)], sourceRevision }, { now });
assert.equal(unsafe.ok, false);
assert.match(unsafe.issues.map((issue) => issue.message).join(" "), /at least one supported platform/);
assert.match(unsafe.issues.map((issue) => issue.message).join(" "), /content-free identifier/);

const unsupportedAfterSupported = evaluateQualityGates({ gates: [{ ...passing[0], platforms: ["ios", "android"] }, ...passing.slice(1)], sourceRevision }, { now });
assert.equal(unsupportedAfterSupported.ok, false);
assert.match(unsupportedAfterSupported.issues.map((issue) => issue.message).join(" "), /unsupported platform/);

const tooManyPlatforms = evaluateQualityGates({ gates: [{ ...passing[0], platforms: ["ios", "macos", "windows", "ios"] }, ...passing.slice(1)], sourceRevision }, { now });
assert.equal(tooManyPlatforms.ok, false);
assert.match(tooManyPlatforms.issues.map((issue) => issue.message).join(" "), /duplicated|no more than/);

const sensitiveField = evaluateQualityGates({ gates: passing.map((gate) => ({ ...gate, taskText: "must never be recorded" })), sourceRevision }, { now });
assert.equal(sensitiveField.ok, false);
assert.match(sensitiveField.issues.map((issue) => issue.message).join(" "), /unsupported field/);

const oversizedIdentifier = evaluateQualityGates({ gates: passing.map((gate) => ({ ...gate, evidenceId: "x".repeat(121) })), sourceRevision }, { now });
assert.equal(oversizedIdentifier.ok, false);
assert.match(oversizedIdentifier.issues.map((issue) => issue.message).join(" "), /content-free identifier/);

const failed = evaluateQualityGates({ gates: passing.map((gate) => gate.id === "crash" ? { ...gate, status: "fail" } : gate), sourceRevision }, { now });
assert.equal(failed.ok, false);
assert.equal(failed.issues.some((issue) => issue.code === "gate-not-passed" && issue.id === "crash"), true);

const missingRevision = evaluateQualityGates({ gates: passing }, { now });
assert.equal(missingRevision.ok, false);
assert.equal(missingRevision.issues.some((issue) => issue.code === "missing-source-revision"), true);

const malformedRevision = evaluateQualityGates({ gates: passing, sourceRevision: "task prompt" }, { now });
assert.equal(malformedRevision.ok, false);
assert.equal(malformedRevision.sourceRevision, null);

console.log("quality-gate evidence fixture passed");
