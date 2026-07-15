#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  assertAdapterDescriptor,
  createCodexAdapter,
  supportsAdapterCapability
} = require("../lib/phonedex-adapter");

const macCli = createCodexAdapter({
  platform: "macos",
  mode: "cli",
  codexBin: "/usr/local/bin/codex"
});
assert.equal(macCli.state, "ready");
assert.equal(macCli.id, "codex.cli");
assert.equal(supportsAdapterCapability(macCli, "task.reply"), true);
assert.equal(supportsAdapterCapability(macCli, "task.cancel"), false);
assert.equal(macCli.capabilities.every((capability) => capability.schema === "phonedex.capability.v1"), true);
assert.match(macCli.limitations.join(" "), /does not automate private desktop UI/i);
assertAdapterDescriptor(macCli);

const managedMac = createCodexAdapter({
  platform: "macos",
  mode: "cli",
  codexBin: "/usr/local/bin/codex",
  workspaceRoots: ["/Users/example/Projects"]
});
assert.equal(supportsAdapterCapability(managedMac, "task.create"), true);
assert.equal(supportsAdapterCapability(managedMac, "task.cancel"), true);
assert.equal(supportsAdapterCapability(managedMac, "task.retry"), true);

const windowsAppServer = createCodexAdapter({
  platform: "win32",
  mode: "app-server",
  appServerBin: "codex.exe"
});
assert.equal(windowsAppServer.platform, "windows");
assert.equal(windowsAppServer.state, "ready");
assert.equal(supportsAdapterCapability(windowsAppServer, "task.reply"), true);
assert.equal(windowsAppServer.capabilities.some((capability) => capability.id === "desktop.handoff" && capability.supported), false);

const windowsForeground = createCodexAdapter({
  platform: "windows",
  mode: "foreground",
  codexBin: "codex.exe"
});
assert.equal(windowsForeground.state, "unavailable");
assert.equal(supportsAdapterCapability(windowsForeground, "task.reply"), false);
assert.match(windowsForeground.limitations.join(" "), /macOS/i);

const unknownPlatform = createCodexAdapter({ platform: "linux", mode: "cli", codexBin: "codex" });
assert.equal(unknownPlatform.state, "unavailable");
assert.equal(unknownPlatform.capabilities.every((capability) => !capability.supported), true);

assert.throws(
  () => assertAdapterDescriptor({ ...macCli, state: "broken" }),
  /state is invalid/
);

console.log("adapter contract fixture passed");
