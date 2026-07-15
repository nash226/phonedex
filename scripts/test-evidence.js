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
      summary: "Updated evidence view",
      patch: "@@ -10,2 +10,3 @@\r\n-old line\r\n+new line\0\r\n"
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
      sha256: "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789"
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
assert.equal(evidence.changedFiles[0].patch, "@@ -10,2 +10,3 @@\n-old line\n+new line\n");
assert.equal(evidence.changedFiles[0].patchTruncated, undefined);
assert.deepEqual(evidence.artifacts.map((artifact) => artifact.id), ["build-log"]);
assert.equal(evidence.artifacts[0].sha256, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
assert.equal(evidence.validations.length, 1);
assert.equal(evidence.validations[0].status, "passed");
assert.equal(evidenceSummary(evidence), "1 changed file, 1 artifact, 1 validation receipt");

const merged = mergeTaskEvidence(
  { changedFiles: [{ path: "README.md", status: "modified" }] },
  {
    changedFiles: [{ path: "README.md", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new\n" }],
    validations: [{ id: "ios-test", name: "iOS tests", status: "passed" }]
  }
);
assert.deepEqual(merged.changedFiles.map((file) => file.path), ["README.md"]);
assert.equal(merged.changedFiles[0].patch.includes("+new"), true);
assert.equal(merged.validations[0].name, "iOS tests");
assert.equal(normalizeTaskEvidence({}), undefined);

const largePatch = normalizeTaskEvidence({
  changedFiles: [{ path: "large.txt", status: "modified", patch: "x".repeat(600005) }]
});
assert.equal(largePatch.changedFiles[0].patch.length, 600000);
assert.equal(largePatch.changedFiles[0].patchTruncated, true);

console.log("PhoneDex evidence normalization test passed");
