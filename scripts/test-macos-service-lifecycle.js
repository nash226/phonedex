#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (process.platform !== "darwin") {
  console.log("macOS service lifecycle fixture skipped outside macOS.");
  process.exit(0);
}

const script = path.join(__dirname, "install-launch-agents.sh");
const launchAgentsHome = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-macos-service-"));
const label = "com.nash226.watchdex.bridge";
const plist = path.join(launchAgentsHome, "Library", "LaunchAgents", `${label}.plist`);
const guiDomain = `gui/${process.getuid()}`;
const env = { ...process.env, HOME: launchAgentsHome };

function run(action) {
  const result = spawnSync("bash", [script, action], { encoding: "utf8", env });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return `${result.stdout}\n${result.stderr}`;
}

function launchctlPrint() {
  return spawnSync("launchctl", ["print", `${guiDomain}/${label}`], {
    encoding: "utf8",
    env
  });
}

let loaded = false;
try {
  assert.match(run("install"), /Wrote .*com\.nash226\.watchdex\.bridge\.plist/);
  assert.equal(fs.existsSync(plist), true, "install should write the LaunchAgent plist");
  assert.equal(launchctlPrint().status, 0, "install should load the LaunchAgent");
  loaded = true;

  run("start");
  assert.equal(launchctlPrint().status, 0, "start should keep the LaunchAgent loaded");

  run("status");
  run("stop");
  assert.notEqual(launchctlPrint().status, 0, "stop should unload the LaunchAgent");
  loaded = false;
} finally {
  if (loaded) spawnSync("bash", [script, "stop"], { encoding: "utf8", env });
  fs.rmSync(launchAgentsHome, { recursive: true, force: true });
}

console.log("macOS service lifecycle fixture passed.");
