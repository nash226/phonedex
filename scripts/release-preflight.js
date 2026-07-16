#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function runPreflight() {
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, status: passed ? "pass" : "fail", detail });
  const blockers = [
    { id: "signing", issue: 132, detail: "Apple signing, entitlements, and TestFlight credentials require release-owner configuration." },
    { id: "privacy-policy", issue: 125, detail: "Final privacy policy and App Store disclosures require release-owner/legal review." },
    { id: "apns", issue: 138, detail: "APNs provider and privacy operating model remain a human decision." },
    { id: "real-device-matrix", issue: null, detail: "Real-device iOS, macOS, and Windows validation cannot be proven by repository checks." }
  ];

  const version = read("VERSION").trim();
  const build = read("BUILD_NUMBER").trim();
  const packageJson = JSON.parse(read("package.json"));
  const projectFile = read("ios/PhoneDex.xcodeproj/project.pbxproj");
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

  check("version", semver.test(version) && packageJson.version === version, `VERSION and package.json agree on semantic version ${version}`);
  check("build-number", /^\d+$/.test(build) && Number(build) > 0, "BUILD_NUMBER is a positive integer");
  const escapedVersion = version.split(".").join("\\.");
  check("generated-project", new RegExp(`MARKETING_VERSION = ${escapedVersion};`).test(projectFile) && new RegExp(`CURRENT_PROJECT_VERSION = ${build};`).test(projectFile), "Generated Xcode project matches VERSION and BUILD_NUMBER");
  check("privacy-manifest", fs.existsSync(path.join(root, "ios/PhoneDexApp/PrivacyInfo.xcprivacy")), "Implementation-based iOS privacy manifest is present");
  check("release-docs", ["docs/RELEASE.md", "docs/APP_REVIEW.md", "docs/SUPPORT.md", "docs/RECOVERY.md"].every((file) => fs.existsSync(path.join(root, file))), "Release, review, support, and recovery runbooks are present");
  check("ci-coverage", read(".github/workflows/node-ci.yml").includes("npm test") && read(".github/workflows/ios-ci.yml").includes("test"), "Node and unsigned iOS build/test workflows are present");
  check("secret-free-manifest", read("scripts/release-manifest.js").includes('schema: "phonedex.release.v1"') && read("scripts/test-release-manifest.js").includes("sourceRevision"), "Release provenance is content-free and revision-addressable");

  return {
    schema: "phonedex.release-preflight.v1",
    generatedAt: new Date().toISOString(),
    version,
    build,
    checks,
    blockers,
    status: checks.every((item) => item.status === "pass") && blockers.length === 0 ? "ready" : "blocked"
  };
}

if (require.main === module) {
  const result = runPreflight();
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes("--strict") && (result.status !== "ready" || result.checks.some((item) => item.status !== "pass"))) process.exitCode = 1;
}

module.exports = { runPreflight };
