# PhoneDex protocol contract

PhoneDex uses versioned, additive records at the hub boundary. The canonical
JavaScript definitions live in [`lib/phonedex-protocol.js`](../lib/phonedex-protocol.js)
and are covered by `npm run test:protocol`.

Every new record includes:

```json
{
  "schema": "phonedex.task.v1",
  "protocolVersion": 1
}
```

Legacy JSONL records remain readable during migration. The bridge now stamps
new task and device records with their v1 identity while retaining legacy
fields such as `at`, `deviceId`, and `machineName` for existing iOS and agent
clients. Unknown fields are ignored by validation so newer hubs can add
optional data without breaking older clients; an unknown schema or protocol
version is rejected rather than guessed.

## v1 records

| Schema | Required identity | Purpose |
| --- | --- | --- |
| `phonedex.task.v1` | `id`, `createdAt`, `origin`, `status` | A tracked Codex run and its current summary. |
| `phonedex.event.v1` | `id`, `taskId`, `createdAt`, `sequence`, `type`, `data` | Ordered task activity suitable for cursor sync. |
| `phonedex.device.v1` | `deviceId`, `machineName`, `platform`, `role`, `status`, `lastSeenAt` | Reachability and installed-agent identity. |
| `phonedex.workspace.v1` | `workspaceId`, `deviceId`, `name`, `createdAt` | Durable repository or working-directory context. |
| `phonedex.capability.v1` | `id`, `version`, `scope`, `supported` | Honest adapter capability negotiation. |
| `phonedex.command.v1` | `commandId`, `createdAt`, `kind`, `target`, `idempotencyKey`, `state`, `payload` | A phone-issued lifecycle or reply request. |
| `phonedex.command-receipt.v1` | `commandId`, `createdAt`, `state` | Durable transport/agent acknowledgement. |

The defined v1 fields contain no bearer token, password, cookie, or private
Codex Desktop UI field. Legacy compatibility fields may still exist in local
records, so `publicTask` must continue to remove credentials before an API
response. URLs and local paths are optional metadata and must be filtered
according to the retention and privacy policy before leaving the user's
devices.

The hub exposes `GET /sync` as the versioned snapshot-plus-cursor contract.
Clients send an authenticated bearer token and an optional opaque `v1.` cursor
with a bounded `limit` (1–100, default 50). A fresh request returns a stable,
deterministically ordered snapshot page of tasks and devices. The returned
cursor continues snapshot pagination; the hub rejects a page request with
`409 sync_snapshot_changed` if the durable store changed between pages. Once
the snapshot is complete, the same cursor advances through ordered changes.
Each change identifies its kind, stable id, position, and replacement record;
deletions are represented by a record-free tombstone. A client can apply a
change more than once by position/id without treating duplicate delivery as a
new task.

Sync responses use this envelope:

```json
{
  "schema": "phonedex.sync.v1",
  "protocolVersion": 1,
  "snapshot": { "complete": true, "tasks": [], "devices": [] },
  "changes": [],
  "cursor": "v1.opaque-value",
  "hasMore": false
}
```

The legacy `/tasks` and `/devices` endpoints remain available to older agents
and notification clients during migration. The hub persists task and device
records through a versioned transactional snapshot, including the durable
change journal. The snapshot is replaced atomically, the prior version is
retained as a backup, and existing JSONL/device files are imported on first
start and kept as a compatibility mirror for local tooling. A failed or
corrupt current snapshot is recovered from the backup only when the backup
validates; future store versions fail closed instead of being silently
downgraded.

The native iPhone client stores the last complete task/device projection and
the opaque cursor in an AES-GCM encrypted cache. Its 256-bit cache key is a
device-only Keychain item and the cache file uses iOS data protection. A
rejected or changed cursor causes a fresh snapshot bootstrap; legacy endpoint
fallbacks deliberately clear the durable cursor so compatibility data cannot be
mistaken for an acknowledged sync position.
