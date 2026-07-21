#!/usr/bin/env node

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts/release-signing-preflight.js");
const report = JSON.parse(execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" }));

assert.equal(report.schema, "phonedex.signing-preflight.v1");
assert.equal(report.status, "ready-for-release-owner-signing");
assert.equal(report.app.bundleIdentifier, "com.nash226.PhoneDex");
assert.equal(report.app.notificationExtensionBundleIdentifier, "com.nash226.PhoneDex.NotificationExtension");
assert.equal(report.app.developmentTeamConfigured, true);
assert.equal(report.entitlements.committedProvisioningProfile, false);
assert.equal(report.entitlements.committedEntitlementsFile, false);
assert.equal(report.entitlements.apnsEnvironment, "release-owner-decision");
assert.equal(report.signing, "release-owner-credentials-required");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-signing-preflight-"));
fs.cpSync(root, fixtureRoot, { recursive: true });
const fixtureProject = path.join(fixtureRoot, "ios/project.yml");
fs.writeFileSync(fixtureProject, fs.readFileSync(fixtureProject, "utf8").replace("PRODUCT_BUNDLE_IDENTIFIER: com.nash226.PhoneDex", "PRODUCT_BUNDLE_IDENTIFIER: com.example.Drift"));
assert.throws(
  () => execFileSync(process.execPath, [path.join(fixtureRoot, "scripts/release-signing-preflight.js")], { cwd: fixtureRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  (error) => error.status === 1,
  "bundle-identifier drift must fail closed",
);
fs.rmSync(fixtureRoot, { recursive: true, force: true });
console.log("release signing preflight fixture passed");
