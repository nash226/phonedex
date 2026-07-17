#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { ACCEPTANCE_IDS, QUALITY_IDS, buildReleaseReadiness } = require("../lib/phonedex-release-readiness");

const now = new Date("2026-07-17T12:00:00.000Z");
const acceptance = {
  schema: "phonedex.acceptance-evidence.v1", ok: true, scenarios: ACCEPTANCE_IDS.map((id) => ({ id, status: "pass", ok: true }))
};
const quality = {
  schema: "phonedex.quality-gates.v1", ok: true, gates: QUALITY_IDS.map((id) => ({ id, status: "pass", ok: true }))
};

const passing = buildReleaseReadiness({ acceptance, quality, generatedAt: now });
assert.equal(passing.automationReady, true);
assert.equal(passing.releaseReady, false);
assert.equal(passing.evidence.acceptance.passedCount, ACCEPTANCE_IDS.length);
assert.equal(passing.releaseOwnerGates.length, 4);
assert.equal(Object.hasOwn(passing, "issues"), false);

const failed = buildReleaseReadiness({
  acceptance: { ...acceptance, scenarios: acceptance.scenarios.map((record, index) => index === 0 ? { ...record, status: "fail" } : record) },
  quality,
  generatedAt: now
});
assert.equal(failed.automationReady, false);
assert.equal(failed.evidence.acceptance.failedCount, 1);
assert.equal(failed.releaseReady, false);

const unsafe = buildReleaseReadiness({
  acceptance: { ...acceptance, scenarios: [{ ...acceptance.scenarios[0], text: "credential-token" }, ...acceptance.scenarios.slice(1)] },
  quality,
  generatedAt: now
});
assert.equal(JSON.stringify(unsafe).includes("credential-token"), false);

console.log("release readiness fixture passed");
