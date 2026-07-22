#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { DEFAULT_MAX_AGE_DAYS, SOURCE_REVISION_PATTERN, evaluateQualityGates } = require("../lib/phonedex-quality-gates");
const { writePrivateReport } = require("../lib/phonedex-private-report");

const flags = parseFlags(process.argv.slice(2));
if (!flags.input) {
  console.error("Usage: node scripts/quality-gates.js --input <quality-gates.json> [--output <report.json>] [--now <ISO-8601>] [--max-age-days <n>]");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(fs.readFileSync(path.resolve(flags.input), "utf8"));
    const now = flags.now ? new Date(flags.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error("--now must be a valid ISO-8601 date.");
    const maxAgeDays = flags.maxagedays === undefined ? DEFAULT_MAX_AGE_DAYS : Number(flags.maxagedays);
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw new Error("--max-age-days must be a non-negative number.");
    const sourceRevision = resolveSourceRevision();
    if (input.sourceRevision && input.sourceRevision !== sourceRevision) {
      throw new Error("quality-gate evidence source revision does not match the checked-out revision.");
    }
    const report = evaluateQualityGates({ ...input, sourceRevision }, { now, maxAgeDays });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(serialized);
    if (flags.output) {
      writePrivateReport(flags.output, serialized);
    }
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`Quality-gate validation failed: ${error.message}`);
    process.exitCode = 2;
  }
}

function resolveSourceRevision() {
  const candidate = process.env.GITHUB_SHA || childProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8"
  }).trim();
  if (!SOURCE_REVISION_PATTERN.test(candidate)) throw new Error("unable to resolve a full checked-out source revision.");
  return candidate.toLowerCase();
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
