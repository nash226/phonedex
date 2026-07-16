const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appPath = path.join(__dirname, "..", "ios", "PhoneDexApp", "ContentView.swift");
const reviewPath = path.join(__dirname, "..", "ios", "PhoneDexApp", "PhoneDexReviewSummary.swift");
const diffPath = path.join(__dirname, "..", "ios", "PhoneDexApp", "PhoneDexDiffViewer.swift");
const app = fs.readFileSync(appPath, "utf8");
const review = fs.readFileSync(reviewPath, "utf8");
const diff = fs.readFileSync(diffPath, "utf8");

assert.match(app, /struct PhoneDexTaskRow[\s\S]*?\.privacySensitive\(\)/);
assert.match(app, /struct PhoneDexTaskDetailView[\s\S]*?\.privacySensitive\(\)/);
assert.match(review, /struct PhoneDexReviewSummaryView[\s\S]*?\.privacySensitive\(\)/);
assert.match(diff, /private struct PhoneDexDiffContent[\s\S]*?\.privacySensitive\(\)/);

console.log("iOS privacy surfaces fixture passed");
