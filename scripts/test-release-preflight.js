#!/usr/bin/env node

const assert = require("node:assert/strict");
const { runPreflight } = require("./release-preflight");

const result = runPreflight();
assert.equal(result.schema, "phonedex.release-preflight.v1");
assert.equal(result.status, "blocked");
assert.ok(result.checks.every((check) => check.status === "pass"));
assert.deepEqual(result.blockers.map((blocker) => blocker.issue), [132, 125, 138, null]);
assert.equal(JSON.stringify(result).includes("token"), false);
assert.equal(JSON.stringify(result).includes("workspace"), false);
console.log("release preflight fixture passed");
