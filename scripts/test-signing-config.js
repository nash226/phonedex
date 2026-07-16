#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const project = fs.readFileSync(path.join(root, "ios/PhoneDex.xcodeproj/project.pbxproj"), "utf8");
const projectSpec = fs.readFileSync(path.join(root, "ios/project.yml"), "utf8");

const entitlements = [
  "ios/PhoneDexApp/PhoneDex.entitlements",
  "ios/PhoneDexNotificationExtension/PhoneDexNotificationExtension.entitlements"
];

for (const relativePath of entitlements) {
  const contents = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.match(contents, /<dict\s*\/>/, `${relativePath} must declare no capabilities until a supported release feature needs one`);
  assert.doesNotMatch(contents, /aps-environment|application-groups|keychain-access-groups/, `${relativePath} must not imply an unimplemented service`);
  const specPath = relativePath.replace(/^ios\//, "").replaceAll("/", "\\/");
  assert.match(projectSpec, new RegExp(`CODE_SIGN_ENTITLEMENTS:\\s*${specPath}`));
  assert.match(project, new RegExp(`CODE_SIGN_ENTITLEMENTS = ${specPath};`));
}

assert.ok((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.nash226\.PhoneDex;/g) || []).length >= 2, "app Debug and Release targets must remain present");
assert.ok((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.nash226\.PhoneDex\.NotificationExtension;/g) || []).length >= 2, "extension Debug and Release targets must remain present");
assert.match(projectSpec, /DEVELOPMENT_TEAM:\s*RQRRLJ37K2/);
assert.match(project, /DEVELOPMENT_TEAM = RQRRLJ37K2;/);
assert.equal(JSON.stringify({ project, projectSpec }).includes("PROVISIONING_PROFILE_SPECIFIER"), false);

console.log("reproducible signing metadata and entitlement boundary passed");
