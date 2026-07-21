#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "ios", "PhoneDexNotificationExtension", "NotificationViewController.swift"),
  "utf8"
);

for (const key of [
  "notification.extension.fallbackTitle",
  "notification.extension.fallbackBody",
  "notification.extension.emptyBody",
  "notification.extension.now",
  "notification.extension.timeAccessibilityLabel",
  "notification.extension.bodyAccessibilityHint"
]) {
  assert.match(source, new RegExp(key.replaceAll(".", "\\.")));
}

assert.match(source, /UIFontMetrics\(forTextStyle: \.headline\)/);
assert.match(source, /UIFontMetrics\(forTextStyle: \.title2\)/);
assert.match(source, /adjustsFontForContentSizeCategory = true/);
for (const color of [
  "systemBackground",
  "label",
  "secondaryLabel",
  "quaternaryLabel"
]) {
  assert.match(source, new RegExp(`\\.${color}\\b`));
}
assert.doesNotMatch(source, /UIColor\(red:/);
assert.doesNotMatch(source, /UIColor\(white:/);
assert.match(source, /titleLabel\.accessibilityLabel = titleLabel\.text/);
assert.match(source, /bodyLabel\.accessibilityLabel = bodyLabel\.text/);
assert.match(source, /titleLabel\.accessibilityTraits = \[\.header, \.staticText\]/);
assert.match(source, /bodyLabel\.accessibilityTraits = \.staticText/);
assert.match(source, /scrollView\.accessibilityHint = Copy\.bodyAccessibilityHint/);
assert.match(source, /timeLabel\.accessibilityLabel = Copy\.timeAccessibilityLabel/);
assert.doesNotMatch(source, /title: "Codex update"/);
assert.doesNotMatch(source, /body: "Open the expanded PhoneDex notification/);

console.log("iOS notification extension localization and Dynamic Type contract passed");
