#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const fail = (message) => {
  console.error(`release signing preflight: ${message}`);
  process.exitCode = 1;
};

const project = read("ios/project.yml");
const generatedProject = read("ios/PhoneDex.xcodeproj/project.pbxproj");
const appInfo = read("ios/PhoneDexApp/Info.plist");
const extensionInfo = read("ios/PhoneDexNotificationExtension/Info.plist");

const value = (text, key) => {
  const match = text.match(new RegExp(`^\\s+${key}:\\s+([^\\s#]+)`, "m"));
  return match?.[1];
};
const generatedValue = (text, key, bundleId) => {
  const target = text.match(new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleId.replaceAll(".", "\\.")};[\\s\\S]{0,1800}?`));
  if (!target) return undefined;
  const match = target[0].match(new RegExp(`\\b${key} = ([^;]+);`));
  return match?.[1]?.trim();
};
const assertEqual = (name, actual, expected) => {
  if (actual !== expected) fail(`${name} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const assertIncludes = (name, text, fragment) => {
  if (!text.includes(fragment)) fail(`${name} is missing ${JSON.stringify(fragment)}`);
};

const appBundleId = value(project, "PRODUCT_BUNDLE_IDENTIFIER");
const extensionBundleId = project.match(/PRODUCT_BUNDLE_IDENTIFIER:\s*(com\.nash226\.PhoneDex\.NotificationExtension)/)?.[1];
const appTeam = project.match(/PhoneDex:\s*[\s\S]*?DEVELOPMENT_TEAM:\s*([^\s]+)/)?.[1];
const extensionTeam = project.match(/PhoneDexNotificationExtension:[\s\S]*?DEVELOPMENT_TEAM:\s*([^\s]+)/)?.[1];

assertEqual("PhoneDex bundle identifier", appBundleId, "com.nash226.PhoneDex");
assertEqual("notification extension bundle identifier", extensionBundleId, "com.nash226.PhoneDex.NotificationExtension");
assertEqual("PhoneDex development team", appTeam, "RQRRLJ37K2");
assertEqual("notification extension development team", extensionTeam, appTeam);
if (!extensionBundleId.startsWith(`${appBundleId}.`)) fail("notification extension bundle identifier must be namespaced under the app");

assertIncludes("generated app target", generatedProject, `PRODUCT_BUNDLE_IDENTIFIER = ${appBundleId};`);
assertIncludes("generated notification target", generatedProject, `PRODUCT_BUNDLE_IDENTIFIER = ${extensionBundleId};`);
assertIncludes("generated app team", generatedProject, `DEVELOPMENT_TEAM = ${appTeam};`);
if (generatedProject.includes("PROVISIONING_PROFILE") || generatedProject.includes("CODE_SIGN_ENTITLEMENTS")) {
  fail("generated project must not commit provisioning profiles or entitlements paths");
}
if (appInfo.includes("aps-environment") || extensionInfo.includes("aps-environment")) {
  fail("APNs entitlement cannot be committed before the provider and privacy decision");
}
assertIncludes("notification extension target", extensionInfo, "com.apple.usernotifications.content-extension");

const report = {
  schema: "phonedex.signing-preflight.v1",
  status: "ready-for-release-owner-signing",
  app: {
    bundleIdentifier: appBundleId,
    notificationExtensionBundleIdentifier: extensionBundleId,
    developmentTeamConfigured: Boolean(appTeam),
  },
  entitlements: {
    committedProvisioningProfile: false,
    committedEntitlementsFile: false,
    apnsEnvironment: "release-owner-decision",
  },
  signing: "release-owner-credentials-required",
};

if (process.exitCode) process.exit();
console.log(JSON.stringify(report, null, 2));
