#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_MAX_AGE_DAYS, evaluateAcceptanceEvidence } = require("../lib/phonedex-acceptance");

const flags = parseFlags(process.argv.slice(2));
if (!flags.input) {
  console.error("Usage: node scripts/acceptance-evidence.js --input <evidence.json> [--output <report.json>] [--now <ISO-8601>] [--max-age-days <n>]");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(fs.readFileSync(path.resolve(flags.input), "utf8"));
    const now = flags.now ? new Date(flags.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error("--now must be a valid ISO-8601 date.");
    const maxAgeDays = flags.maxagedays === undefined ? DEFAULT_MAX_AGE_DAYS : Number(flags.maxagedays);
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error("--max-age-days must be a non-negative number.");
    const report = evaluateAcceptanceEvidence(input, { now, maxAgeDays });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(serialized);
    if (flags.output) {
      const outputPath = path.resolve(flags.output);
      fs.writeFileSync(outputPath, serialized, { mode: 0o600 });
      fs.chmodSync(outputPath, 0o600);
    }
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Acceptance evidence validation failed: ${error.message}`);
    process.exitCode = 2;
  }
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
