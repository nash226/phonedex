#!/usr/bin/env node

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = execFileSync(process.execPath, [path.join(__dirname, "release-manifest.js")], { cwd: root, encoding: "utf8" });
const manifest = JSON.parse(output);

assert.equal(manifest.schema, "phonedex.release.v1");
assert.equal(manifest.version, "0.1.0");
assert.equal(manifest.build, "1");
assert.match(manifest.sourceRevision, /^[0-9a-f]{40}$/);
assert.deepEqual(manifest.bridge, { package: "phonedex", version: "0.1.0" });
assert.deepEqual(manifest.ios, { marketingVersion: "0.1.0", deploymentTarget: "17.0", signing: "release-owner" });
assert.deepEqual(manifest.supportedNode, ["18.x", "22.x"]);
assert.equal(JSON.stringify(manifest).includes("token"), false);
assert.equal(JSON.stringify(manifest).includes("workspace"), false);
console.log("release manifest fixture passed");
