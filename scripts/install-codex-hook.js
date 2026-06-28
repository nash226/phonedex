#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const hookCommand = path.join(repoRoot, "bin", "codex-watch.js") + " hook";
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const hooksPath = path.join(codexHome, "hooks.json");

const hookDefinition = {
  type: "command",
  command: hookCommand,
  timeout: 20,
  statusMessage: "Sending Codex Watch alert"
};

fs.mkdirSync(codexHome, { recursive: true });

const hooksConfig = readHooksConfig(hooksPath);
hooksConfig.hooks ||= {};
hooksConfig.hooks.Stop ||= [];

const group = findOrCreateBridgeGroup(hooksConfig.hooks.Stop);
group.hooks = group.hooks.filter((hook) => hook.command !== hookCommand);
group.hooks.push(hookDefinition);

fs.writeFileSync(hooksPath, `${JSON.stringify(hooksConfig, null, 2)}\n`);

console.log(`Installed Codex Watch Bridge Stop hook in ${hooksPath}`);
console.log("Open /hooks in Codex and trust the hook before relying on it.");

function readHooksConfig(filePath) {
  if (!fs.existsSync(filePath)) {
    return { hooks: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${error.message}`);
  }
}

function findOrCreateBridgeGroup(stopGroups) {
  const existing = stopGroups.find((group) =>
    Array.isArray(group.hooks) &&
    group.hooks.some((hook) => hook.command === hookCommand)
  );

  if (existing) return existing;

  const group = { hooks: [] };
  stopGroups.push(group);
  return group;
}
