# PhoneDex iOS App

This is the native iPhone path for PhoneDex. It exists because Home Assistant
can deliver useful native iPhone actions, but it cannot make the notification
look like it came from a separate PhoneDex app or render a custom branded
expanded notification surface.

The iOS app scaffold includes:

- A SwiftUI app target for requesting notification permission and sending a
  local preview notification.
- A notification content extension for category `PHONEDEX_TASK`.
- A scrollable expanded notification body styled around the PhoneDex README
  mockup.
- Native actions for `Okay, what's next`, `Let's do that`, and dictated or
  typed custom replies.

## Generate The Xcode Project

Install XcodeGen if needed:

```sh
brew install xcodegen
```

Generate and open the project:

```sh
cd ios
xcodegen generate
open PhoneDex.xcodeproj
```

Run the `PhoneDex` iOS app on a device or simulator, allow notifications, and
tap `Send Preview Notification`. Expand the delivered notification to test the
scrollable PhoneDex UI.

## Current Scope

This scaffold proves the UI surface. It does not yet replace Home Assistant as
the production notification delivery provider. The next step is wiring the app
to the bridge so it can receive or fetch completed Codex tasks and post replies
back to `/reply`.
