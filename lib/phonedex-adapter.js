"use strict";

const { protocolRecord } = require("./phonedex-protocol");

const ADAPTER_SCHEMA = "phonedex.adapter.v1";
const ADAPTER_VERSION = "1";
const SUPPORTED_PLATFORMS = Object.freeze(["macos", "windows"]);
const SUPPORTED_MODES = Object.freeze(["cli", "app-server", "foreground"]);

const ADAPTER_MODE_POLICIES = Object.freeze({
  cli: Object.freeze({ experimental: false, supportsLifecycle: true, supportsHandoff: true }),
  "app-server": Object.freeze({ experimental: false, supportsLifecycle: true, supportsHandoff: true }),
  foreground: Object.freeze({ experimental: true, supportsLifecycle: false, supportsHandoff: false })
});

const ADAPTER_CAPABILITIES = Object.freeze([
  { id: "task.reply", version: "1", scope: "task" },
  { id: "task.create", version: "1", scope: "task" },
  { id: "task.cancel", version: "1", scope: "task" },
  { id: "task.retry", version: "1", scope: "task" },
  { id: "approval.respond", version: "1", scope: "task" },
  { id: "desktop.handoff", version: "1", scope: "task" }
]);

function createCodexAdapter({
  platform = process.platform,
  mode = "cli",
  codexBin = "",
  appServerBin = "",
  workspaceRoots = []
} = {}) {
  const normalizedPlatform = normalizeAdapterPlatform(platform);
  const normalizedMode = normalizeAdapterMode(mode);
  const executable = normalizedMode === "app-server" ? appServerBin : codexBin;
  const platformSupported = SUPPORTED_PLATFORMS.includes(normalizedPlatform);
  const modeSupported = normalizedMode !== "foreground" || normalizedPlatform === "macos";
  const executableConfigured = normalizedMode === "foreground" || nonEmptyString(executable);
  const ready = platformSupported && modeSupported && executableConfigured;
  const policy = ADAPTER_MODE_POLICIES[normalizedMode];
  const lifecycleSupported = ready && policy.supportsLifecycle && Array.isArray(workspaceRoots) && workspaceRoots.length > 0;
  const limitations = [];

  if (!platformSupported) {
    limitations.push("No supported Codex adapter is registered for this platform.");
  }
  if (!modeSupported) {
    limitations.push("Foreground desktop handoff is supported only on macOS and remains experimental.");
  }
  if (!executableConfigured) {
    limitations.push("Configure CODEX_BIN or CODEX_APP_SERVER_BIN before enabling continuation.");
  }
  if (ready && policy.supportsLifecycle && !lifecycleSupported) {
    limitations.push("Configure PHONEDEX_WORKSPACE_ROOTS before enabling managed task controls.");
  }
  if (normalizedMode !== "foreground") {
    limitations.push("The adapter uses the supported Codex CLI or app-server contract; it does not automate private desktop UI.");
  } else {
    limitations.push("Foreground paste is an experimental macOS fallback and cannot manage task lifecycle.");
  }
  if (!policy.supportsLifecycle) {
    limitations.push("Managed task controls are unavailable in the experimental foreground fallback.");
  } else if (!lifecycleSupported) {
    limitations.push("Task creation, cancellation, and retry are unavailable for unmanaged or unallowlisted workspaces.");
  } else {
    limitations.push("Lifecycle controls apply only to tasks started and tracked by PhoneDex in an allowlisted workspace.");
  }

  const capabilities = ADAPTER_CAPABILITIES.map((definition) => protocolRecord("capability", {
    ...definition,
    supported: definition.id === "task.reply"
      ? ready
      : definition.id === "desktop.handoff"
        ? ready && policy.supportsHandoff
        : lifecycleSupported && ["task.create", "task.cancel", "task.retry"].includes(definition.id)
  }));

  return Object.freeze({
    schema: ADAPTER_SCHEMA,
    protocolVersion: 1,
    id: `codex.${normalizedMode}`,
    version: ADAPTER_VERSION,
    platform: normalizedPlatform,
    mode: normalizedMode,
    experimental: policy.experimental,
    state: ready ? "ready" : "unavailable",
    capabilities: Object.freeze(capabilities),
    limitations: Object.freeze(limitations)
  });
}

function normalizeAdapterPlatform(value) {
  if (value === "darwin") return "macos";
  if (value === "win32") return "windows";
  return SUPPORTED_PLATFORMS.includes(value) ? value : "unknown";
}

function normalizeAdapterMode(value) {
  return SUPPORTED_MODES.includes(value) ? value : "cli";
}

function supportsAdapterCapability(adapter, capabilityId) {
  return Boolean(
    adapter &&
      adapter.state === "ready" &&
      Array.isArray(adapter.capabilities) &&
      adapter.capabilities.some((capability) => capability.id === capabilityId && capability.supported)
  );
}

function adapterModePolicy(mode) {
  return ADAPTER_MODE_POLICIES[normalizeAdapterMode(mode)];
}

function assertAdapterDescriptor(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error("PhoneDex adapter descriptor must be an object");
  }
  if (adapter.schema !== ADAPTER_SCHEMA || adapter.protocolVersion !== 1) {
    throw new Error("PhoneDex adapter descriptor has an unsupported schema");
  }
  if (typeof adapter.id !== "string" || adapter.id.length === 0 || adapter.id.length > 160) {
    throw new Error("PhoneDex adapter descriptor id is invalid");
  }
  if (!SUPPORTED_PLATFORMS.includes(adapter.platform) && adapter.platform !== "unknown") {
    throw new Error("PhoneDex adapter descriptor platform is invalid");
  }
  if (!SUPPORTED_MODES.includes(adapter.mode)) {
    throw new Error("PhoneDex adapter descriptor mode is invalid");
  }
  const policy = ADAPTER_MODE_POLICIES[adapter.mode];
  if (!["ready", "unavailable"].includes(adapter.state)) {
    throw new Error("PhoneDex adapter descriptor state is invalid");
  }
  if (adapter.mode === "foreground" && adapter.state === "ready" && adapter.platform !== "macos") {
    throw new Error("Ready foreground adapter descriptors are supported only on macOS");
  }
  if (typeof adapter.experimental !== "boolean") {
    throw new Error("PhoneDex adapter descriptor experimental flag is invalid");
  }
  if (adapter.experimental !== policy.experimental) {
    throw new Error("PhoneDex adapter descriptor experimental flag does not match its mode");
  }
  if (!Array.isArray(adapter.capabilities) || !Array.isArray(adapter.limitations)) {
    throw new Error("PhoneDex adapter descriptor capabilities and limitations must be arrays");
  }
  for (const capability of adapter.capabilities) {
    if (!capability || capability.schema !== "phonedex.capability.v1" || capability.protocolVersion !== 1) {
      throw new Error("PhoneDex adapter descriptor contains an invalid capability");
    }
  }
  if (adapter.mode === "foreground") {
    const restrictedCapabilities = new Set(["task.create", "task.cancel", "task.retry", "desktop.handoff"]);
    if (adapter.capabilities.some((capability) => restrictedCapabilities.has(capability.id) && capability.supported)) {
      throw new Error("Foreground adapter descriptors cannot advertise lifecycle or handoff capabilities");
    }
  }
  for (const limitation of adapter.limitations) {
    if (typeof limitation !== "string" || limitation.length > 240) {
      throw new Error("PhoneDex adapter descriptor contains an invalid limitation");
    }
  }
  return adapter;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  ADAPTER_SCHEMA,
  ADAPTER_VERSION,
  ADAPTER_MODE_POLICIES,
  SUPPORTED_MODES,
  SUPPORTED_PLATFORMS,
  adapterModePolicy,
  assertAdapterDescriptor,
  createCodexAdapter,
  normalizeAdapterMode,
  normalizeAdapterPlatform,
  supportsAdapterCapability
};
