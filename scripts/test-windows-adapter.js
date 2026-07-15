#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  assertAdapterDescriptor,
  createCodexAdapter,
  supportsAdapterCapability
} = require("../lib/phonedex-adapter");

const windowsPlatforms = ["win32", "windows"];
const windowsModes = ["cli", "app-server"];
const managedWorkspaceRoots = ["C:\\Users\\codex\\Projects", "D:\\Workspaces\\PhoneDex"];

for (const platform of windowsPlatforms) {
  for (const mode of windowsModes) {
    const executableOptions = mode === "app-server"
      ? { appServerBin: "codex.exe" }
      : { codexBin: "C:\\Program Files\\Codex\\codex.exe" };

    const unscoped = createCodexAdapter({
      platform,
      mode,
      ...executableOptions
    });
    assert.equal(unscoped.platform, "windows");
    assert.equal(unscoped.state, "ready");
    assert.equal(unscoped.experimental, false);
    assert.equal(supportsAdapterCapability(unscoped, "task.reply"), true);
    assert.equal(supportsAdapterCapability(unscoped, "desktop.handoff"), true);
    assert.equal(supportsAdapterCapability(unscoped, "task.create"), false);
    assert.match(unscoped.limitations.join(" "), /PHONEDEX_WORKSPACE_ROOTS/i);
    assert.match(unscoped.limitations.join(" "), /supported Codex CLI or app-server contract/i);
    assertAdapterDescriptor(unscoped);

    const managed = createCodexAdapter({
      platform,
      mode,
      workspaceRoots: managedWorkspaceRoots,
      ...executableOptions
    });
    assert.equal(managed.state, "ready");
    assert.equal(supportsAdapterCapability(managed, "task.reply"), true);
    assert.equal(supportsAdapterCapability(managed, "task.create"), true);
    assert.equal(supportsAdapterCapability(managed, "task.cancel"), true);
    assert.equal(supportsAdapterCapability(managed, "task.retry"), true);
    assert.equal(supportsAdapterCapability(managed, "desktop.handoff"), true);
    assert.doesNotMatch(managed.limitations.join(" "), /Configure PHONEDEX_WORKSPACE_ROOTS/i);
    assertAdapterDescriptor(managed);

    const missingExecutable = createCodexAdapter({
      platform,
      mode,
      workspaceRoots: managedWorkspaceRoots
    });
    assert.equal(missingExecutable.state, "unavailable");
    assert.equal(supportsAdapterCapability(missingExecutable, "task.reply"), false);
    assert.equal(supportsAdapterCapability(missingExecutable, "task.create"), false);
    assert.match(missingExecutable.limitations.join(" "), /CODEX_(?:APP_SERVER_)?BIN/i);
    assertAdapterDescriptor(missingExecutable);
  }

  const foreground = createCodexAdapter({
    platform,
    mode: "foreground",
    codexBin: "codex.exe",
    workspaceRoots: managedWorkspaceRoots
  });
  assert.equal(foreground.state, "unavailable");
  assert.equal(foreground.experimental, true);
  assert.equal(supportsAdapterCapability(foreground, "task.reply"), false);
  assert.equal(supportsAdapterCapability(foreground, "desktop.handoff"), false);
  assert.match(foreground.limitations.join(" "), /macOS/i);
  assertAdapterDescriptor(foreground);
}

const unknownPlatform = createCodexAdapter({
  platform: "linux",
  mode: "cli",
  codexBin: "codex"
});
assert.equal(unknownPlatform.state, "unavailable");
assert.equal(unknownPlatform.capabilities.every((capability) => !capability.supported), true);

if (process.platform === "win32") {
  const script = path.join(__dirname, "install-windows-task.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", "status"],
    { encoding: "utf8" }
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PhoneDex scheduled task|TaskName/i);
}

console.log(`Windows adapter matrix fixture passed (${process.platform})`);
