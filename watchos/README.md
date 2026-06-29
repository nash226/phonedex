# WatchDex Watch App

This is the native Apple Watch path for WatchDex. It talks directly to the
WatchDex bridge instead of relying on Home Assistant notification text input.

## Current MVP

- Fetches recent WatchDex tasks from `/tasks`.
- Sends canned replies to `/reply`.
- Sends custom text from a Watch text field to `/reply`.
- Stores the bridge URL and token in watchOS user defaults.

## Build

This Mac needs full Xcode, not only Command Line Tools.

After Xcode is installed:

```sh
brew install xcodegen
cd watchos
xcodegen generate
open WatchDexWatch.xcodeproj
```

In Xcode:

1. Select the `WatchDex Watch App` scheme.
2. Choose your Apple Watch or a watchOS simulator.
3. Set a development team for signing.
4. Build and run.

## Configure On Watch

Use:

```text
Bridge URL: http://YOUR_MAC_LAN_IP:8765
Token: value of WATCH_BRIDGE_TOKEN from .env
```

The current local bridge URL is:

```text
http://192.168.1.189:8765
```

Future versions should add an iPhone companion setup screen so the long token
does not need to be typed on the Watch.
