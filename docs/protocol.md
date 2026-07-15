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

This slice defines the shared shape and compatibility rules. Pagination,
cursor storage, command delivery, and adapter-specific capability
implementations remain separate roadmap slices. The hub now persists task and
device records through a versioned transactional snapshot. The snapshot is
replaced atomically, the prior version is retained as a backup, and existing
JSONL/device files are imported on first start and kept as a compatibility
mirror for local tooling. A failed or corrupt current snapshot is recovered
from the backup only when the backup validates; future store versions fail
closed instead of being silently downgraded.
