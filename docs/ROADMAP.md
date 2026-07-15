# PhoneDex Delivery Roadmap

Status: Active execution plan  
Last reviewed: 2026-07-15  
Canonical requirements: [Product foundation](PRODUCT.md)

This roadmap turns the PhoneDex product requirements into small, independently
reviewable pull requests. The [README](../README.md) describes what works now;
this file controls what autonomous workers build next.

## Operating Rules

- Choose one highest-value unchecked slice whose dependencies are complete.
- Do not mark a slice complete without linking test or verification evidence in
  the pull request and updating this file when milestone state changes.
- Prefer supported Codex contracts behind an adapter boundary. Private APIs and
  foreground UI automation cannot become production dependencies.
- Preserve the local-first hub and per-computer agent model.
- Keep security work on the critical path. UI polish does not outrank identity,
  transport, command safety, or durable state.
- Never create commits solely to create activity. If all useful work is blocked,
  use the human-decision queue instead.

## Release Definition

PhoneDex 1.0 is complete only when all 15 acceptance scenarios in
[PRODUCT.md](PRODUCT.md#16-acceptance-scenarios) pass on real supported devices,
the production-readiness gates are satisfied, and no release-blocking decision
or defect remains open.

Milestone labels:

- **Current**: available in the repository today.
- **Next**: the default source of autonomous worker tasks.
- **Queued**: ordered but dependent on earlier contracts.
- **Human gate**: needs credentials, policy, product judgment, or external setup.

## M0: Foundation and Continuous Delivery

Status: **Next**

Outcome: every later change has a stable product contract, reproducible build,
tests, and a trustworthy small-PR path.

- [x] Canonical product requirements and production acceptance scenarios.
- [x] Ordered delivery roadmap suitable for autonomous small PRs.
- [x] Add GitHub Actions for Node checks and all bridge test scripts.
- [x] Add a reproducible unsigned iOS simulator build job.
- [x] Add an iOS unit-test target and one smoke test for app launch/model decode.
- [x] Add PR templates for validation evidence and human decisions.
- [x] Document supported development versions for Node, Xcode, iOS, macOS, and
  Windows.

Exit gate: pull requests cannot merge with failing required checks, and both
the bridge and iOS prototype build from a clean checkout.

Verification evidence for the completed Node CI slice: `.github/workflows/node-ci.yml`
runs `npm run check` and `npm test` on Node 18 and 22 for pull requests and
`main` pushes. `npm test` covers all seven bridge fixture scripts.

Verification evidence for the completed iOS test-target slice: `ios/project.yml`
defines the `PhoneDexTests` simulator unit-test target and `PhoneDex` scheme;
`ios/PhoneDexTests/PhoneDexSmokeTests.swift` initializes the app entry point and
decodes a representative `/tasks` payload. On 2026-07-15, Xcode 26.3 passed
the scheme on an iPhone 17 iOS 26.3.1 simulator with 1/1 tests passing.

Verification evidence for the completed iOS simulator build slice:
`.github/workflows/ios-ci.yml` builds the committed `PhoneDex` scheme on the
pinned `macos-15` runner with a generic iOS Simulator destination and code
signing disabled, so pull requests and `main` pushes validate the app without
Apple credentials or a named simulator device.

Verification evidence for the completed development-matrix slice:
`docs/DEVELOPMENT.md` records the Node 18.x/22.x CI matrix, the Xcode 26.3 and
macOS Sequoia 15.6 native build baseline, the iOS 17.0 deployment target, and
the documented Windows agent prerequisites and validation limits. It links the
exact bridge and unsigned simulator commands used by CI and points platform
specific setup docs at the same source of truth.

Verification evidence for the completed PR-template slice:
`.github/pull_request_template.md` requires each change to name exactly one
roadmap slice, record Node/iOS/manual validation evidence, review reliability,
accessibility, appearance, security, privacy, and cross-platform effects, and
either confirm that no human decision is needed or link a
`needs-human-decision` issue with the decision record and unblocking condition.

## M1: Versioned Hub and Durable State

Status: **Queued**

Outcome: replace the notification-shaped JSONL API with a durable task, event,
device, and command control plane while retaining migration from current data.

- [x] Define versioned schemas for tasks, events, devices, workspaces,
  capabilities, commands, and command receipts.
- [x] Introduce a transactional embedded store with migrations and backup.
- [x] Add snapshot-plus-cursor sync with pagination, tombstones, and stable
  ordering.
- [x] Converge hook and session-watcher captures into one logical task event.
- [x] Separate device reachability, agent health, and Codex adapter health.
- [x] Add capability negotiation and protocol compatibility errors.
- [x] Add retention, redaction, export, and deletion controls.
- [x] Preserve a compatibility adapter for current `/tasks` and `/reply`
  clients during migration.

Exit gate: restart, duplicate delivery, pagination, migration, and rollback
tests prove no task or acknowledged command is silently lost.

Verification evidence for the completed schema slice: `lib/phonedex-protocol.js`
defines and validates the seven `phonedex.*.v1` record types, while
`scripts/test-protocol.js` covers valid task, event, device, workspace,
capability, command, and receipt records plus rejected protocol versions,
unknown schemas, invalid command states, and missing targets. New bridge task
and device records carry the v1 identity without removing legacy JSONL fields.

Verification evidence for the completed store slice: `lib/phonedex-store.js`
atomically replaces a versioned `phonedex-store.json` snapshot, retains the
previous snapshot as `phonedex-store.json.bak`, serializes writers with a
recoverable lock, upgrades older store versions, and imports legacy
`tasks.jsonl` and `devices.json` state without deleting those files.
`scripts/test-store.js` covers migration, backup contents, corruption recovery,
and version upgrades; the bridge uses the store for task deduplication and
device heartbeat upserts while preserving the legacy file mirror.

Verification evidence for the completed sync slice: `lib/phonedex-sync.js` and
`lib/phonedex-store.js` define bounded opaque cursors, deterministic snapshot
pages, revision-checked continuation, ordered replacement changes, and
tombstones. The authenticated `/sync` endpoint in `bin/codex-watch.js` filters
credentials and private local paths from responses while retaining `/tasks` and
`/devices` compatibility. `scripts/test-sync.js` covers pagination, stream
changes, tombstones, invalid cursors, and snapshot mutation detection. The iOS
client consumes the paginated contract in `PhoneDexBridgeClient` and its unit
tests cover bearer-authenticated pagination and decoding.

Verification evidence for the completed capture-convergence slice:
`lib/phonedex-protocol.js` derives a bounded `logicalEventId` from the source
device, Codex session, and completion message identity, and records bounded
`captureSources` provenance. `bin/codex-watch.js` extracts message identity from
Stop-hook payloads, applies the same identity to session-watcher records, and
merges duplicate captures in either arrival order without forwarding or
notifying twice. `lib/phonedex-store.js` records a replacement sync change only
when new capture provenance is merged; an unchanged duplicate does not advance
the store revision. `scripts/test-session-watch.js` exercises hook-first and
watcher-first convergence, while the protocol and store fixtures cover bounded
identity and no-op transactions.

Verification evidence for the completed device-health slice:
`lib/phonedex-protocol.js` normalizes the additive `phonedex.device.v1.health`
object while retaining legacy `status`; local Mac/Windows-compatible bridge
heartbeats report agent-process health and leave unsupported Codex adapter
health as `unknown`, and the hub forwards explicit component health through
`/devices` and `/sync`. `PhoneDexDeviceDetailView` renders separate,
accessible reachability, PhoneDex agent, and Codex adapter states. Node
protocol/sync fixtures and `PhoneDexDiagnosticsTests` cover normalization,
public sync filtering, degraded agent health, and honest unknown adapter state.

Verification evidence for the completed capability-negotiation slice:
`lib/phonedex-protocol.js` validates versioned capability records while keeping
legacy device flags readable, and `/sync` negotiates protocol version 1 through
`X-PhoneDex-Protocol-Version`, returning HTTP 426 with a bounded compatibility
error for unsupported versions. Sync responses expose the hub capability set;
the iOS client sends its required contract, preserves explicit incompatibility
states, and `PhoneDexDeviceDetailView` renders each agent's declared action
capability with accessible available/unavailable status. `scripts/test-protocol.js`,
`scripts/test-sync-server.js`, `PhoneDexBridgeClientTests`, and
`PhoneDexDiagnosticsTests` cover normalization, negotiation, fail-closed errors,
legacy compatibility, and device presentation.

Verification evidence for the completed privacy-controls slice:
`lib/phonedex-privacy.js` defines the `phonedex.privacy.v1` policy/export
contract, redacts credentials and local paths from exports, applies an explicit
bounded retention window across durable tasks and activity logs, and requires
`DELETE_PHONEDEX_HISTORY` before deleting task history. The authenticated
`/privacy`, `/privacy/export`, `/privacy/retention`, and `/privacy/delete`
endpoints work for the shared Mac/Windows-compatible hub;
`PHONEDEX_RETENTION_DAYS` can enforce a configured startup policy.
`scripts/test-privacy.js` covers export redaction, retention, authentication,
confirmation failures, history deletion, and device inventory preservation.

Verification evidence for the completed compatibility-adapter slice:
`bin/codex-watch.js` keeps legacy `/tasks`, `/devices`, `/replies`, and `/reply`
routes backed by the transactional store and command receipts while retaining
body-token and query-token authentication only for older clients. Legacy
`tasks.jsonl` and `devices.json` files migrate on first access, legacy task
ingestion preserves the caller's id as `originTaskId`, and legacy replies are
mirrored into `replies.jsonl` with the versioned command/receipt records. The
adapter survives a hub restart without losing the durable projection.
`scripts/test-compatibility.js` covers migration, legacy task listing and
ingestion, snapshot visibility, form-encoded reply delivery, reply listing,
device listing, and restart persistence.

## M2: Secure Identity and Pairing

Status: **Queued**

Outcome: remove shared bearer-token setup from the production path.

- [ ] Create revocable identities for phone, hub, and computer agents.
- [x] Implement short-lived, single-use pairing grants with verification codes.
- [ ] Add scoped permissions for read, reply, approve, and administration.
- [x] Move iOS credentials from `UserDefaults` to Keychain.
- [ ] Remove credentials from URLs, notification metadata, logs, and support
  output.
- [ ] Require TLS in release configuration and remove arbitrary ATS loads.
- [ ] Implement rotation, revoke, replay defense, rate limits, and audit events.
- [x] Add a threat model and automated security regression tests.

Exit gate: acceptance scenarios 1, 7, 12, and 13 pass, and a fresh install can
pair and recover without copying a durable secret.

Verification evidence for the completed iOS credential-storage slice:
`ios/PhoneDexApp/PhoneDexCredentialStore.swift` stores the bridge token as a
device-only Keychain generic-password item with
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. `PhoneDexSettings` migrates
the legacy `phonedex.token` UserDefaults value once, removes the legacy value,
and exposes a generic, non-secret error when secure storage fails.
`ios/PhoneDexTests/PhoneDexSettingsTests.swift` covers migration, updates,
clearing, failure redaction, and Keychain round trips; the concrete Keychain
round trip is skipped only when an unsigned simulator reports its expected
missing entitlement. Notification payload credential removal is now covered by
the native notification metadata builder and bridge reply integration fixture;
the pairing flow below builds on the same Keychain credential path. The native app reads the Keychain
credential when handling a notification action and the bridge accepts the
authenticated header while retaining legacy body-token compatibility.

Verification evidence for the completed threat-model and security-regression
slice: `docs/THREAT_MODEL.md` records PhoneDex assets, trust boundaries,
security invariants, current mitigations, known legacy-token/TLS gaps, and
human-gated release blockers. `lib/phonedex-privacy.js` provides the shared
bounded text redactor; public task projections, provider responses, and
persisted error logs apply it before exposure. `scripts/test-security.js`
proves credential-shaped text is redacted, structured secrets and private
paths are absent from `/tasks`, `/sync`, and privacy responses, and query-token
authentication is rejected by the privacy surface. Existing Swift settings
tests cover native Keychain migration, credential-bearing URL rejection, and
notification metadata.

Verification evidence for the completed pairing-grant slice: `pair:create`
creates a ten-minute grant and separate six-digit verification code; `POST
/pair` rate-limits attempts, rejects invalid/expired/reused grants, stores only
hashes, and atomically creates a scoped `phonedex.identity.v1` record. Paired
phone credentials authorize `/sync`, `/tasks`, `/devices`, and `/reply` only
through the bearer header and cannot be placed in a query token. The native
iPhone Settings flow redeems the grant and stores the returned credential in
Keychain. `scripts/test-pairing.js` and
`PhoneDexBridgeClientTests.testRedeemPairingUsesOneTimeGrantWithoutCredentialInRequest`
cover the end-to-end contract, failed verification, one-time use, scoped
authorization, and secret redaction. Revocation, rotation, and TLS remain
separate M2 slices.

Verification evidence for the completed Chats scope slice: the native SwiftUI
Chats surface in `ios/PhoneDexApp/ContentView.swift` provides Needs You,
Running, and Recent scopes, searchable conversation context, machine and
workspace filters, stable selection, and contextual empty states. The
`PhoneDexTaskFilter` model and `ios/PhoneDexTests/PhoneDexChatFilteringTests.swift`
cover status partitioning, legacy records, context search, combined filters,
and stable filter options.

Verification evidence for the completed iOS sync-state slice:
`ios/PhoneDexApp/PhoneDexAppModel.swift` preserves the last complete in-memory
result while distinguishing loading, stale, offline, revoked, incompatible,
partial, and generic refresh failures. `PhoneDexBridgeClient` falls back only when a
hub does not expose `/sync`, reports which legacy data set was recovered, and
keeps HTTP response bodies out of user-facing errors. `ContentView.swift`
renders accessible loading and degraded empty states plus freshness details in
Chats, Projects, Devices, and Settings. `PhoneDexBridgeClientTests.swift`
covers compatibility fallback, partial data, and transport classification;
the iOS test target also retains its smoke and diagnostics coverage.

Verification evidence for the completed encrypted cache slice:
`ios/PhoneDexApp/PhoneDexLocalCache.swift` encrypts the cached task/device
snapshot and opaque cursor with AES-GCM, stores its 256-bit key in a device-only
Keychain item, and writes the file with iOS data protection and atomic replacement.
`PhoneDexAppModel` restores cached conversations before foreground sync, applies
incremental replacements and tombstones, persists the resulting cursor, and
restarts from a fresh snapshot after an invalid or changed cursor. Legacy hubs
continue to use the explicit compatibility path without persisting a misleading
cursor. `PhoneDexLocalCacheTests.swift` covers encryption, deletion, and
tamper-fail-closed behavior; bridge client tests cover incremental changes and
stale-cursor recovery.

Verification evidence for the completed task-detail slice: `PhoneDexTask` now
decodes lifecycle timestamps, task version, and capture provenance from the
supported bridge contract. `PhoneDexTaskDetailView` presents the latest
response as a readable transcript, a normalized activity timeline, machine /
workspace / branch context, and an explicit empty state when the agent has not
exported diffs or validation results. Its composer restores per-task drafts
from the encrypted cache and offers a "Show new activity" affordance instead
of moving the reader when refreshed task metadata changes. Full session-event,
diff, and validation exports remain gated on later agent contracts.

Verification evidence for the completed reading-position slice:
`ios/PhoneDexApp/PhoneDexLocalCache.swift` stores the selected task-detail
section in the existing encrypted cache, and `ContentView.swift` restores that
logical position after relaunch without jumping when newer activity arrives.
`PhoneDexLocalCacheTests.swift` covers encrypted round-trip persistence and
reading legacy cache payloads that predate the optional position map.

Verification evidence for the completed reply-delivery slice:
`/reply` accepts a client command id, idempotency key, and expected task version;
it persists `phonedex.command.v1` entries and
`phonedex.command-receipt.v1` receipts, rejects stale context with HTTP 409,
and retries a failed origin forward without executing a completed command a
second time. `scripts/test-reply-delivery.js` covers stale rejection,
failure-then-retry, duplicate receipt handling, and no-double-forward behavior.
`PhoneDexBridgeClient` sends the same command identity on retry, while
`PhoneDexLocalCache` encrypts pending replies and `PhoneDexAppModel` restores,
queues, retries, and removes them only after a successful or duplicate receipt.
`PhoneDexLocalCacheTests.swift` covers pending-reply persistence and the
simulator iOS test suite covers receipt request/response decoding.

Verification evidence for the completed device/workspace details slice:
`ios/PhoneDexApp/PhoneDexDeviceDetailView.swift` provides read-only device
identity, heartbeat health, visible-work counts, copyable device identity, and
refresh guidance for online, stale, missing, revoked, and unknown states.
Workspace detail provides machine/path context, active and attention counts,
conversation history, and refresh state without introducing unsupported
pairing or remote-control actions. `ios/PhoneDexTests/PhoneDexDiagnosticsTests.swift`
covers state mapping, revoked-device recovery guidance, and workspace counts.

## M3: Native iPhone Core

Status: **Queued**

Outcome: replace the utility screen with a polished, offline-aware native app.

- [x] Establish the first design-system foundation using semantic color, native materials,
  Dynamic Type, stable spacing, motion, and accessibility primitives.
- [x] Build the adaptive Chats, Workspaces, Browser, Devices, and Settings shell.
- [x] Add an embedded WebKit browser with native navigation and sharing controls.
- [x] Build Chats scopes for Needs You, Running, and Recent with search and
  filters.
- [x] Add a durable encrypted local cache, cursor sync, and freshness state.
- [x] Build current-contract task detail with the latest transcript, normalized
  lifecycle/capture activity, evidence context, and a keyboard-safe composer.
- [x] Add completion detail, quick replies, a dictation-ready composer, and
  visible reply success/failure state for the current bridge contract.
- [x] Preserve composer drafts in the encrypted local cache and announce new
  activity without jumping scroll position.
- [x] Preserve task reading position across relaunch.
- [x] Build explicit loading, empty, stale, offline, revoked, incompatible, and
  partial-failure states.
- [x] Add reply delivery receipts, retry, stale-version handling, and encrypted
  outbox behavior.
- [x] Add native device/workspace details and actionable diagnostics.
- [x] Cover core workflows with unit, snapshot where useful, UI, VoiceOver,
  largest Dynamic Type, Reduce Motion, and dark/light appearance tests.

Exit gate: acceptance scenarios 2, 3, 5, 6, 11, and 14 pass against a real hub
with at least one supported computer.

Verification evidence for the completed iOS core test-coverage slice:
`ios/project.yml` defines the `PhoneDexUITests` target and includes it in the
`PhoneDex` scheme alongside the unit tests. `PhoneDexShellUITests` verifies all
five primary destinations and their accessible labels at the largest Dynamic
Type size with Reduce Motion enabled, then verifies Settings navigation and
secure credential controls in dark appearance. The committed
`.github/workflows/ios-ci.yml` now runs both the generic unsigned simulator
build and the scheme's unit/UI test action. On 2026-07-15, Xcode 26.3 passed
the two UI tests and the full scheme test action on an iPhone 17 iOS 26.3.1
simulator without signing credentials.

## M4: Supported Codex Control Adapters

Status: **Queued**

Outcome: make remote controls truthful, versioned, idempotent, and portable
across Mac and Windows.

- [x] Define the adapter boundary and capability test suite.
- [ ] Implement structured task reply and question-response commands.
- [ ] Implement task create, cancel, and retry where supported.
- [ ] Export live lifecycle events without parsing desktop UI.
- [ ] Export changed files, source-linked patches, artifacts, and validation
  receipts.
- [ ] Implement desktop handoff using stable supported task/session identity.
- [ ] Build and validate the macOS adapter matrix.
- [ ] Build and validate the Windows adapter matrix.
- [ ] Keep foreground macOS paste as an explicitly experimental fallback.
- [ ] Hide or explain every unsupported action based on negotiated capability.

Exit gate: acceptance scenarios 3, 4, 5, 9, and 10 pass on one Mac and one
Windows machine, including sleep, reconnect, update, and revoke.

Verification evidence for the completed adapter-boundary slice:
`lib/phonedex-adapter.js` defines the `phonedex.adapter.v1` descriptor and a
shared Mac/Windows capability matrix for CLI, app-server, and explicitly
experimental macOS foreground modes. The bridge includes the descriptor in
`/health`, reports its bounded state and limitations in device heartbeats, and
does not queue auto-resume when the selected adapter cannot support
`task.reply.v1`. `scripts/test-adapter.js` covers supported Mac and Windows
continuation modes, unavailable Windows foreground handoff, unknown platforms,
unsupported lifecycle controls, and descriptor validation.

## M5: Approvals and High-Risk Actions

Status: **Queued**

Outcome: safely handle consequential Codex decisions from iPhone.

- [ ] Define expiring, task-version-bound approval requests and receipts.
- [ ] Render exact operation, scope, origin, reason, risk, and expiry.
- [ ] Add explicit approve/reject controls with stale-state rejection.
- [ ] Add configurable Face ID or passcode confirmation for high-risk actions.
- [ ] Audit every decision without storing unnecessary sensitive content.
- [ ] Add adversarial replay, expiry, compromised-device, and partial-failure
  tests.

Exit gate: acceptance scenarios 7 and 8 pass and an external security review
has no unresolved critical or high findings for approval flows.

## M6: Remote Notifications and Background Sync

Status: **Queued**

Outcome: deliver timely remote awareness without treating push as durable state.

- [ ] Make a human decision on the APNs provider and privacy operating model.
- [ ] Register and revoke push destinations without exposing durable secrets.
- [ ] Use privacy-safe opaque invalidation payloads by default.
- [ ] Reconcile pushes and notification actions through the durable event and
  command stores.
- [ ] Add notification classes, grouping, per-workspace policy, and actionable
  badge counts.
- [ ] Add duplicate suppression and handled/expired notification behavior.
- [ ] Validate background opportunities, Focus modes, denied permission, poor
  connectivity, and push outage recovery on real devices.
- [ ] Evaluate Live Activities only after core push correctness is proven.

Exit gate: acceptance scenarios 4 and 12 pass; push delay or loss cannot cause
lost durable state or duplicate command execution.

## M7: Mobile Review Experience

Status: **Queued**

Outcome: let users evaluate completed work without returning to a computer.

- [ ] Build file-level change summaries and validation-result views.
- [ ] Build a virtualized native text diff viewer with file navigation,
  context expansion, copy, and share.
- [ ] Add integrity-checked artifact metadata and explicit downloads.
- [ ] Enforce retention and export policy for sensitive review content.
- [ ] Meet the 5,000-line diff performance target on the oldest supported
  iPhone.

Exit gate: acceptance scenario 10 passes with source-linked evidence and
accessible navigation.

## M8: Beta, Operations, and App Store Release

Status: **Queued**

Outcome: turn the complete system into an operable public product.

- [ ] Reproducible signing, entitlements, semantic versioning, and build
  provenance.
- [ ] Staged migration, backup, rollback, and disaster-recovery drills.
- [ ] Content-free observability with correlation IDs and component health.
- [ ] Privacy manifest, App Store privacy answers, privacy policy, retention,
  deletion, security contact, and incident-response process.
- [ ] TestFlight cohorts and real-device iOS/macOS/Windows matrix.
- [ ] Performance, battery, accessibility, localization readiness, and crash
  gates.
- [ ] App Review notes and customer support runbooks.
- [ ] Final pass of all production gates and 15 acceptance scenarios.

Exit gate: the release owner records a go decision with known limitations,
metrics, rollback plan, and verification evidence.

## Human-Decision Queue

Create or update a GitHub issue labeled `needs-human-decision` only when work
cannot safely proceed without one of the following:

- APNs provider, hosted relay, data-residency, or ongoing service-cost choice.
- Apple Developer signing, App Store Connect, certificates, credentials, or
  external account configuration.
- A product decision that changes the top-level information architecture,
  permission model, supported platforms, or acceptance criteria.
- Approval to use an undocumented/private integration or materially expand the
  security boundary.
- Destructive migration, public history rewrite, paid service, legal/privacy
  policy, or unrecoverable operation.

The issue must include the exact decision, current evidence, realistic options,
a recommendation, consequences of delay, and the condition that unblocks work.
Workers should continue with an unrelated safe slice whenever one exists.

## Worker Definition of Done

A roadmap slice is done only when:

1. The implementation and docs agree with the product requirements.
2. Focused unit/integration/UI tests cover success and meaningful failure paths.
3. Relevant repository checks and supported platform builds pass.
4. Security, privacy, accessibility, offline, and compatibility effects were
   reviewed in proportion to the change.
5. The pull request includes validation evidence and no unrelated churn.
6. Required CI is green and the PR is safely merged under `AGENTS.md`.
