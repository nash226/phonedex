#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REQUIRED_GATES } = require("../lib/phonedex-quality-gates");
const { REQUIRED_SCENARIOS } = require("../lib/phonedex-acceptance");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "phonedex-evidence-report-"));
try {
  const now = "2026-07-17T12:00:00.000Z";
  const qualityInput = path.join(root, "quality-input.json");
  const qualityOutput = path.join(root, "quality-report.json");
  fs.writeFileSync(qualityInput, JSON.stringify({ gates: REQUIRED_GATES.map((id) => ({
    id,
    status: "pass",
    platforms: id === "performance" ? ["ios", "macos", "windows"] : ["ios"],
    validatedAt: "2026-07-16T12:00:00.000Z",
    evidenceId: `fixture-${id}`
  })) }));

  const quality = run("quality-gates.js", qualityInput, qualityOutput, now);
  assert.equal(quality.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(qualityOutput, "utf8")), JSON.parse(quality.stdout));
  assert.equal(JSON.parse(fs.readFileSync(qualityOutput, "utf8")).ok, true);
  assert.equal(fs.statSync(qualityOutput).mode & 0o777, 0o600);

  const acceptanceInput = path.join(root, "acceptance-input.json");
  const acceptanceOutput = path.join(root, "acceptance-report.json");
  fs.writeFileSync(acceptanceInput, JSON.stringify({ sourceRevision: process.env.GITHUB_SHA, scenarios: REQUIRED_SCENARIOS.map((id) => ({
    id,
    status: "pass",
    platforms: ["ios"],
    validatedAt: "2026-07-16T12:00:00.000Z"
  })) }));

  const acceptance = run("acceptance-evidence.js", acceptanceInput, acceptanceOutput, now);
  assert.equal(acceptance.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(acceptanceOutput, "utf8")), JSON.parse(acceptance.stdout));
  assert.equal(JSON.parse(fs.readFileSync(acceptanceOutput, "utf8")).ok, true);
  assert.equal(fs.statSync(acceptanceOutput).mode & 0o777, 0o600);
  assert.match(JSON.parse(fs.readFileSync(acceptanceOutput, "utf8")).sourceRevision, /^[0-9a-f]{40,64}$/);

  const mismatchedAcceptanceInput = path.join(root, "mismatched-acceptance-input.json");
  const mismatchedAcceptanceOutput = path.join(root, "mismatched-acceptance-report.json");
  fs.writeFileSync(mismatchedAcceptanceInput, JSON.stringify({ sourceRevision: "0000000000000000000000000000000000000000", scenarios: [] }));
  const mismatchedAcceptance = run("acceptance-evidence.js", mismatchedAcceptanceInput, mismatchedAcceptanceOutput, now);
  assert.equal(mismatchedAcceptance.status, 2);
  assert.match(mismatchedAcceptance.stderr, /does not match the checked-out revision/);

  const failedInput = path.join(root, "failed-quality-input.json");
  const failedOutput = path.join(root, "failed-quality-report.json");
  fs.writeFileSync(failedInput, JSON.stringify({ gates: [] }));
  const failed = run("quality-gates.js", failedInput, failedOutput, now);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(fs.readFileSync(failedOutput, "utf8")).ok, false);

  const symlinkTarget = path.join(root, "symlink-target.json");
  const symlinkOutput = path.join(root, "symlink-report.json");
  fs.writeFileSync(symlinkTarget, "keep this file unchanged\n");
  fs.symlinkSync(symlinkTarget, symlinkOutput);
  const symlinked = run("quality-gates.js", qualityInput, symlinkOutput, now);
  assert.equal(symlinked.status, 2);
  assert.match(symlinked.stderr, /symbolic link/);
  assert.equal(fs.readFileSync(symlinkTarget, "utf8"), "keep this file unchanged\n");
  assert.equal(fs.readlinkSync(symlinkOutput), symlinkTarget);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("evidence report CLI fixture passed");

function run(script, input, output, now) {
  return spawnSync(process.execPath, [path.join(__dirname, script), "--input", input, "--output", output, "--now", now], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  });
}
