#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoots = [
  path.join(root, "ios", "PhoneDexApp"),
  path.join(root, "ios", "PhoneDexNotificationExtension")
];

function swiftFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return swiftFiles(entryPath);
    return entry.name.endsWith(".swift") ? [entryPath] : [];
  });
}

const files = sourceRoots.flatMap(swiftFiles);
const sources = files.map((file) => ({ file, text: fs.readFileSync(file, "utf8") }));
const localizedCalls = [];

for (const { file, text } of sources) {
  assert.doesNotMatch(text, /NSLocalizedString\s*\(/, `${path.relative(root, file)} must use modern localization APIs`);
  for (const match of text.matchAll(/String\(localized:\s*"([^"]+)"([^\n]*)\)/g)) {
    const [call, key, argumentsText] = match;
    assert.match(key, /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/, `${path.relative(root, file)} has an invalid localization key: ${key}`);
    assert.match(argumentsText, /\bdefaultValue:\s*"/, `${path.relative(root, file)} localization key ${key} needs a fallback`);
    assert.match(argumentsText, /\bcomment:\s*"/, `${path.relative(root, file)} localization key ${key} needs translator context`);
    localizedCalls.push({ call, key, file });
  }
}

assert.ok(localizedCalls.length >= 20, "the native client should keep meaningful user-facing copy localization-ready");
assert.ok(
  localizedCalls.some(({ file }) => file.endsWith("PhoneDexNotificationExtension/NotificationViewController.swift")),
  "the notification extension must keep its fallback copy localization-ready"
);

console.log(`iOS localization contract passed for ${files.length} Swift files and ${localizedCalls.length} keyed strings`);
