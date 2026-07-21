# PhoneDex real-device validation

This runbook is the release-owner evidence boundary for checks that an
unsigned simulator cannot prove. It complements [`docs/DEVELOPMENT.md`](DEVELOPMENT.md)
and [`docs/RELEASE.md`](RELEASE.md).

## Before testing

Record the PhoneDex version, build number, Git revision, device and OS
versions, Xcode and Node versions, build signing mode, hub/agent protocol
versions, and disposable test workspace. Keep the record content-free: never
record tokens, pairing codes, task text, source paths, or private screenshots.
Use disposable hub data and test identities.

## iPhone matrix

Run each scenario on a real iPhone for the release candidate. Mark **pass**,
**fail**, or **not run**, and link only content-free diagnostics and a
correlation ID when available.

| Area | Scenario | Expected evidence |
| --- | --- | --- |
| Pairing | Fresh install pairs with a short-lived grant, then relaunches | Keychain credential survives relaunch; grant cannot be reused |
| Transport | Configure a non-loopback HTTP bridge | Configuration is rejected; no credential is sent |
| Sync | Load tasks online, go offline, relaunch, then reconnect | Cached state is readable, offline/stale state is honest, sync converges |
| Replies | Send, retry, and tap a handled notification action | One command receipt; duplicate action is suppressed |
| Approval | Approve/reject with Face ID or passcode; cancel authentication | No command is sent when authentication is cancelled |
| Review | Open a large diff, change Dynamic Type, rotate, copy/share, download an artifact | Navigation remains usable; verified bytes match the hub digest |
| Privacy | Lock the phone, open the app switcher, and share diagnostics | No task content, paths, or credentials appear |
| Recovery | Kill and relaunch during sync and an offline reply | No acknowledged state is lost or command duplicated |
| Accessibility | VoiceOver, largest Dynamic Type, Reduce Motion, dark and light appearance | Controls are labelled, no critical clipping, state changes are announced |

## Mac and Windows matrix

For each supported agent, use the same disposable task and verify the shared
contract: enroll and heartbeat; distinguish reachability, agent health, and
unsupported adapter health; ingest a completed task and validation result;
reply through the advertised capability; restart the hub; and exercise offline
recovery without duplicate tasks or commands.

The Windows run uses the documented Node 18.x or 22.x matrix and the same user
that can read the intended session files. Foreground macOS submission remains
an explicitly limited, permission-sensitive fallback; it is not private Codex
Desktop API parity.

## Performance, battery, and localization evidence

For the release candidate, add one content-free row per supported iPhone and
one row per Mac/Windows agent. Capture the build identity and measurement
window, but never attach task text, source files, or screenshots containing
private work.

| Gate | Exercise | Record | Pass condition |
| --- | --- | --- | --- |
| Cold launch | Terminate PhoneDex, launch with a populated encrypted cache, and open Chats | p50/p95 time to first cached Inbox plus device/OS/build | Cached Inbox appears within 2s at p95 on the oldest supported iPhone |
| Warm refresh | Foreground the app with a healthy hub and one changed task | p50/p95 time from refresh start to visible projection | The visible projection updates within 500ms at p95 after the event is received |
| Battery | Repeat foregrounding and refreshes for the documented observation window in normal and Low Power Mode | Start/end battery percentage, Low Power Mode state, refresh count, network condition, and duration | No unexpected refresh loop; automatic refresh honors the configured Low Power Mode ceiling |
| Accessibility | VoiceOver, largest supported Dynamic Type, Reduce Motion, and light/dark appearance | Pass/fail per scenario and a content-free defect ID | Every release-blocking control remains labelled, reachable, and readable without clipping |
| Localization | Run the supported locale matrix through Chats, task detail, Settings, notifications, and error states | Locale, build, missing-key count, and clipped/truncated control IDs | No missing localization keys or release-blocking truncation; English fallback is explicit when a locale is not shipped |
| Outage recovery | Interrupt hub connectivity during sync and restore it after relaunch | Offline duration, cached cursor state, command receipt IDs, and recovery result | Cached content remains readable, no command duplicates, and the next successful sync converges |

Treat a missing measurement as **not run**, never as pass. Use the simulator
and repository checks for repeatable contract evidence; use this matrix only for
device-dependent timing, battery, system UI, and outage observations. The
current native refresh policy already lengthens automatic intervals in Low Power
Mode, but that source-level behavior does not replace a real-device battery
measurement.

## Release-owner gates

These are intentionally not automated here: Apple signing, entitlements,
certificates, App Store Connect, TestFlight, APNs provider and privacy model,
final privacy/legal review, and real-device crash-free, battery, performance,
localization, and outage measurements. Record the owner, date, evidence link,
known limitation, and rollback plan for each. **Not run** is not pass; do not
check the M8 exit gate without passing evidence or an explicit release-owner
go decision with an accepted limitation.

## Safe evidence format

Attach a short table with scenario, result, environment, command/build
identity, correlation ID, and next action. Redact bearer credentials, pairing
codes, local paths, repository contents, task prompts, response text, and
artifact bytes before sharing.
