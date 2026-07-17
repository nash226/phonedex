#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");

const script = path.join(__dirname, "install-windows-task.ps1");
const scriptSource = fs.readFileSync(script, "utf8");
assert.match(scriptSource, /-StartWhenAvailable\b/);
assert.match(scriptSource, /-RestartCount\s+\$RestartCount\b/);
assert.match(scriptSource, /\$RestartCount\s*=\s*5\b/);
assert.match(scriptSource, /\$RestartInterval\s*=\s*New-TimeSpan\s+-Minutes\s+1/);
assert.match(scriptSource, /RestartPolicy\s*=\s*"up to \$RestartCount attempts/);

if (process.platform !== "win32") {
  console.log("Windows service lifecycle fixture skipped outside Windows.");
  process.exit(0);
}

let installed = false;

function run(action) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", action],
    { encoding: "utf8", windowsHide: true }
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return `${result.stdout}\n${result.stderr}`;
}

try {
  assert.match(run("install"), /Installed scheduled task/i);
  installed = true;
  assert.match(run("status"), /PhoneDex scheduled task|TaskName/i);
  assert.match(run("stop"), /Stopped scheduled task/i);
  assert.match(run("uninstall"), /Removed scheduled task/i);
  installed = false;
  assert.match(run("status"), /not installed/i);
} finally {
  if (installed) {
    try {
      run("uninstall");
    } catch (error) {
      console.error("Failed to clean up PhoneDex scheduled task:", error.message);
      process.exitCode = 1;
    }
  }
}

console.log("Windows service lifecycle fixture passed.");
