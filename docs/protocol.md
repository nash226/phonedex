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

### Capability and protocol negotiation

The native client sends `X-PhoneDex-Protocol-Version: 1` and declares the
capabilities it needs with `X-PhoneDex-Capabilities`. The hub includes the
negotiated version and its supported capabilities in every `/sync` response:

```json
{
  "protocol": {
    "negotiatedVersion": 1,
    "supportedVersions": [1],
    "capabilities": [
      { "schema": "phonedex.capability.v1", "protocolVersion": 1,
        "id": "sync.snapshot", "version": "1", "scope": "device", "supported": true }
    ]
  }
}
```

An unsupported requested protocol version, or a required capability the hub
does not advertise, fails closed with HTTP `426` and either
`code: "protocol_incompatible"` or `code: "capability_unsupported"`; the
response lists supported protocol versions or bounded missing capabilities
without echoing credentials or task content. Device heartbeats retain
legacy string flags in `capabilities` and add validated `capabilityDetails`
records so older agents remain readable while iPhone can render only actions
the agent has declared.

### Supported Codex adapter boundary

Each Mac or Windows PhoneDex agent reports a content-free
`phonedex.adapter.v1` descriptor in `/health` and in its device heartbeat. The
descriptor identifies the selected supported continuation mode (`cli` or
`app-server`, with macOS-only foreground paste explicitly experimental), its
ready/unavailable state, versioned capability records, and bounded limitations.
It never reports private Codex Desktop UI state, credentials, executable paths,
or unsupported lifecycle controls. An unavailable or unsupported adapter marks
`task.reply.v1` unavailable so the iPhone can explain why a continuation
cannot be sent instead of presenting a false control. Mac and Windows share
the same adapter contract; platform-specific behavior is selected by the
adapter, not inferred by the iPhone.

### Secure pairing

The hub CLI creates a short-lived pairing grant with:

```sh
npm run pair:create -- --name "Nash iPhone"
```

The hub owner may grant a narrower or administrative allowlisted scope set when
needed, for example `--scopes tasks.read,privacy.read,privacy.manage,admin`.
Unknown scopes are rejected rather than silently broadened or ignored.

The command prints a random grant and a separate six-digit verification code.
The grant is valid for ten minutes by default and can be redeemed once at
`POST /pair`:

```json
{
  "grant": "opaque-one-time-grant",
  "verificationCode": "123456",
  "deviceName": "Nash iPhone",
  "platform": "ios"
}
```

The hub stores only SHA-256 hashes of the grant, verification code, and
returned device credential. A successful response returns the credential once
and includes a `phonedex.identity.v1` public identity with scoped permissions:
phones receive `tasks.read` and `tasks.reply`; agents receive the ingest and
heartbeat scopes needed by the existing local agent contract. Paired clients
send the credential only as an `Authorization: Bearer` header. Query-string
credentials are not accepted for paired identities. Invalid, expired, reused,
and rate-limited attempts return bounded errors without echoing secrets.

The hub enforces the identity scopes on every paired request. Read scopes cover
task, device, and sync projections; `tasks.reply` and `tasks.ingest` are
separate command and agent-write permissions; `privacy.read` and
`privacy.manage` protect privacy inspection and mutation; and `admin` is an
explicit broad administrative grant. Approval scope is reserved for the
versioned approval command when that M5 capability exists and is never inferred
from a phone or agent role.

This slice establishes the pairing grant, device-bound credential path, and
least-privilege authorization boundary. Credential rotation, hub/agent TLS
deployment, and removal of legacy query-token compatibility remain separate
security work.

### Completion capture convergence

Task records may include `messageId`, `logicalEventId`, and `captureSources`.
The bridge derives `logicalEventId` as a one-way, bounded identifier from the
source device, Codex session, and completion message identity. It is not a
credential and does not contain task text or a local path. `captureSources`
contains at most eight bounded entries such as `codex-stop-hook` and
`codex-session-watch`, with an optional message identity and observation time.
The hook and session watcher can therefore represent one completion as one
task even when both paths observe it or when either path arrives first. Older
records without these fields continue to use the existing session/text/time
duplicate fallback.

## v1 records

| Schema | Required identity | Purpose |
| --- | --- | --- |
| `phonedex.task.v1` | `id`, `createdAt`, `origin`, `status` | A tracked Codex run and its current summary. |
| `phonedex.event.v1` | `id`, `taskId`, `createdAt`, `sequence`, `type`, `data` | Ordered task activity suitable for cursor sync. |
| `phonedex.device.v1` | `deviceId`, `machineName`, `platform`, `role`, `status`, `lastSeenAt` | Reachability, installed-agent identity, and separately reported component health. |
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

Device records retain the legacy `status` field as the reachability value and
may add an additive `health` object:

```json
{
  "health": {
    "reachability": "online",
    "agent": "healthy",
    "adapter": "unknown"
  }
}
```

`reachability` uses `online`, `stale`, `missing`, `revoked`, or `unknown`.
`agent` and `adapter` use `healthy`, `degraded`, `unhealthy`, or `unknown`.
The current bridge can prove that its agent process is healthy when its
heartbeat is running, but it does not claim Codex adapter health until a
supported adapter reports it; older heartbeats therefore decode as unknown.

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

### Legacy compatibility adapter

During migration, older agents and notification clients may continue using
`GET /tasks`, `POST /tasks`, `GET /devices`, `GET /replies`, and `POST /reply`.
The bridge imports legacy `tasks.jsonl` and `devices.json` into the durable
store, keeps those files as mirrors for local tooling, and exposes the legacy
task projection from the durable store rather than treating JSONL as a second
source of truth. A legacy ingested task receives a new hub task id while its
caller-provided id is retained as `originTaskId` for reply routing.

Legacy reply forms may authenticate with a body or query token and may omit the
new command envelope fields; the adapter supplies command and idempotency
identities, writes the legacy `replies.jsonl` mirror, and returns the same
versioned delivery receipt used by native clients. New clients should use the
bearer-authenticated `/sync` and `/reply` contracts and must not put tokens in
URLs.

### Reply commands and delivery receipts

Native iPhone replies use the existing versioned command envelope at the
`/reply` compatibility route. The request includes a client-generated
`commandId`, an opaque `idempotencyKey`, the `expectedTaskVersion`, and the
requested `task.reply.v1` capability. The bridge appends the command and its
receipts to `commands.jsonl` and `command-receipts.jsonl`; the legacy
`replies.jsonl` mirror remains available for existing agents.

The bridge rejects a reply whose expected task version is no longer current
with HTTP `409` and `code: "task_stale"`, returning the sanitized current task
for review. A failed origin forward remains retryable with the same
idempotency key. A completed command returns `state: "completed"`; a repeated
request returns `state: "duplicate"` without forwarding the reply again.
Requests that reuse an idempotency key for another task fail with
`idempotency_conflict`.

The iPhone writes pending reply commands into its AES-GCM encrypted local cache
before attempting transport. Offline and timeout failures remain queued, and
reconnection retries the exact command identity. Stale replies are removed
from the outbox and shown as a review-needed failure rather than being
silently applied to newer task context. Legacy hubs that return no receipt are
treated as accepted only through the compatibility adapter.

### Structured questions

A task may include an optional bounded `question` object when its status is
`needs_input`:

```json
{
  "id": "deploy-target",
  "prompt": "Where should the release go?",
  "choices": [
    { "id": "staging", "label": "Deploy to staging" },
    { "id": "production", "label": "Deploy to production" }
  ],
  "allowsFreeText": true
}
```

Question ids and choice ids are task-scoped. A response adds `questionId` and
exactly one response to the normal reply command: either
`{"kind":"choice","choiceId":"staging"}` or
`{"kind":"text","text":"..."}`. The bridge rejects missing, stale, or
unavailable choices before forwarding, and records the structured response in
the durable command payload and receipt. Mac and Windows agents receive the
same versioned envelope; the supported CLI/app-server adapter translates the
selected answer into the originating task continuation without automating a
private desktop UI.
