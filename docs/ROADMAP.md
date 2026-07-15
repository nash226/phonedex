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
- [ ] Add PR templates for validation evidence and human decisions.
- [ ] Document supported development versions for Node, Xcode, iOS, macOS, and
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

## M1: Versioned Hub and Durable State

Status: **Queued**

Outcome: replace the notification-shaped JSONL API with a durable task, event,
device, and command control plane while retaining migration from current data.

- [x] Define versioned schemas for tasks, events, devices, workspaces,
  capabilities, commands, and command receipts.
- [x] Introduce a transactional embedded store with migrations and backup.
- [ ] Add snapshot-plus-cursor sync with pagination, tombstones, and stable
  ordering.
- [ ] Converge hook and session-watcher captures into one logical task event.
- [ ] Separate device reachability, agent health, and Codex adapter health.
- [ ] Add capability negotiation and protocol compatibility errors.
- [ ] Add retention, redaction, export, and deletion controls.
- [ ] Preserve a compatibility adapter for current `/tasks` and `/reply`
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

## M2: Secure Identity and Pairing

Status: **Queued**

Outcome: remove shared bearer-token setup from the production path.

- [ ] Create revocable identities for phone, hub, and computer agents.
- [ ] Implement short-lived, single-use pairing grants with verification codes.
- [ ] Add scoped permissions for read, reply, approve, and administration.
- [ ] Move iOS credentials from `UserDefaults` to Keychain.
- [ ] Remove credentials from URLs, notification metadata, logs, and support
  output.
- [ ] Require TLS in release configuration and remove arbitrary ATS loads.
- [ ] Implement rotation, revoke, replay defense, rate limits, and audit events.
- [ ] Add a threat model and automated security regression tests.

Exit gate: acceptance scenarios 1, 7, 12, and 13 pass, and a fresh install can
pair and recover without copying a durable secret.

## M3: Native iPhone Core

Status: **Queued**

Outcome: replace the utility screen with a polished, offline-aware native app.

- [ ] Establish a design system using semantic color, native materials,
  Dynamic Type, stable spacing, motion, and accessibility primitives.
- [ ] Build four-tab navigation: Inbox, Workspaces, Devices, and Settings.
- [ ] Build Inbox scopes for Needs You, Running, and Recent with search and
  filters.
- [ ] Add a durable encrypted local cache, cursor sync, and freshness state.
- [ ] Build task detail with transcript, structured events, evidence, and a
  keyboard-safe composer.
- [ ] Preserve drafts and reading position; announce new activity without
  jumping scroll position.
- [ ] Build explicit loading, empty, stale, offline, revoked, incompatible, and
  partial-failure states.
- [ ] Add reply delivery receipts, retry, stale-version handling, and encrypted
  outbox behavior.
- [ ] Add native device/workspace details and actionable diagnostics.
- [ ] Cover core workflows with unit, snapshot where useful, UI, VoiceOver,
  largest Dynamic Type, Reduce Motion, and dark/light appearance tests.

Exit gate: acceptance scenarios 2, 3, 5, 6, 11, and 14 pass against a real hub
with at least one supported computer.

## M4: Supported Codex Control Adapters

Status: **Queued**

Outcome: make remote controls truthful, versioned, idempotent, and portable
across Mac and Windows.

- [ ] Define the adapter boundary and capability test suite.
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
