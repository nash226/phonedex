"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createPhoneDexStore } = require("./phonedex-store");
const { pruneArtifacts } = require("./phonedex-artifacts");

const PRIVACY_SCHEMA = "phonedex.privacy.v1";
const POLICY_FILE = "privacy-policy.json";
const AUDIT_FILE = "privacy-audit.jsonl";
const DEFAULT_RETENTION_DAYS = 0;
const DELETE_CONFIRMATION = "DELETE_PHONEDEX_HISTORY";
const RETENTION_CONFIRMATION = "APPLY_PHONEDEX_RETENTION";
const RETENTION_LOG_FILES = [
  "replies.jsonl",
  "events.jsonl",
  "agent-installs.jsonl",
  "errors.jsonl"
];

function createPhoneDexPrivacy(dataDir) {
  const root = path.resolve(dataDir);
  const policyPath = path.join(root, POLICY_FILE);
  const store = createPhoneDexStore(root);

  return {
    summary() {
      const policy = readPolicy(policyPath);
      const files = [
        "phonedex-store.json",
        "tasks.jsonl",
        "replies.jsonl",
        "events.jsonl",
        "agent-installs.jsonl",
        "errors.jsonl",
        "artifacts.json",
        AUDIT_FILE
      ];
      return {
        schema: PRIVACY_SCHEMA,
        policy,
        taskCount: store.listTasks().length,
        deviceCount: store.listDevices().length,
        activityCount: RETENTION_LOG_FILES.reduce(
          (count, fileName) => count + readJsonl(root, fileName).length,
          0
        ),
        storageBytes: files.reduce((total, fileName) => total + fileSize(path.join(root, fileName)), 0)
      };
    },

    exportData() {
      const policy = readPolicy(policyPath);
      return {
        schema: PRIVACY_SCHEMA,
        exportedAt: new Date().toISOString(),
        policy: {
          retentionDays: policy.retentionDays,
          secretsRedacted: true,
          localPathsOmitted: true
        },
        tasks: store.listTasks().map((task) => redactExportValue(task, "task")),
        devices: store.listDevices().map((device) => redactExportValue(device, "device")),
        activity: Object.fromEntries(
          RETENTION_LOG_FILES.map((fileName) => [
            fileName,
            readJsonl(root, fileName).map((entry) => redactExportValue(entry))
          ])
        )
      };
    },

    applyRetention(retentionDays, options = {}) {
      const days = normalizeRetentionDays(retentionDays);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      let deletedTaskCount = 0;
      let deletedActivityCount = 0;
      let deletedArtifactCount = 0;
      let deletedArtifactBytes = 0;

      if (days > 0) {
        const deletedTaskIds = [];
        for (const task of store.listTasks()) {
          if (isBefore(task, cutoff)) {
            if (store.removeTask(task.id).removed) {
              deletedTaskCount += 1;
              deletedTaskIds.push(task.id);
            }
          }
        }

        for (const fileName of RETENTION_LOG_FILES) {
          const result = rewriteJsonl(root, fileName, (entry) => !isBefore(entry, cutoff));
          deletedActivityCount += result.removed;
        }
        rewriteJsonl(root, "tasks.jsonl", (entry) => !isBefore(entry, cutoff));
        const artifacts = pruneArtifacts(root, { before: cutoff, taskIds: deletedTaskIds });
        deletedArtifactCount = artifacts.deletedCount;
        deletedArtifactBytes = artifacts.deletedBytes;
      }

      const policy = writePolicy(policyPath, { retentionDays: days });
      if (options.audit !== false) {
        appendAudit(root, {
          action: "retention",
          retentionDays: days,
          deletedTaskCount,
          deletedActivityCount,
          deletedArtifactCount,
          deletedArtifactBytes
        });
      }
      return { policy, deletedTaskCount, deletedActivityCount, deletedArtifactCount, deletedArtifactBytes };
    },

    deleteHistory(options = {}) {
      if (options.confirmation !== DELETE_CONFIRMATION) {
        const error = new Error(`Confirmation must be ${DELETE_CONFIRMATION}.`);
        error.code = "privacy_confirmation_required";
        error.statusCode = 400;
        throw error;
      }

      const { deletedTaskCount } = store.clearTaskHistory();
      const artifacts = pruneArtifacts(root, { all: true });

      let deletedActivityCount = 0;
      for (const fileName of RETENTION_LOG_FILES) {
        const result = rewriteJsonl(root, fileName, () => false);
        deletedActivityCount += result.removed;
      }
      rewriteJsonl(root, "tasks.jsonl", () => false);

      const result = {
        deletedTaskCount,
        deletedActivityCount,
        deletedArtifactCount: artifacts.deletedCount,
        deletedArtifactBytes: artifacts.deletedBytes
      };
      appendAudit(root, { action: "delete-history", ...result });
      return result;
    }
  };
}

function normalizeRetentionDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    const error = new Error("Retention days must be an integer from 0 through 3650.");
    error.code = "privacy_invalid_retention";
    error.statusCode = 400;
    throw error;
  }
  return days;
}

function readPolicy(policyPath) {
  try {
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    if (
      policy.schema === PRIVACY_SCHEMA &&
      policy.version === 1 &&
      Number.isInteger(policy.retentionDays) &&
      policy.retentionDays >= 0 &&
      policy.retentionDays <= 3650
    ) {
      return policy;
    }
  } catch {
    // A malformed policy is replaced with the safe, non-destructive default.
  }
  return {
    schema: PRIVACY_SCHEMA,
    version: 1,
    retentionDays: DEFAULT_RETENTION_DAYS,
    updatedAt: null
  };
}

function writePolicy(policyPath, { retentionDays }) {
  const policy = {
    schema: PRIVACY_SCHEMA,
    version: 1,
    retentionDays,
    updatedAt: new Date().toISOString()
  };
  atomicWrite(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  return policy;
}

function appendAudit(root, entry) {
  fs.appendFileSync(
    path.join(root, AUDIT_FILE),
    `${JSON.stringify({
      schema: "phonedex.privacy-audit.v1",
      at: new Date().toISOString(),
      ...entry
    })}\n`,
    { mode: 0o600 }
  );
}

function rewriteJsonl(root, fileName, keep) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return { kept: 0, removed: 0 };

  const kept = [];
  let removed = 0;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      removed += 1;
      continue;
    }
    if (keep(entry)) kept.push(entry);
    else removed += 1;
  }

  atomicWrite(filePath, kept.length ? `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "");
  return { kept: kept.length, removed };
}

function isBefore(value, cutoff) {
  const timestamp = recordTimestamp(value);
  return timestamp !== null && timestamp < cutoff;
}

function recordTimestamp(value) {
  if (!value || typeof value !== "object") return null;
  for (const key of [
    "updatedAt",
    "createdAt",
    "at",
    "observedAt",
    "receivedAt",
    "recordedAt",
    "sentAt",
    "timestamp",
    "time"
  ]) {
    const candidate = Date.parse(value[key] || "");
    if (!Number.isNaN(candidate)) return candidate;
  }
  return null;
}

function redactExportValue(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => redactExportValue(entry));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactSensitiveText(value) : value;
  }

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (isSensitiveKey(childKey)) continue;
    if (isLocalPathKey(childKey)) continue;
    output[childKey] = redactExportValue(childValue, childKey);
  }

  if (key === "task" && !output.workspaceName && typeof value.cwd === "string") {
    output.workspaceName = value.cwd.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "Unknown workspace";
  }
  return output;
}

function isSensitiveKey(key) {
  return /token|secret|password|api[_-]?key|authorization|cookie|credential|hookpayload|rawhook|replyurl|publicurl|codexhome|hostname|pid|patch/i.test(key);
}

function isLocalPathKey(key) {
  return /^(cwd|path|filepath|filePath|installDir|workingDirectory)$/i.test(key);
}

function redactSensitiveText(value) {
  return String(value)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\/\s?#]*@/gi, "$1[redacted]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(password|token|secret|api[_ -]?key|credential|access[_ -]?token|refresh[_ -]?token|reply[_ -]?token)\b(?:\s*:\s*|\s+)([^\s`"'<>]{4,})/gi,
      "$1: [redacted]"
    )
    .replace(/([#?&](?:token|secret|password|api[_-]?key|credential|access[_-]?token|refresh[_-]?token|reply[_-]?token)=)[^&#\s]+/gi, "$1[redacted]");
}

function readJsonl(root, fileName) {
  const filePath = path.join(root, fileName);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { parseError: true };
      }
    });
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function atomicWrite(filePath, contents) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, contents, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  AUDIT_FILE,
  DELETE_CONFIRMATION,
  POLICY_FILE,
  PRIVACY_SCHEMA,
  RETENTION_CONFIRMATION,
  createPhoneDexPrivacy,
  normalizeRetentionDays,
  redactExportValue,
  redactSensitiveText
};
