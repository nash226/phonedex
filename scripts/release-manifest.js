#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8").trim();
const fail = (message) => {
  console.error(`release manifest: ${message}`);
  process.exitCode = 1;
};

const version = read("VERSION");
const build = read("BUILD_NUMBER");
const packageJson = JSON.parse(read("package.json"));
const project = read("ios/project.yml");
const appInfo = read("ios/PhoneDexApp/Info.plist");
const extensionInfo = read("ios/PhoneDexNotificationExtension/Info.plist");
const projectFile = read("ios/PhoneDex.xcodeproj/project.pbxproj");
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!semver.test(version)) fail(`VERSION must contain a semantic version, got ${JSON.stringify(version)}`);
if (!/^\d+$/.test(build) || Number(build) < 1) fail(`BUILD_NUMBER must be a positive integer, got ${JSON.stringify(build)}`);
if (packageJson.version !== version) fail(`package.json version ${packageJson.version} does not match VERSION ${version}`);
if (!/MARKETING_VERSION:\s*\d+\.\d+\.\d+/.test(project)) fail("ios/project.yml must declare a semantic MARKETING_VERSION");
if (!new RegExp(`CURRENT_PROJECT_VERSION:\\s*${build}\\b`).test(project)) fail("ios/project.yml build number is out of sync with BUILD_NUMBER");
if (!appInfo.includes("<string>$(MARKETING_VERSION)</string>") || !appInfo.includes("<string>$(CURRENT_PROJECT_VERSION)</string>")) {
  fail("PhoneDex app Info.plist must consume the Xcode version settings");
}
if (!extensionInfo.includes("<string>$(MARKETING_VERSION)</string>") || !extensionInfo.includes("<string>$(CURRENT_PROJECT_VERSION)</string>")) {
  fail("notification extension Info.plist must consume the Xcode version settings");
}
if (!new RegExp(`MARKETING_VERSION = ${version.replaceAll(".", "\\.")};`).test(projectFile) || !new RegExp(`CURRENT_PROJECT_VERSION = ${build};`).test(projectFile)) {
  fail("generated Xcode project is out of sync with ios/project.yml; run npm run ios:generate");
}

let revision = "unknown";
let dirty = false;
try {
  revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  dirty = Boolean(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim());
} catch {
  // Source archives and exported build directories can be verified without git.
}

const manifest = {
  schema: "phonedex.release.v1",
  version,
  build,
  sourceRevision: revision,
  sourceDirty: dirty,
  bridge: { package: packageJson.name, version },
  ios: { marketingVersion: version, deploymentTarget: "17.0", signing: "release-owner" },
  protocol: { version: 1 },
  supportedNode: ["18.x", "22.x"],
  generatedProject: "ios/PhoneDex.xcodeproj",
};

if (process.exitCode) process.exit();
console.log(JSON.stringify(manifest, null, 2));
