# Codex Watch Bridge

This is a small bridge for Apple Watch-friendly Codex completion alerts:

1. Codex finishes a turn.
2. A Codex `Stop` hook runs `bin/codex-watch.js hook`.
3. The bridge sends a notification with two watch actions:
   - `Okay, what's next`
   - `Let's do that`
4. Tapping an action calls this bridge's `/reply` endpoint and records the response in `data/replies.jsonl`.

The bridge supports Pushcut and a free Home Assistant provider. A native
iOS/watchOS app would remove third-party dependencies, but it needs APNs,
signing, and more setup.

## Setup

Run:

```sh
npm run check
node ./bin/codex-watch.js setup
npm run install-hook
```

Then edit `.env`:

```sh
WATCH_BRIDGE_PROVIDER=pushcut
PUSHCUT_WEBHOOK_URL=https://api.pushcut.io/YOUR_SECRET/notifications/codex-task
WATCH_BRIDGE_PUBLIC_URL=http://YOUR_MAC_LAN_IP:8765
WATCH_BRIDGE_HOST=0.0.0.0
```

Use a public HTTPS tunnel, such as Cloudflare Tunnel or ngrok, for `WATCH_BRIDGE_PUBLIC_URL` if your watch/iPhone will not be on the same network as your Mac.

Start the reply server:

```sh
npm run server
```

In Codex, open `/hooks`, review the "Codex Watch Bridge" hook, and trust it. Codex requires trust for changed user hooks before running them.

Send a test alert:

```sh
npm run test-notify
```

View replies:

```sh
npm run replies
```

## Pushcut Notification

Create a Pushcut notification named something like `codex-task`, copy its webhook URL, and paste that into `.env`.

The bridge sends dynamic `title`, `text`, and `actions` in the Pushcut JSON body. Pushcut documents dynamic JSON support for notification text, title, input, and actions; those dynamic fields may require Pushcut Pro.

The two actions are background web requests back to:

```text
${WATCH_BRIDGE_PUBLIC_URL}/reply
```

The `WATCH_BRIDGE_TOKEN` is included in both the query string and JSON body so random callers cannot record replies.

## Home Assistant Provider

Use Home Assistant for a free Apple Watch reply path. Configure:

```sh
WATCH_BRIDGE_PROVIDER=home-assistant
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN
HOME_ASSISTANT_NOTIFY_SERVICE=notify.mobile_app_your_iphone
```

Then add the Home Assistant callback automations in
[docs/home-assistant.md](docs/home-assistant.md).

## Auto-Continuing Codex

By default, replies are recorded only. That gives us a reliable human-in-the-loop inbox before letting wrist taps start new agent work.

There is an experimental setting:

```sh
WATCH_BRIDGE_AUTO_RESUME=true
```

When enabled, a reply attempts:

```sh
codex exec resume <session-id> "<premade response>"
```

Leave this off until `data/tasks.jsonl` shows that Codex hook payloads include a usable `sessionId`.

## Manual Wrapper

You can also wrap any command:

```sh
node ./bin/codex-watch.js run -- npm test
```

When the command exits, the bridge sends the same watch notification.

## References

- Pushcut notification webhooks and Apple Watch action behavior: https://www.pushcut.io/support/notifications
- Home Assistant actionable notifications: https://companion.home-assistant.io/docs/notifications/actionable-notifications/
- Codex hooks and the `Stop` event: https://developers.openai.com/codex/hooks
- Codex user-level config and hook locations: https://developers.openai.com/codex/config-advanced
