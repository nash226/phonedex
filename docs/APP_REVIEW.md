# PhoneDex App Review notes

This is the release-candidate note set for App Review. Replace the bracketed
release metadata only after signing, entitlements, notification behavior, and
the real-device matrix have been verified by the release owner.

## Product and network model

PhoneDex is a native iPhone client for a user-managed PhoneDex hub. The hub
runs on the user's Mac or another user-controlled host, and the iPhone connects
over the local network or a private VPN. The hub stores task, device, command,
and bounded review data locally; PhoneDex does not require a vendor-hosted
relay for the core workflow.

The app does not remote-control the desktop UI, read files from the iPhone, or
claim access to a private Codex Desktop API. A participating Mac or Windows
computer runs its own PhoneDex agent and reports through documented PhoneDex
contracts. Each task retains its originating machine, workspace identity, and
supported capability set.

## Review account and test path

Provide App Review with a dedicated test hub and paired test device using the
release build. Do not put a durable hub token, pairing credential, source code,
or private repository path in these notes or in screenshots.

- Build: `[version and build]`
- Review hub URL or private-network instructions: `[release-owner supplied]`
- Test device pairing instructions: `[release-owner supplied]`
- Test Mac and Windows machines: `[release-owner supplied]`
- Support contact: `[security/support contact]`

The reviewer should be able to:

1. Pair the app with a single-use grant and see the hub and device state.
2. Read a completed task with machine and workspace context.
3. Send a reply and see its accepted, duplicate, stale, or failed receipt.
4. Review bounded changed-file and validation metadata exported by an agent.
5. Use only controls advertised by the originating Mac or Windows adapter.
6. Revoke the test phone from the hub and see the app explain the recovery.

## Privacy and safety explanation

PhoneDex requests network access to communicate with the user-managed hub.
Task text and review content are not sent to vendor infrastructure by the
native client; they remain on the user-managed hub. Notification metadata is
routing context; it is not a durable
authentication credential. The app reloads its paired credential from device
protected storage when an action is handled.

Commands are versioned, task-bound, idempotent, and capability-gated. Approval
decisions require the configured device-owner authentication policy. Unsupported
desktop actions are hidden or explained rather than simulated. App Review
should not expect arbitrary terminal execution, private Codex Desktop UI
automation, or account-wide task discovery without an installed agent.

## Background and notification behavior

The current release candidate treats foreground reconciliation and durable hub
state as authoritative. A notification or future push is an awareness hint;
loss or delay must not lose a task or execute a command twice. Notification
permission is optional, and denying it does not prevent foreground use.

APNs provider credentials, production push environments, and background delivery
behavior remain release-owner gates. They must be filled in from the selected
privacy and provider decision before this document is used for a production
submission.

## Known limitations to disclose

- The app requires a reachable user-managed hub and an agent on each computer
  that should report work.
- The supported adapter contracts cover Mac and Windows CLI/app-server modes;
  the macOS foreground paste fallback is explicitly experimental.
- Simulator validation does not prove real-device notifications, Face ID,
  local-network permission prompts, battery behavior, or Windows installation.
- Production TLS, Apple signing, TestFlight configuration, APNs, and the
  real-device matrix are not implied by an unsigned simulator build.

## Release-owner checklist

- [ ] Placeholder fields above are replaced only in the release copy.
- [ ] Privacy answers match the implemented local storage, network, and
  notification behavior.
- [ ] Review credentials and test data are isolated from real work.
- [ ] A reviewer can complete the six test steps without undocumented APIs.
- [ ] Known limitations and the support contact are visible to the reviewer.
