"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  addDeviceProtocolFields,
  addTaskProtocolFields
} = require("./phonedex-protocol");
const {
  decodeSyncCursor,
  encodeSyncCursor,
  normalizeSyncLimit,
  syncError
} = require("./phonedex-sync");

const STORE_SCHEMA = "phonedex.store.v1";
const CURRENT_VERSION = 3;
const STORE_FILE = "phonedex-store.json";
const LOCK_FILE = `${STORE_FILE}.lock`;
const BACKUP_FILE = `${STORE_FILE}.bak`;
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 30_000;

function createPhoneDexStore(dataDir) {
  const root = path.resolve(dataDir);
  const storePath = path.join(root, STORE_FILE);
  const backupPath = path.join(root, BACKUP_FILE);

  fs.mkdirSync(root, { recursive: true });
  initialize();

  return {
    appendTask(task, isDuplicate, mergeDuplicate) {
      return transaction((state) => {
        const duplicateIndex = isDuplicate
          ? state.tasks.findIndex((candidate) => isDuplicate(candidate))
          : -1;
        if (duplicateIndex >= 0) {
          const duplicate = state.tasks[duplicateIndex];
          const merged = mergeDuplicate ? mergeDuplicate(duplicate, task) : duplicate;
          if (merged && JSON.stringify(merged) !== JSON.stringify(duplicate)) {
            state.tasks[duplicateIndex] = merged;
            recordChange(state, "task", merged.id, merged, false);
            return { created: false, merged: true, previous: duplicate, task: merged };
          }
          return { changed: false, created: false, merged: false, previous: duplicate, task: duplicate };
        }
        state.tasks.push(task);
        recordChange(state, "task", task.id, task, false);
        return { created: true, task };
      });
    },

    listTasks() {
      return readState().tasks.slice();
    },

    upsertDevice(device) {
      return transaction((state) => {
        const index = state.devices.findIndex(
          (candidate) => candidate.deviceId === device.deviceId
        );
        const previous = index >= 0 ? state.devices[index] : {};
        const next = {
          ...previous,
          ...device,
          firstSeenAt: previous.firstSeenAt || device.lastSeenAt || new Date().toISOString()
        };

        if (index >= 0) state.devices[index] = next;
        else state.devices.push(next);

        recordChange(state, "device", next.deviceId, next, false);

        state.devices.sort(
          (a, b) => Date.parse(b.lastSeenAt || "") - Date.parse(a.lastSeenAt || "")
        );
        return next;
      });
    },

    listDevices() {
      return readState().devices.slice();
    },

    appendEvent(event) {
      return transaction((state) => {
        if (state.events.some((candidate) => candidate.id === event.id)) {
          return { changed: false, created: false, event };
        }
        state.events.push(event);
        state.events.sort(compareEventsForSync);
        recordChange(state, "event", event.id, event, false);
        return { created: true, event };
      });
    },

    listEvents(taskId) {
      const events = readState().events.slice().sort(compareEventsForSync);
      return taskId ? events.filter((event) => event.taskId === taskId) : events;
    },

    listIdentities() {
      return readState().identities.slice();
    },

    findIdentityByCredentialHash(credentialHash) {
      return readState().identities.find(
        (identity) => identity.credentialHash === credentialHash
      );
    },

    findIdentityById(identityId) {
      return readState().identities.find((identity) => identity.id === identityId);
    },

    revokeIdentity({ identityId, deviceId, now = new Date().toISOString(), reason = "" } = {}) {
      return transaction((state) => {
        const index = state.identities.findIndex((identity) =>
          (identityId && identity.id === identityId) ||
          (!identityId && deviceId && identity.deviceId === deviceId)
        );
        if (index < 0) return { changed: false, found: false, identity: null };

        const current = state.identities[index];
        if (current.status === "revoked") {
          return { changed: false, found: true, identity: current };
        }

        const identity = {
          ...current,
          status: "revoked",
          revokedAt: now,
          ...(String(reason).trim()
            ? { revocationReason: String(reason).trim().slice(0, 160) }
            : {})
        };
        state.identities[index] = identity;

        const deviceIndex = state.devices.findIndex(
          (device) => device.deviceId === identity.deviceId
        );
        if (deviceIndex >= 0) {
          const device = state.devices[deviceIndex];
          const revokedDevice = {
            ...device,
            status: "revoked",
            health: { ...(device.health || {}), reachability: "revoked" },
            lastSeenAt: device.lastSeenAt || now
          };
          state.devices[deviceIndex] = revokedDevice;
          recordChange(state, "device", revokedDevice.deviceId, revokedDevice, false);
        }

        return { changed: true, found: true, identity };
      });
    },

    createPairingGrant(grant) {
      return transaction((state) => {
        state.pairingGrants.push(grant);
        return grant;
      });
    },

    listPairingGrants() {
      return readState().pairingGrants.slice();
    },

    redeemPairingGrant({ grantHash, verificationCodeHash, identity, now }) {
      return transaction((state) => {
        const index = state.pairingGrants.findIndex(
          (grant) => grant.grantHash === grantHash
        );
        if (index < 0) return { changed: false, ok: false, code: "pairing_invalid" };

        const grant = state.pairingGrants[index];
        if (grant.usedAt) {
          return { changed: false, ok: false, code: "pairing_used" };
        }
        if (Date.parse(grant.expiresAt || "") <= Date.parse(now || "")) {
          return { changed: false, ok: false, code: "pairing_expired" };
        }
        if (grant.verificationCodeHash !== verificationCodeHash) {
          return { changed: false, ok: false, code: "pairing_invalid" };
        }

        state.pairingGrants[index] = { ...grant, usedAt: now };
        state.identities.push(identity);
        return { ok: true, identity };
      });
    },

    removeTask(taskId) {
      return transaction((state) => {
        const index = state.tasks.findIndex((task) => task.id === taskId);
        if (index < 0) return { removed: false };
        state.tasks.splice(index, 1);
        recordChange(state, "task", taskId, null, true);
        return { removed: true };
      });
    },

    removeDevice(deviceId) {
      return transaction((state) => {
        const index = state.devices.findIndex((device) => device.deviceId === deviceId);
        if (index < 0) return { removed: false };
        state.devices.splice(index, 1);
        recordChange(state, "device", deviceId, null, true);
        return { removed: true };
      });
    },

    clearTaskHistory() {
      const result = transaction((state) => {
        const deletedTaskCount = state.tasks.length;
        const deletedEventCount = state.events.length;
        const deletedChangeCount = state.changes.length;
        state.tasks = [];
        state.events = [];
        state.changes = [];
        return { deletedTaskCount, deletedEventCount, deletedChangeCount };
      }, { createBackup: false });
      // A history deletion must not leave the previous snapshot recoverable as
      // a backup containing the deleted task content.
      try {
        fs.rmSync(backupPath, { force: true });
      } catch {
        // The new primary snapshot is still authoritative if cleanup fails.
      }
      return result;
    },

    readSync(options = {}) {
      const state = readState();
      const cursor = decodeSyncCursor(options.cursor);
      const limit = normalizeSyncLimit(options.limit);
      const latestPosition = state.changes.at(-1)?.position || 0;

      if (cursor?.position > latestPosition) {
        throw syncError("sync_cursor_invalid", "Sync cursor is ahead of the hub state.");
      }

      if (cursor?.mode === "snapshot") {
        if (cursor.revision !== state.revision) {
          throw syncError(
            "sync_snapshot_changed",
            "The hub changed while the snapshot was being read. Restart sync."
          );
        }
        return buildSnapshotPage(state, cursor, limit, latestPosition);
      }

      if (!cursor) {
        return buildSnapshotPage(
          state,
          { mode: "snapshot", position: latestPosition, revision: state.revision, taskOffset: 0, deviceOffset: 0, eventOffset: 0 },
          limit,
          latestPosition
        );
      }

      const changes = state.changes
        .filter((change) => change.position > cursor.position)
        .slice(0, limit);
      const nextPosition = changes.at(-1)?.position || cursor.position;
      const hasMore = state.changes.some((change) => change.position > nextPosition);
      return {
        revision: state.revision,
        position: latestPosition,
        snapshot: null,
        changes,
        cursor: encodeSyncCursor({ mode: "stream", position: nextPosition }),
        hasMore,
        updatedAt: state.updatedAt
      };
    },

    read() {
      return readState();
    },

    paths: { storePath, backupPath }
  };

  function initialize() {
    if (fs.existsSync(storePath)) {
      let raw;
      try {
        raw = readJsonFile(storePath);
      } catch {
        readState();
        return;
      }
      const state = readState();
      if (raw.schema !== state.schema || raw.version !== state.version) {
        writeSnapshot(state, { createBackup: true });
      }
      return;
    }

    const migrated = migrateLegacyFiles(root);
    writeSnapshot(createState(migrated), { createBackup: false });
  }

  function readState() {
    let parsed;
    try {
      parsed = readJsonFile(storePath);
      return migrateState(parsed);
    } catch (error) {
      if (parsed && Number.isInteger(parsed.version) && parsed.version > CURRENT_VERSION) {
        throw error;
      }
      if (!fs.existsSync(backupPath)) throw error;

      const recovered = migrateState(readJsonFile(backupPath));
      const corruptPath = `${storePath}.corrupt-${Date.now()}`;
      fs.renameSync(storePath, corruptPath);
      writeSnapshot(recovered, { createBackup: false });
      return recovered;
    }
  }

  function transaction(mutator, options = {}) {
    const release = acquireLock(path.join(root, LOCK_FILE));
    try {
      const state = clone(readState());
      const result = mutator(state);
      validateState(state);
      if (result && result.changed === false) return result;
      state.revision += 1;
      state.updatedAt = new Date().toISOString();
      writeSnapshot(state, { createBackup: options.createBackup !== false });
      return result;
    } finally {
      release();
    }
  }

  function writeSnapshot(state, { createBackup }) {
    if (createBackup && fs.existsSync(storePath)) {
      fs.copyFileSync(storePath, backupPath);
    }

    const tempPath = `${storePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const contents = `${JSON.stringify(state, null, 2)}\n`;
    let fd;
    try {
      fd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(fd, contents, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tempPath, storePath);
      syncDirectory(root);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
  }

  function buildSnapshotPage(state, cursor, limit, latestPosition) {
    const tasks = state.tasks.slice().sort(compareTasksForSync);
    const devices = state.devices.slice().sort(compareDevicesForSync);
    const events = state.events.slice().sort(compareEventsForSync);
    let taskOffset = cursor.taskOffset;
    let deviceOffset = cursor.deviceOffset;
    let eventOffset = cursor.eventOffset;
    let remaining = limit;
    const taskPage = tasks.slice(taskOffset, taskOffset + remaining);
    taskOffset += taskPage.length;
    remaining -= taskPage.length;
    const devicePage = devices.slice(deviceOffset, deviceOffset + remaining);
    deviceOffset += devicePage.length;
    remaining -= devicePage.length;
    const eventPage = events.slice(eventOffset, eventOffset + remaining);
    eventOffset += eventPage.length;
    const complete = taskOffset >= tasks.length && deviceOffset >= devices.length && eventOffset >= events.length;
    const nextCursor = complete
      ? encodeSyncCursor({ mode: "stream", position: latestPosition })
      : encodeSyncCursor({
          mode: "snapshot",
          position: latestPosition,
          revision: state.revision,
          taskOffset,
          deviceOffset,
          eventOffset
        });

    return {
      revision: state.revision,
      position: latestPosition,
      snapshot: {
        complete,
        revision: state.revision,
        position: latestPosition,
        tasks: taskPage,
        devices: devicePage,
        events: eventPage
      },
      changes: [],
      cursor: nextCursor,
      hasMore: !complete,
      updatedAt: state.updatedAt
    };
  }
}

function recordChange(state, kind, id, record, deleted) {
  const previousPosition = state.changes.at(-1)?.position || 0;
  state.changes.push({
    position: previousPosition + 1,
    kind,
    id,
    deleted,
    ...(deleted ? {} : { record: clone(record) })
  });
}

function compareTasksForSync(left, right) {
  const dateDelta = Date.parse(right.updatedAt || right.createdAt || right.at || "") -
    Date.parse(left.updatedAt || left.createdAt || left.at || "");
  if (dateDelta !== 0 && !Number.isNaN(dateDelta)) return dateDelta;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function compareDevicesForSync(left, right) {
  const dateDelta = Date.parse(right.lastSeenAt || "") - Date.parse(left.lastSeenAt || "");
  if (dateDelta !== 0 && !Number.isNaN(dateDelta)) return dateDelta;
  return String(left.deviceId || "").localeCompare(String(right.deviceId || ""));
}

function compareEventsForSync(left, right) {
  const dateDelta = Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "");
  if (dateDelta !== 0 && !Number.isNaN(dateDelta)) return dateDelta;
  const sequenceDelta = Number(left.sequence || 0) - Number(right.sequence || 0);
  if (sequenceDelta !== 0) return sequenceDelta;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function createState({ tasks, devices, migrations }) {
  return {
    schema: STORE_SCHEMA,
    version: CURRENT_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    migrations,
    tasks,
    devices,
    events: [],
    identities: [],
    pairingGrants: [],
    changes: []
  };
}

function migrateState(value) {
  validateStateEnvelope(value);
  if (value.version > CURRENT_VERSION) {
    throw new Error(`Unsupported PhoneDex store version: ${value.version}`);
  }

  const migrations = Array.isArray(value.migrations) ? value.migrations : [];
  if (value.version < CURRENT_VERSION) {
    migrations.push({
      at: new Date().toISOString(),
      from: `${STORE_SCHEMA}.v${value.version}`,
      to: STORE_SCHEMA,
      reason: "store-version-upgrade"
    });
  }

  const state = {
    ...value,
    schema: STORE_SCHEMA,
    version: CURRENT_VERSION,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    migrations,
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    devices: Array.isArray(value.devices) ? value.devices : [],
    events: Array.isArray(value.events) ? value.events : [],
    identities: Array.isArray(value.identities) ? value.identities : [],
    pairingGrants: Array.isArray(value.pairingGrants) ? value.pairingGrants : [],
    changes: Array.isArray(value.changes) ? value.changes : []
  };
  validateState(state);
  return state;
}

function validateStateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PhoneDex store must be an object");
  }
  if (value.schema !== STORE_SCHEMA) {
    throw new Error(`PhoneDex store schema must be ${STORE_SCHEMA}`);
  }
  if (!Number.isInteger(value.version) || value.version < 0) {
    throw new Error("PhoneDex store version must be a non-negative integer");
  }
}

function validateState(state) {
  validateStateEnvelope(state);
  if (!Array.isArray(state.tasks) || !Array.isArray(state.devices) || !Array.isArray(state.events) ||
      !Array.isArray(state.identities) || !Array.isArray(state.pairingGrants) ||
      !Array.isArray(state.changes)) {
    throw new Error("PhoneDex store tasks, devices, events, identities, pairing grants, and changes must be arrays");
  }
  if (!Array.isArray(state.migrations)) {
    throw new Error("PhoneDex store migrations must be an array");
  }
  for (const [index, record] of state.tasks.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`PhoneDex task at index ${index} must be an object`);
    }
  }
  for (const [index, record] of state.devices.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`PhoneDex device at index ${index} must be an object`);
    }
  }
  for (const [index, record] of state.events.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`PhoneDex event at index ${index} must be an object`);
    }
  }
  for (const [index, record] of state.identities.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`PhoneDex identity at index ${index} must be an object`);
    }
  }
  for (const [index, record] of state.pairingGrants.entries()) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`PhoneDex pairing grant at index ${index} must be an object`);
    }
  }
  let previousPosition = 0;
  for (const [index, change] of state.changes.entries()) {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new Error(`PhoneDex sync change at index ${index} must be an object`);
    }
    if (!Number.isInteger(change.position) || change.position <= previousPosition) {
      throw new Error(`PhoneDex sync change at index ${index} has an invalid position`);
    }
    if (!["task", "device", "event"].includes(change.kind)) {
      throw new Error(`PhoneDex sync change at index ${index} has an invalid kind`);
    }
    if (typeof change.id !== "string" || !change.id) {
      throw new Error(`PhoneDex sync change at index ${index} must have an id`);
    }
    if (typeof change.deleted !== "boolean") {
      throw new Error(`PhoneDex sync change at index ${index} must have a deleted flag`);
    }
    if (!change.deleted && (!change.record || typeof change.record !== "object")) {
      throw new Error(`PhoneDex sync change at index ${index} must have a record`);
    }
    previousPosition = change.position;
  }
}

function migrateLegacyFiles(dataDir) {
  const tasks = readLegacyJsonl(path.join(dataDir, "tasks.jsonl"), addTaskProtocolFields);
  const devicesState = readLegacyJsonFile(path.join(dataDir, "devices.json"), { devices: [] });
  const devices = Array.isArray(devicesState.devices)
    ? devicesState.devices
      .filter((device) => device && typeof device === "object" && !Array.isArray(device))
      .map((device) => safeNormalize(device, addDeviceProtocolFields))
      .filter(Boolean)
    : [];
  const migratedFiles = [];
  if (fs.existsSync(path.join(dataDir, "tasks.jsonl"))) migratedFiles.push("tasks.jsonl");
  if (fs.existsSync(path.join(dataDir, "devices.json"))) migratedFiles.push("devices.json");

  return {
    tasks,
    devices,
    migrations: migratedFiles.length > 0
      ? [{
          at: new Date().toISOString(),
          from: "legacy-jsonl",
          files: migratedFiles,
          taskCount: tasks.length,
          deviceCount: devices.length
        }]
      : []
  };
}

function readLegacyJsonl(filePath, normalizer) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return safeNormalize(JSON.parse(line), normalizer);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function safeNormalize(value, normalizer) {
  try {
    return normalizer(value);
  } catch {
    return null;
  }
}

function readLegacyJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

  while (true) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, "owner"), `${process.pid}\n`, { mode: 0o600 });
      return () => fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for PhoneDex store lock");
      Atomics.wait(waitBuffer, 0, 0, 10);
    }
  }
}

function syncDirectory(directory) {
  try {
    const fd = fs.openSync(directory, "r");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
  } catch {
    // Directory fsync is not supported on every platform; file fsync still applies.
  }
}

module.exports = {
  CURRENT_VERSION,
  STORE_FILE,
  STORE_SCHEMA,
  createPhoneDexStore
};
