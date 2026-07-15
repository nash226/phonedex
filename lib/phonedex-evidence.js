"use strict";

const MAX = Object.freeze({
  filePath: 400,
  fileSummary: 600,
  sourceRef: 600,
  patch: 600000,
  artifactId: 160,
  artifactName: 240,
  artifactKind: 80,
  validationId: 160,
  validationName: 240,
  validationSummary: 800,
  sha256: 128
});

const FILE_STATUSES = new Set(["added", "modified", "deleted", "renamed", "copied", "unknown"]);
const VALIDATION_STATUSES = new Set(["passed", "failed", "skipped", "running", "unknown"]);

function normalizeTaskEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const changedFiles = uniqueBy(
    Array.isArray(value.changedFiles) ? value.changedFiles : value.files,
    normalizeChangedFile,
    (file) => file.path
  );
  const artifacts = uniqueBy(
    Array.isArray(value.artifacts) ? value.artifacts : [],
    normalizeArtifact,
    (artifact) => artifact.id || `${artifact.name}\u0000${artifact.sourceRef || ""}`
  );
  const validations = uniqueBy(
    Array.isArray(value.validations) ? value.validations : value.validationReceipts,
    normalizeValidation,
    (validation) => validation.id || validation.name
  );

  if (changedFiles.length === 0 && artifacts.length === 0 && validations.length === 0) return undefined;
  return { changedFiles, artifacts, validations };
}

function mergeTaskEvidence(previous, incoming) {
  const left = normalizeTaskEvidence(previous) || emptyEvidence();
  const right = normalizeTaskEvidence(incoming) || emptyEvidence();
  const merged = normalizeTaskEvidence({
    changedFiles: mergeChangedFiles(left.changedFiles, right.changedFiles),
    artifacts: [...left.artifacts, ...right.artifacts],
    validations: [...left.validations, ...right.validations]
  });
  return merged || undefined;
}

function mergeChangedFiles(left, right) {
  const merged = new Map();
  for (const file of [...left, ...right]) {
    const previous = merged.get(file.path);
    merged.set(file.path, previous
      ? {
          ...previous,
          ...file,
          sourceRef: file.sourceRef || previous.sourceRef,
          summary: file.summary || previous.summary,
          additions: file.additions ?? previous.additions,
          deletions: file.deletions ?? previous.deletions,
          patch: file.patch || previous.patch,
          patchTruncated: file.patchTruncated ?? previous.patchTruncated
        }
      : file);
  }
  return Array.from(merged.values()).slice(0, 100);
}

function evidenceSummary(value) {
  const evidence = normalizeTaskEvidence(value);
  if (!evidence) return "";
  const parts = [];
  if (evidence.changedFiles.length > 0) parts.push(`${evidence.changedFiles.length} changed file${evidence.changedFiles.length === 1 ? "" : "s"}`);
  if (evidence.artifacts.length > 0) parts.push(`${evidence.artifacts.length} artifact${evidence.artifacts.length === 1 ? "" : "s"}`);
  if (evidence.validations.length > 0) parts.push(`${evidence.validations.length} validation receipt${evidence.validations.length === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function normalizeChangedFile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const path = normalizeRelativePath(value.path || value.file || value.name);
  if (!path) return null;
  const result = {
    path,
    status: FILE_STATUSES.has(value.status) ? value.status : "unknown"
  };
  const sourceRef = normalizeRelativeReference(value.sourceRef || value.source || value.patchRef);
  if (sourceRef) result.sourceRef = sourceRef;
  const summary = boundedString(value.summary || value.description, MAX.fileSummary);
  if (summary) result.summary = summary;
  const patch = normalizePatch(value.patch || value.diff);
  if (patch) {
    result.patch = patch.value;
    if (patch.truncated) result.patchTruncated = true;
  }
  const additions = nonNegativeInteger(value.additions);
  const deletions = nonNegativeInteger(value.deletions);
  if (additions !== undefined) result.additions = additions;
  if (deletions !== undefined) result.deletions = deletions;
  return result;
}

function normalizePatch(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\0", "");
  if (!normalized.trim()) return null;
  return {
    value: normalized.slice(0, MAX.patch),
    truncated: normalized.length > MAX.patch
  };
}

function normalizeArtifact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = boundedString(value.name || value.title, MAX.artifactName);
  const sourceRef = normalizeRelativeReference(value.sourceRef || value.ref || value.path);
  if (!name || !sourceRef) return null;
  const result = {
    id: boundedString(value.id || value.artifactId || `${name}-${sourceRef}`, MAX.artifactId),
    name,
    kind: boundedString(value.kind || "artifact", MAX.artifactKind),
    sourceRef
  };
  const sizeBytes = nonNegativeInteger(value.sizeBytes);
  if (sizeBytes !== undefined) result.sizeBytes = sizeBytes;
  const sha256 = boundedString(value.sha256 || value.digest, MAX.sha256);
  if (sha256) result.sha256 = sha256;
  return result;
}

function normalizeValidation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = boundedString(value.name || value.command || value.title, MAX.validationName);
  if (!name) return null;
  const result = {
    id: boundedString(value.id || value.validationId || name, MAX.validationId),
    name,
    status: VALIDATION_STATUSES.has(value.status) ? value.status : "unknown"
  };
  const summary = boundedString(value.summary || value.message || value.output, MAX.validationSummary);
  if (summary) result.summary = summary;
  const durationMs = nonNegativeInteger(value.durationMs);
  if (durationMs !== undefined) result.durationMs = durationMs;
  if (validTimestamp(value.completedAt)) result.completedAt = value.completedAt;
  return result;
}

function normalizeRelativePath(value) {
  const path = boundedString(value, MAX.filePath).replaceAll("\\", "/").trim();
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//.test(path)) return "";
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) return "";
  return parts.join("/").replace(/^\.\//, "");
}

function normalizeRelativeReference(value) {
  const reference = boundedString(value, MAX.sourceRef).replaceAll("\\", "/").trim();
  if (!reference || reference.includes("\0") || /(?:^|\/)\.\.(?:\/|$)/.test(reference)) return "";
  if (/^(?:[A-Za-z]:\/|\/|https?:\/\/|file:\/\/)/i.test(reference)) return "";
  return reference;
}

function uniqueBy(values, normalize, keyFor) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized) continue;
    const key = keyFor(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result.slice(0, 100);
}

function emptyEvidence() {
  return { changedFiles: [], artifacts: [], validations: [] };
}

function boundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function validTimestamp(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

module.exports = {
  evidenceSummary,
  mergeTaskEvidence,
  normalizeTaskEvidence
};
