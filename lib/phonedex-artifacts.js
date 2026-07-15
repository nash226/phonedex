"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ARTIFACT_DIRECTORY = "artifacts";
const ARTIFACT_INDEX = "artifacts.json";
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD_ID = 96;
const MAX_MEDIA_TYPE = 120;
const DEFAULT_MEDIA_TYPE = "application/octet-stream";
const SAFE_MEDIA_TYPES = new Set([
  "application/gzip",
  "application/json",
  "application/pdf",
  "application/octet-stream",
  "application/zip",
  "text/csv",
  "text/plain",
  "text/x-log"
]);

function prepareTaskEvidenceArtifacts(dataDir, evidence, taskId) {
  if (!evidence || typeof evidence !== "object" || !Array.isArray(evidence.artifacts)) {
    return evidence;
  }

  const artifacts = evidence.artifacts.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || typeof candidate.contentBase64 !== "string") {
      return candidate;
    }

    const stored = storeArtifact(dataDir, {
      taskId,
      artifact: candidate,
      contentBase64: candidate.contentBase64
    });
    const { contentBase64, ...withoutContent } = candidate;
    return { ...withoutContent, ...stored };
  });

  return { ...evidence, artifacts };
}

function storeArtifact(dataDir, { taskId, artifact, contentBase64 }) {
  const normalized = normalizeUpload(artifact, contentBase64);
  const downloadId = normalized.downloadId || createDownloadId();
  const root = path.resolve(dataDir);
  const directory = path.join(root, ARTIFACT_DIRECTORY);
  const filePath = path.join(directory, `${downloadId}.bin`);
  const indexPath = path.join(root, ARTIFACT_INDEX);

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const index = readIndex(indexPath);
  const existing = index[downloadId];
  if (existing && (existing.sha256 !== normalized.sha256 || existing.sizeBytes !== normalized.sizeBytes)) {
    throw artifactError("artifact_download_id_conflict", "The artifact download identity is already bound to different bytes.");
  }

  if (!existing) {
    writePrivateFile(filePath, normalized.bytes);
    index[downloadId] = {
      taskId: boundedString(taskId, 160),
      artifactId: boundedString(artifact.id, 160),
      downloadId,
      name: boundedString(artifact.name, 240),
      kind: boundedString(artifact.kind || "artifact", 80),
      sourceRef: boundedString(artifact.sourceRef, 600),
      sizeBytes: normalized.sizeBytes,
      sha256: normalized.sha256,
      mediaType: normalized.mediaType,
      storedAt: new Date().toISOString()
    };
    writeJsonAtomically(indexPath, index);
  }

  return publicArtifact(index[downloadId]);
}

function findArtifact(dataDir, downloadId) {
  const normalizedId = normalizeDownloadId(downloadId);
  if (!normalizedId) return null;
  return readIndex(path.join(path.resolve(dataDir), ARTIFACT_INDEX))[normalizedId] || null;
}

function readVerifiedArtifact(dataDir, downloadId) {
  const record = findArtifact(dataDir, downloadId);
  if (!record) return null;

  const filePath = path.join(path.resolve(dataDir), ARTIFACT_DIRECTORY, `${record.downloadId}.bin`);
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    throw artifactError("artifact_unavailable", "The exported artifact is no longer available.");
  }

  const digest = sha256(bytes);
  if (digest !== record.sha256 || bytes.length !== record.sizeBytes) {
    throw artifactError("artifact_integrity_failed", "The exported artifact failed its integrity check.");
  }

  return { record: publicArtifact(record), bytes };
}

function normalizeUpload(artifact, contentBase64) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw artifactError("artifact_invalid", "The artifact metadata is invalid.");
  }
  if (!isBase64(contentBase64)) {
    throw artifactError("artifact_encoding_invalid", "The artifact content must be valid base64.");
  }

  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    throw artifactError("artifact_too_large", `Artifacts must be ${MAX_ARTIFACT_BYTES} bytes or smaller.`);
  }

  const digest = sha256(bytes);
  if (artifact.sha256 && normalizeDigest(artifact.sha256) !== digest) {
    throw artifactError("artifact_digest_mismatch", "The artifact SHA-256 digest does not match its content.");
  }
  if (artifact.sizeBytes !== undefined && artifact.sizeBytes !== bytes.length) {
    throw artifactError("artifact_size_mismatch", "The artifact size does not match its content.");
  }

  return {
    bytes,
    sizeBytes: bytes.length,
    sha256: digest,
    downloadId: normalizeDownloadId(artifact.downloadId),
    mediaType: normalizeMediaType(artifact.mediaType)
  };
}

function publicArtifact(record) {
  if (!record) return null;
  const { taskId, artifactId, storedAt, ...metadata } = record;
  return metadata;
}

function readIndex(indexPath) {
  try {
    const value = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function writePrivateFile(filePath, bytes) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporaryPath, filePath);
}

function createDownloadId() {
  return `artifact_${crypto.randomBytes(24).toString("base64url")}`.slice(0, MAX_DOWNLOAD_ID);
}

function normalizeDownloadId(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{12,96}$/.test(normalized) ? normalized : "";
}

function normalizeDigest(value) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function normalizeMediaType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_MEDIA_TYPE) : "";
  return SAFE_MEDIA_TYPES.has(normalized) ? normalized : DEFAULT_MEDIA_TYPE;
}

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isBase64(value) {
  return typeof value === "string" && value.length > 0 && value.length <= Math.ceil((MAX_ARTIFACT_BYTES * 4) / 3) + 4 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function artifactError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = code === "artifact_too_large"
    ? 413
    : ["artifact_integrity_failed", "artifact_unavailable", "artifact_download_id_conflict"].includes(code)
      ? 409
      : 400;
  return error;
}

module.exports = {
  MAX_ARTIFACT_BYTES,
  findArtifact,
  prepareTaskEvidenceArtifacts,
  publicArtifact,
  readVerifiedArtifact,
  storeArtifact
};
