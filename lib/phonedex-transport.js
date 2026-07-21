"use strict";

const fs = require("node:fs");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function createTransportConfig({ host, port, publicUrl, requireTls = false, certificateFile = "", keyFile = "" }) {
  let url;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error("WATCH_BRIDGE_PUBLIC_URL must be a valid http or https URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("WATCH_BRIDGE_PUBLIC_URL must use http or https.");
  }

  const hasCertificate = Boolean(certificateFile);
  const hasKey = Boolean(keyFile);
  if (hasCertificate !== hasKey) {
    throw new Error("PHONEDEX_TLS_CERT_FILE and PHONEDEX_TLS_KEY_FILE must be configured together.");
  }
  const tls = url.protocol === "https:" || hasCertificate;
  if (tls && (!hasCertificate || !hasKey)) {
    throw new Error("HTTPS public URLs require PHONEDEX_TLS_CERT_FILE and PHONEDEX_TLS_KEY_FILE.");
  }
  if (tls && url.protocol !== "https:") {
    throw new Error("TLS certificate configuration requires an https public URL.");
  }
  if (requireTls && !tls) {
    throw new Error("PHONEDEX_REQUIRE_TLS is enabled, but the bridge public URL is not HTTPS.");
  }
  if (tls) validateTlsMaterial(certificateFile, keyFile);

  return Object.freeze({
    protocol: url.protocol.slice(0, -1),
    tls,
    requireTls: Boolean(requireTls),
    certificateFile,
    keyFile,
    isLoopback: LOOPBACK_HOSTS.has(String(host).toLowerCase()),
    host,
    port
  });
}

function validateTlsMaterial(certificateFile, keyFile) {
  for (const [label, file] of [["certificate", certificateFile], ["private key", keyFile]]) {
    try {
      const stats = fs.statSync(file);
      if (!stats.isFile()) throw new Error("not a regular file");
      fs.accessSync(file, fs.constants.R_OK);
      if (stats.size === 0) throw new Error("empty file");
    } catch (error) {
      throw new Error(`TLS ${label} file is not readable: ${file} (${error.message})`);
    }
  }
}

module.exports = { createTransportConfig };
