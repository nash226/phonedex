#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const bridge = path.join(root, "bin", "codex-watch.js");

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-enroll-"));
}

function writeDevices(dataDir) {
  fs.writeFileSync(
    path.join(dataDir, "devices.json"),
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        devices: [
          {
            deviceId: "imac",
            machineName: "iMac",
            lastSeenAt: new Date().toISOString()
          }
        ]
      },
      null,
      2
    )
  );
}

function runEnroll(args) {
  const dataDir = makeDataDir();
  writeDevices(dataDir);
  const result = spawnSync(
    process.execPath,
    [bridge, "enroll-agent", "--json", ...args],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        WATCH_BRIDGE_DATA_DIR: dataDir,
        WATCH_BRIDGE_PUBLIC_URL: "http://hub.local:8765",
        WATCH_BRIDGE_TOKEN: "hub-token",
        PHONEDEX_EXPECTED_DEVICES: "imac:iMac",
        WATCH_BRIDGE_PROVIDER: "pushcut",
        PUSHCUT_WEBHOOK_URL: ""
      }
    }
  );

  assert.equal(result.stderr, "");
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

{
  const enrollment = runEnroll([
    "--device-id",
    "macbook-air",
    "--name",
    "MacBook Air",
    "--platform",
    "macos",
    "--callback-url",
    "http://macbook.local:8765",
    "--agent-token",
    "agent-token"
  ]);

  assert.equal(enrollment.platform, "macos");
  assert.equal(enrollment.env.PHONEDEX_HUB_URL, "http://hub.local:8765");
  assert.equal(enrollment.env.PHONEDEX_HUB_TOKEN, "hub-token");
  assert.equal(enrollment.env.WATCH_BRIDGE_TOKEN, "agent-token");
  assert.equal(enrollment.env.WATCH_BRIDGE_PUBLIC_URL, "http://macbook.local:8765");
  assert.equal(enrollment.commands.includes("npm run services:install"), true);
  assert.equal(
    enrollment.hubExpectedDevices,
    "imac:iMac,macbook-air:MacBook Air"
  );
}

{
  const enrollment = runEnroll([
    "--device-id",
    "windows-desktop",
    "--name",
    "Windows Desktop",
    "--platform",
    "windows",
    "--agent-token",
    "agent-token"
  ]);

  assert.equal(enrollment.platform, "windows");
  assert.equal(enrollment.env.WATCH_BRIDGE_PUBLIC_URL, "http://THIS_AGENT_LAN_IP:8765");
  assert.equal(enrollment.commands.includes("npm run windows:install"), true);
  assert.equal(
    enrollment.hubExpectedDevices,
    "imac:iMac,windows-desktop:Windows Desktop"
  );
}

console.log("agent enrollment fixture test passed");
