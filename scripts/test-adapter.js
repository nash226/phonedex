#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  adapterModePolicy,
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
assert.equal(macCli.experimental, false);
assert.equal(supportsAdapterCapability(macCli, "task.reply"), true);
assert.equal(supportsAdapterCapability(macCli, "desktop.handoff"), true);
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

const macAppServer = createCodexAdapter({
  platform: "darwin",
  mode: "app-server",
  appServerBin: "/usr/local/bin/codex",
  workspaceRoots: ["/Users/example/Projects"]
});
assert.equal(macAppServer.state, "ready");
assert.equal(supportsAdapterCapability(macAppServer, "task.reply"), true);
assert.equal(supportsAdapterCapability(macAppServer, "task.create"), true);
assert.equal(supportsAdapterCapability(macAppServer, "desktop.handoff"), true);
assert.equal(macAppServer.experimental, false);
assertAdapterDescriptor(macAppServer);

const macForeground = createCodexAdapter({
  platform: "macos",
  mode: "foreground",
  workspaceRoots: ["/Users/example/Projects"]
});
assert.equal(macForeground.state, "unavailable");
assert.equal(supportsAdapterCapability(macForeground, "task.reply"), false);
assert.match(macForeground.limitations.join(" "), /disabled.*PHONEDEX_ENABLE_EXPERIMENTAL_FOREGROUND=true/i);
assertAdapterDescriptor(macForeground);

const optedInMacForeground = createCodexAdapter({
  platform: "macos",
  mode: "foreground",
  allowExperimentalForeground: true,
  workspaceRoots: ["/Users/example/Projects"]
});
assert.equal(optedInMacForeground.state, "ready");
assert.equal(optedInMacForeground.experimental, true);
assert.equal(supportsAdapterCapability(optedInMacForeground, "task.reply"), true);
assert.equal(supportsAdapterCapability(optedInMacForeground, "task.create"), false);
assert.equal(supportsAdapterCapability(optedInMacForeground, "task.cancel"), false);
assert.equal(supportsAdapterCapability(optedInMacForeground, "task.retry"), false);
assert.equal(supportsAdapterCapability(optedInMacForeground, "desktop.handoff"), false);
assert.match(optedInMacForeground.limitations.join(" "), /experimental.*cannot manage task lifecycle/i);
assert.doesNotMatch(optedInMacForeground.limitations.join(" "), /Configure PHONEDEX_WORKSPACE_ROOTS/);
assertAdapterDescriptor(optedInMacForeground);

const macCliWithoutExecutable = createCodexAdapter({
  platform: "macos",
  mode: "cli",
  workspaceRoots: ["/Users/example/Projects"]
});
assert.equal(macCliWithoutExecutable.state, "unavailable");
assert.equal(supportsAdapterCapability(macCliWithoutExecutable, "task.reply"), false);
assert.equal(supportsAdapterCapability(macCliWithoutExecutable, "task.create"), false);

assert.deepEqual(adapterModePolicy("darwin"), adapterModePolicy("cli"));
assert.equal(adapterModePolicy("foreground").supportsLifecycle, false);

const windowsAppServer = createCodexAdapter({
  platform: "win32",
  mode: "app-server",
  appServerBin: "codex.exe"
});
assert.equal(windowsAppServer.platform, "windows");
assert.equal(windowsAppServer.state, "ready");
assert.equal(supportsAdapterCapability(windowsAppServer, "task.reply"), true);
assert.equal(supportsAdapterCapability(windowsAppServer, "desktop.handoff"), true);

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
