# PhoneDex Threat Model

Status: living engineering threat model  
Last reviewed: 2026-07-15  
Scope: the local-first PhoneDex hub, Mac/Windows agents, and native iPhone
client described in [PRODUCT.md](PRODUCT.md)

## Security objective

PhoneDex should let a user inspect and direct Codex work from an iPhone while
keeping credentials, source paths, and task content on user-owned devices by
default. A request is trustworthy only when the client can identify the target
machine and task, the hub can authenticate the caller, and the UI can show an
honest delivery or failure state.

PhoneDex does not claim private Codex Desktop API access, account-wide task
discovery, or a hosted service that can be trusted with all task content.

## Assets and trust boundaries

| Asset | Boundary | Protection required |
| --- | --- | --- |
| Hub and agent credentials | iPhone Keychain, local environment, HTTP requests | Never place durable secrets in notification metadata, URLs, logs, or API responses. |
| Task text and replies | Hub store, agent process, iPhone cache | Local-first storage, authenticated transport, encrypted iPhone cache, retention and deletion controls. |
| Task identity and routing context | Hub, agent, notification action | Bind replies to task/session/device and show delivery receipts; do not infer identity from a title alone. |
| Device reachability and health | Agent heartbeat and hub projection | Separate network reachability, PhoneDex process health, and unsupported Codex adapter health. |
| Privacy policy and audit history | Hub data directory | Require explicit confirmation for retention and deletion; keep audits content-free. |

The iPhone-to-hub boundary is user-managed LAN or private VPN transport in
the current product. The hub-to-agent boundary is also user-managed. A future
hosted relay is a separate threat model and requires a human decision before
implementation.

## Threats and mitigations

| Threat | Impact | Current mitigation and regression coverage |
| --- | --- | --- |
| Credential-shaped output is returned by a task or provider | Secret disclosure through `/tasks`, `/sync`, logs, or support output | Structured secret fields are omitted; public strings, provider responses, app-server summaries, and errors use bounded redaction. `npm run test:security` exercises the API projections and redaction forms. |
| Notification actions expose a durable token | Anyone with notification metadata could reply as the user | Native notification metadata contains routing context only; the token is loaded from Keychain when the action is handled. Existing `PhoneDexSettingsTests` cover URL and metadata rejection. Legacy Pushcut query/body-token actions remain a known migration risk. |
| Query-string credentials are copied into history or analytics | Credential replay or accidental support disclosure | Native bridge and configuration URLs reject credential-bearing endpoint URLs; privacy administration requires the `Authorization` header. Legacy `/reply` and bootstrap query-token compatibility remains explicit and is not the production identity model. |
| A compromised or stale agent receives a command | Wrong-machine action or silent loss | Device health is separate from adapter health; reply commands carry task version and idempotency identity with receipts. Revocable agent identity and scoped permissions remain M2 work. |
| Hub data is copied from a device or backup | Source and conversation disclosure | iPhone cache uses device-only Keychain-backed AES-GCM; hub retention, redacted export, and confirmed deletion are available. Hub filesystem encryption and backup policy remain operator responsibilities. |
| TLS is absent on a reachable network | Credential and task interception | HTTPS is accepted and documented for production intent, but arbitrary HTTP is still supported for local development. Release TLS enforcement remains a release-blocking M2 item. |
| Replay, brute force, or token sharing | Unauthorized reads or duplicate commands | Current shared-token compatibility has bounded request parsing and idempotent reply receipts, but rotation, rate limiting, replay defense, and per-principal scopes remain unimplemented. |

## Security invariants

Changes to the bridge or iOS client must preserve these invariants:

1. No durable credential is serialized into native notification `userInfo`, an
   iPhone configuration URL, a public task/device projection, or a persisted
   diagnostic/error message.
2. A public response may contain task context needed by the client, but not
   private local paths, raw hook payloads, callback secrets, or credential-shaped
   values.
3. Unsupported protocol versions, capabilities, and device states fail closed
   or become visibly unavailable; the client must not guess a command path.
4. A retry must reuse command identity and may not execute a completed command
   a second time.
5. Privacy export is redacted, deletion is deliberate, and ordinary sync never
   deletes durable state.

## Release blockers and human gates

The following are not silently waived by this document:

- revocable phone, hub, and agent identities with scoped permissions;
- single-use pairing and verification-code recovery;
- rotation, replay defense, rate limiting, and audit events for principals;
- TLS enforcement and App Transport Security policy for release builds;
- the APNs provider, hosted relay, residency, and cost/privacy operating model;
- signing, App Store Connect, and real-device release configuration.

These items stay in the [roadmap human-decision queue](ROADMAP.md#human-decision-queue)
when implementation would require credentials, paid services, or a product or
privacy policy choice.
