#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { evaluateReleaseMatrix } = require("../lib/phonedex-release-matrix");

const now = new Date("2026-07-17T12:00:00.000Z");
const ios = { deviceId: "iphone-release", platform: "ios", validatedAt: "2026-07-16T12:00:00.000Z", scenarios: Object.fromEntries(["pairing", "transport", "sync", "replies", "approval", "review", "privacy", "recovery", "accessibility"].map((key) => [key, "pass"])) };
const desktop = (platform) => ({ deviceId: `${platform}-release`, platform, validatedAt: "2026-07-16T12:00:00.000Z", scenarios: Object.fromEntries(["enroll-heartbeat", "task-ingest", "reply", "restart-recovery", "offline-recovery"].map((key) => [key, "pass"])) });

const passing = evaluateReleaseMatrix({ devices: [ios, desktop("macos"), desktop("windows")] }, { now });
assert.equal(passing.ok, true);
assert.deepEqual(passing.issues, []);

const missing = evaluateReleaseMatrix({ devices: [ios, desktop("macos")] }, { now });
assert.equal(missing.ok, false);
assert.equal(missing.issues.some((issue) => issue.code === "platform-not-ready" && issue.platform === "windows"), true);

const stale = evaluateReleaseMatrix({ devices: [{ ...desktop("windows"), validatedAt: "2026-05-01T12:00:00.000Z" }] }, { now });
assert.equal(stale.devices[0].ok, false);
assert.match(stale.devices[0].issues.join(" "), /older than/);

const failed = evaluateReleaseMatrix({ devices: [{ ...desktop("windows"), scenarios: { ...desktop("windows").scenarios, reply: "fail" } }] }, { now });
assert.equal(failed.ok, false);
assert.match(failed.devices[0].issues.join(" "), /reply is fail/);

console.log("release matrix preflight fixture passed");
