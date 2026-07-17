#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildReleaseReadiness } = require("../lib/phonedex-release-readiness");

const flags = parseFlags(process.argv.slice(2));
if (!flags.acceptance || !flags.quality) {
  console.error("Usage: node scripts/release-readiness.js --acceptance <report.json> --quality <report.json> [--output <report.json>] [--now <ISO-8601>]");
  process.exitCode = 2;
} else {
  try {
    const now = flags.now ? new Date(flags.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error("--now must be a valid ISO-8601 date.");
    const report = buildReleaseReadiness({
      acceptance: readJSON(flags.acceptance),
      quality: readJSON(flags.quality),
      generatedAt: now
    });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(serialized);
    if (flags.output) {
      const outputPath = path.resolve(flags.output);
      fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
      fs.chmodSync(outputPath, 0o600);
    }
    if (!report.automationReady) process.exitCode = 1;
  } catch (error) {
    console.error(`Release-readiness aggregation failed: ${error.message}`);
    process.exitCode = 2;
  }
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function parseFlags(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replaceAll("-", "");
    result[key] = args[index + 1]?.startsWith("--") ? true : args[++index];
  }
  return result;
}
