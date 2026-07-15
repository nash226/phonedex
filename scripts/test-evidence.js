#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  evidenceSummary,
  mergeTaskEvidence,
  normalizeTaskEvidence
} = require("../lib/phonedex-evidence");

const evidence = normalizeTaskEvidence({
  changedFiles: [
    {
      path: "./ios/PhoneDexApp/ContentView.swift",
      status: "modified",
      additions: 12,
      deletions: 3,
      sourceRef: "ios/PhoneDexApp/ContentView.swift#L10-L30",
      summary: "Updated evidence view"
    },
    { path: "/Users/example/private.swift", status: "modified" },
    { path: "../private.swift", status: "modified" },
    { path: "ios/PhoneDexApp/ContentView.swift", status: "modified" }
  ],
  artifacts: [
    {
      id: "build-log",
      name: "iOS build log",
      kind: "log",
      sourceRef: "artifacts/ios-build.log",
      sizeBytes: 1024,
      sha256: "abc123"
    },
    { id: "secret", name: "Secret", sourceRef: "https://example.test/download?token=secret" }
  ],
  validations: [
    { id: "npm-test", name: "npm test", status: "passed", durationMs: 800 },
    { id: "npm-test", name: "npm test", status: "failed" }
  ]
});

assert.deepEqual(evidence.changedFiles.map((file) => file.path), ["ios/PhoneDexApp/ContentView.swift"]);
assert.equal(evidence.changedFiles[0].sourceRef, "ios/PhoneDexApp/ContentView.swift#L10-L30");
assert.deepEqual(evidence.artifacts.map((artifact) => artifact.id), ["build-log"]);
assert.equal(evidence.validations.length, 1);
assert.equal(evidence.validations[0].status, "passed");
assert.equal(evidenceSummary(evidence), "1 changed file, 1 artifact, 1 validation receipt");

const merged = mergeTaskEvidence(
  { changedFiles: [{ path: "README.md", status: "modified" }] },
  { validations: [{ id: "ios-test", name: "iOS tests", status: "passed" }] }
);
assert.deepEqual(merged.changedFiles.map((file) => file.path), ["README.md"]);
assert.equal(merged.validations[0].name, "iOS tests");
assert.equal(normalizeTaskEvidence({}), undefined);

console.log("PhoneDex evidence normalization test passed");
