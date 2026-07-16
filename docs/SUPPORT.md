# PhoneDex support runbook

This runbook is for first response to a PhoneDex user. Preserve the user's
data and identity state while diagnosing. Never request a hub token, Keychain
credential, pairing URL, task transcript, source file, or private local path in
email, chat, screenshots, or a support ticket.

## Severity and response

| Severity | Example | First response |
| --- | --- | --- |
| S0 | Suspected credential disclosure, unauthorized command, or data loss | Stop command activity, revoke the affected phone/agent, preserve content-free audit evidence, and page the security contact. |
| S1 | An acknowledged command is missing, duplicated, or stuck without a recovery state | Preserve the hub directory, stop writers if corruption is suspected, and use [RECOVERY.md](RECOVERY.md). |
| S2 | One device is stale, replies fail, or sync is offline | Collect the safe diagnostics below and follow the device-specific checks. |
| S3 | Setup question, cosmetic issue, or unsupported capability | Explain the supported contract and link the relevant product limitation. |

## Safe intake

Ask for:

- PhoneDex app version, iOS version, hub version, Node version, and Mac or
  Windows version.
- Approximate UTC time, affected device name, workspace label, and task id if
  the user can share those identifiers safely.
- The visible state (`loading`, `stale`, `offline`, `revoked`, `incompatible`,
  `partial`, or `failed`) and the suggested recovery action.
- Whether the issue affects reads, replies, managed runs, approvals, artifact
  downloads, or only notifications.

Do not ask for task content to diagnose transport, identity, capability, or
latency problems. If a transcript is genuinely needed, obtain the user's
explicit consent and use the minimum redacted excerpt through an approved
security channel.

## Content-free diagnostics

On the hub, run the authenticated diagnostics and device checks with the
operator's existing local credentials:

```sh
curl -fsS -H "Authorization: Bearer $WATCH_BRIDGE_TOKEN" \
  "$WATCH_BRIDGE_PUBLIC_URL/diagnostics"
npm run devices
npm run devices:verify
```

Record the correlation id, component state, latency/error class, protocol
version, and capability identifiers. Do not paste task text, prompts, headers,
tokens, URLs containing credentials, workspace roots, or artifact bytes into a
ticket. A healthy result can still report `unknown` for an unsupported adapter;
that is not evidence of a hub outage.

## Device and connectivity checks

### iPhone

1. Confirm the phone can reach the configured hub over the local network or
   private VPN.
2. Open PhoneDex and pull to reconcile. Treat the hub's durable state as
   authoritative when a notification is delayed or absent.
3. If the app says `revoked`, pair again with a fresh single-use grant; do not
   reuse an old invite or ask the user to paste a durable token into a URL.
4. If it says `incompatible`, update the app or hub only after checking the
   protocol and capability versions in diagnostics.
5. If a reply is pending, keep the app open long enough to receive its receipt.
   A duplicate retry must reuse the existing idempotency identity.

### macOS

1. Confirm the PhoneDex service is running as the same user that can read the
   Codex session files.
2. Run `npm run agent:self-test`, then inspect `npm run devices` on the hub.
3. For the experimental foreground paste fallback only, confirm Accessibility
   permission and the foreground Codex app. CLI/app-server capabilities remain
   the supported path.
4. If the hub is healthy but the device is stale, restart the agent after
   preserving any relevant content-free logs and check the heartbeat again.

### Windows

1. Confirm Node.js 18.x or 22.x is on `PATH` for the same user that owns the
   Scheduled Task and can read local Codex session files.
2. Run `npm run windows:status` and `npm run agent:self-test`.
3. Confirm the PhoneDex task starts at logon and that the hub reports the
   device as `online`, not merely `task-only`.
4. Do not troubleshoot by enabling a Windows foreground UI automation path;
   it is intentionally unsupported. Use the advertised CLI/app-server
   capability or hand off to the desktop.

## Recovery and security incidents

For migration, corruption, rollback, or suspected lost state, stop all writers
and follow [RECOVERY.md](RECOVERY.md). Do not overwrite the failed data
directory. For a suspected credential leak or unauthorized command, revoke the
phone/agent first, preserve the complete local backup, and escalate to the
security contact with only audit correlation ids and timestamps.

## Escalation record

Use this content-free template:

```text
Severity:
UTC time window:
App / hub / agent versions:
Platform and device role:
Affected capability:
Visible state:
Correlation ids:
Diagnostics component states:
Steps already tried:
Data preserved and location:
Next owner:
```

Support cannot approve a new private API, hosted relay, destructive deletion,
credential handling change, or production signing configuration. Route those
requests to a `needs-human-decision` issue with the evidence and options.
