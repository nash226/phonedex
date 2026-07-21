#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const model = fs.readFileSync(path.join(root, "ios/PhoneDexApp/PhoneDexAppModel.swift"), "utf8");
const cache = fs.readFileSync(path.join(root, "ios/PhoneDexApp/PhoneDexLocalCache.swift"), "utf8");

const assertions = [
  ["cache restore is isolated behind a throwing boundary", model, /private func restoreCachedState\(\)\s*\{[\s\S]{0,400}?do \{/s],
  ["cache failures quarantine the persisted file", model, /catch \{[\s\S]{0,1400}?cache\.quarantine\(\)/],
  ["quarantine failures prevent repeated cold-start retries", model, /settings\.shouldBypassCacheRestore/],
  ["quarantine failures record a relaunch bypass", model, /settings\.markCacheRestoreBypassNeeded\(\)/],
  ["cache failures leave the app able to fetch fresh state", model, /Fresh data will be fetched when the hub is reachable\./],
  ["quarantine uses an opaque generated suffix", cache, /appendingPathComponent\("\\\(fileURL\.deletingPathExtension\(\)\.lastPathComponent\)\.corrupt-\\\(UUID\(\)\.uuidString\)/],
  ["cache errors use generic recovery-safe copy", model, /PhoneDex could not restore its local cache\./],
];

const failures = assertions
  .filter(([, source, pattern]) => !pattern.test(source))
  .map(([name]) => name);

if (failures.length > 0) {
  console.error(`iOS crash-recovery contract failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("iOS crash-recovery contract passed: corrupted local state is quarantined and startup remains recoverable.");
}
