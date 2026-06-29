# PhoneDex iOS App

This is the native iPhone path for PhoneDex. It exists because Home Assistant
can deliver useful native iPhone actions, but it cannot make the notification
look like it came from a separate PhoneDex app or render a custom branded
expanded notification surface.

If the notification arrives from Home Assistant Companion, it will still look
like a Home Assistant notification. The custom PhoneDex card appears only for
notifications delivered by the native PhoneDex app with category
`PHONEDEX_TASK`.

The iOS app scaffold includes:

- A SwiftUI app target for requesting notification permission and sending a
  local preview notification.
- Bridge URL/token settings stored on-device.
- A latest-task fetcher that reads from the PhoneDex bridge `/tasks` endpoint.
- A notification content extension for category `PHONEDEX_TASK`.
- A scrollable expanded notification body styled around the PhoneDex README
  mockup.
- Native actions for `Okay, what's next`, `Let's do that`, and dictated or
  typed custom replies.
- Notification action handling that posts replies back to the bridge `/reply`
  endpoint.

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

Generate and open the project:

```sh
npm run ios:open
```

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
bridge, but it still needs device install/signing through Xcode before it can
replace Home Assistant as the daily notification provider.
