const assert = require("assert");
const fs = require("fs");
const path = require("path");

const manifestPath = path.join(__dirname, "..", "ios", "PhoneDexApp", "PrivacyInfo.xcprivacy");
const projectPath = path.join(__dirname, "..", "ios", "project.yml");
const manifest = fs.readFileSync(manifestPath, "utf8");
const project = fs.readFileSync(projectPath, "utf8");

assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
assert.match(manifest, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
assert.match(manifest, /NSPrivacyAccessedAPICategoryUserDefaults/);
assert.match(manifest, /<string>CA92\.1<\/string>/);
assert.match(project, /resources:\s*\n\s+- PhoneDexApp\/PrivacyInfo\.xcprivacy/);
console.log("iOS privacy manifest fixture passed");
