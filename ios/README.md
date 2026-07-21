# PhoneDex iOS App

For the complete cross-platform toolchain matrix, see
[`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md).

This is the native iPhone path for PhoneDex. It owns the branded notification
surface, lets you scroll longer Codex results, and posts typed or dictated
replies back to the PhoneDex bridge.

The iOS app scaffold includes:

- A SwiftUI app target for requesting notification permission and sending a
  local preview notification.
- Bridge URL settings stored on-device; the bridge token is stored in the
  device-only Keychain. Existing tokens from the legacy `UserDefaults` setting
  are migrated once and removed.
- Configuration URLs may set the bridge endpoint, but never import a token;
  enter credentials in Settings so they stay in Keychain.
- A complete task-history fetcher that builds the project navigator from the
  PhoneDex bridge `/tasks` endpoint.
- A notification content extension for category `PHONEDEX_TASK`.
- A scrollable expanded notification body styled around the PhoneDex README
  mockup.
- Native actions for `Okay, what's next`, `Let's do that`, and dictated or
  typed custom replies.
- Notification action handling that posts replies back to the bridge `/reply`
  endpoint.
- Notification metadata contains task routing context only; reply actions read
  the bridge credential from the device-only Keychain and authenticate with an
  `Authorization: Bearer` header.
- An adaptive command-center shell with Chats, Projects, Browser, Devices,
  and Settings tabs.
- A Projects navigator that keeps matching workspace names distinct per device
  and opens each conversation in its reply-capable detail view.
- One conversation row per Codex session, with replies bound to both the latest
  task id and session id so side chats cannot silently cross-route.
- A task conversation view with quick actions, a persistent custom composer,
  and visible reply delivery errors.
- A native diff review surface for bounded agent-exported patches, with file
  navigation, lazy line rendering, line numbers, copy, share, and truncation
  guidance.
- Capability-backed approval and rejection controls require Face ID or device
  passcode by default, with an accessible Settings override and passcode
  fallback; the bridge receipt remains the source of truth for success.
- Chats scopes for Needs You, Running, and Recent, with searchable title,
  transcript, workspace, machine, branch, and repository context plus machine
  and workspace filters. Unknown legacy task statuses remain visible in Recent.
- A native WebKit browser for documentation, pull requests, and research
  without leaving PhoneDex.
- Settings can clear the encrypted local task/review projection, including
  drafts, receipts, offline commands, diagnostics, and downloaded artifacts,
  while preserving the paired bridge credential in Keychain. This is a local
  reset only and does not delete hub history or revoke the pairing.

## Generate The Xcode Project

Install XcodeGen if needed:

```sh
brew install xcodegen
```

Check the local Mac setup:

```sh
npm run ios:doctor
```

Install compatible full Xcode if `ios:doctor` reports it missing:

```sh
npm run ios:install-xcode
```

This currently pins Xcode 26.3 because this Mac is on macOS Sequoia 15.6.x.
Apple's latest App Store Xcode may require macOS Tahoe. The install command can
prompt for your Apple ID and macOS admin password because Apple gates older
Xcode downloads and `/Applications` installs.

`xcodes` may install the app as `/Applications/Xcode-26.3.0.app` instead of
`/Applications/Xcode.app`. The helper detects either path. If you install Xcode
somewhere else, set `PHONEDEX_XCODE_APP=/path/to/Xcode.app`.

If you already downloaded the compatible Xcode `.xip` from Apple, install from
that local file instead:

```sh
./scripts/ios-dev.sh install-xcode ~/Downloads/Xcode_26.3.xip
```

`ios:doctor` also reports whether a Fastlane session is configured. If
`FASTLANE_SESSION` is present, `xcodes` can use it instead of stopping at the
interactive Apple ID prompt.

Generate and open the project:

```sh
npm run ios:open
```

The generated `PhoneDex` scheme includes the `PhoneDexTests` simulator unit
test target and the `PhoneDexUITests` shell test target. With full Xcode
selected, list available simulator destinations and run the scheme tests with:

```sh
xcodebuild -project ios/PhoneDex.xcodeproj -scheme PhoneDex -showdestinations
xcodebuild -project ios/PhoneDex.xcodeproj -scheme PhoneDex \
  -destination 'platform=iOS Simulator,name=<available iPhone>,OS=<available version>' \
  test
```

The unit tests cover app launch, protocol decoding, filtering, cache,
diagnostics, settings, and reply behavior. The UI tests verify that the five
primary destinations and Settings controls remain accessible at the largest
Dynamic Type size, with Reduce Motion and dark appearance traits exercised.
The shell test suite also runs Xcode's system accessibility audit in that
configuration so contrast, clipping, and unsupported fixed-size text regressions
fail before release. Xcode 26.3 currently emits contrast and Dynamic Type audit
findings for SwiftUI's system Form/search surfaces in this shell; those known
SDK-owned findings are filtered by their stable descriptions while clipping and
all other audit findings still fail the test.

The notification extension uses stable localization keys for its empty-content
fallbacks and scales its header, title, and body with the user's Dynamic Type
setting. Its rendered title and body are also exposed as separate accessibility
labels. `npm run test:ios-notification-extension-contract` guards this boundary
without treating source-level checks as a substitute for real-device
Notification Center and VoiceOver validation.

Run the `PhoneDex` iOS app on a device or simulator, allow notifications, and
tap `Send Preview Notification`. Expand the delivered notification to test the
scrollable PhoneDex UI.

To test against the real bridge, set:

- Bridge URL: `http://YOUR_MAC_LAN_IP:8765`
- Token: the value of `WATCH_BRIDGE_TOKEN` from `.env`

Then tap `Fetch Latest Task`, followed by `Notify Latest Task`. The delivered
notification uses the native PhoneDex notification content extension and its
actions post back to `/reply`.

Use the Mac's LAN IP, not `127.0.0.1`, when running on a real iPhone.

## Current Scope

This native path can fetch local bridge tasks and post replies back to the
bridge. Native remote push wakeup is still in progress; until then, open the
app to fetch the latest hub task or use Pushcut as an optional webhook
fallback.
