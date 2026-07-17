#!/usr/bin/env node

"use strict";

const assert = require("node:assert/strict");
const { createTransportConfig } = require("../lib/phonedex-transport");

const loopback = createTransportConfig({
  host: "127.0.0.1",
  port: 8765,
  publicUrl: "http://127.0.0.1:8765"
});
assert.equal(loopback.tls, false);
assert.equal(loopback.isLoopback, true);

const tls = createTransportConfig({
  host: "0.0.0.0",
  port: 8765,
  publicUrl: "https://phone.example.test:8765",
  requireTls: true,
  certificateFile: "/etc/phonedex/cert.pem",
  keyFile: "/etc/phonedex/key.pem"
});
assert.equal(tls.tls, true);
assert.equal(tls.protocol, "https");
assert.equal(tls.isLoopback, false);

assert.throws(() => createTransportConfig({
  host: "0.0.0.0", port: 8765, publicUrl: "http://phone.example.test:8765", requireTls: true
}), /not HTTPS/);
assert.throws(() => createTransportConfig({
  host: "0.0.0.0", port: 8765, publicUrl: "https://phone.example.test:8765"
}), /TLS_CERT_FILE and PHONEDEX_TLS_KEY_FILE/);
assert.throws(() => createTransportConfig({
  host: "0.0.0.0", port: 8765, publicUrl: "https://phone.example.test:8765", certificateFile: "cert.pem"
}), /configured together/);
assert.throws(() => createTransportConfig({
  host: "0.0.0.0", port: 8765, publicUrl: "http://phone.example.test:8765", certificateFile: "cert.pem", keyFile: "key.pem"
}), /https public URL/);

console.log("transport configuration fixture passed");
