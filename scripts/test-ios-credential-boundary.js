#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const iosApp = path.join(__dirname, "..", "ios", "PhoneDexApp");
const credentialStore = fs.readFileSync(path.join(iosApp, "PhoneDexCredentialStore.swift"), "utf8");
const settings = fs.readFileSync(path.join(iosApp, "PhoneDexSettings.swift"), "utf8");
const notificationDelegate = fs.readFileSync(path.join(iosApp, "PhoneDexNotificationDelegate.swift"), "utf8");
const notificationScheduler = fs.readFileSync(path.join(iosApp, "PhoneDexNotificationScheduler.swift"), "utf8");

assert.match(credentialStore, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
assert.match(credentialStore, /kSecClassGenericPassword/);
assert.match(settings, /try tokenStore\.readToken\(\)/);
assert.match(settings, /try tokenStore\.writeToken\(legacyToken\)/);
assert.match(settings, /defaults\.removeObject\(forKey: Keys\.token\)/);
assert.doesNotMatch(settings, /defaults\.set\([^\n]*Keys\.token/);
assert.match(notificationDelegate, /tokenStore\.readToken\(\)/);
assert.doesNotMatch(notificationDelegate, /userInfo\[[^\]]*token/i);
assert.doesNotMatch(notificationScheduler, /userInfo\[[^\]]*token/i);

console.log("iOS credential boundary fixture passed");
