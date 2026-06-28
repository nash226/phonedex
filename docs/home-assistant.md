# Home Assistant Provider

Use this provider when you want a free Apple Watch reply path without Pushcut.

## Requirements

- Home Assistant reachable from this Mac.
- Home Assistant Companion installed on your iPhone.
- Home Assistant Watch app installed from the Apple Watch app on your iPhone.
- A Home Assistant long-lived access token.
- The bridge server running on an address your iPhone/Watch path can reach.

## Local Core Test

You can test without a VM by running Home Assistant Core locally in an ignored
Python virtualenv:

```sh
npm run ha:install
npm run ha:start
```

Then open:

```text
http://localhost:8123
```

This local setup is good for proving the notification provider. Home Assistant
OS in a VM or on dedicated hardware is still the better long-term setup if you
want add-ons, one-click updates, and an always-on smart-home hub.

## Bridge Configuration

Set these values in `.env`:

```sh
WATCH_BRIDGE_PROVIDER=home-assistant
HOME_ASSISTANT_URL=http://homeassistant.local:8123
HOME_ASSISTANT_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN
HOME_ASSISTANT_NOTIFY_SERVICE=notify.mobile_app_your_iphone
WATCH_BRIDGE_PUBLIC_URL=http://YOUR_MAC_LAN_IP:8765
WATCH_BRIDGE_HOST=0.0.0.0
```

Find the notify service in Home Assistant under **Developer Tools > Services**.
It usually looks like `notify.mobile_app_<device_name>`.

Start the bridge:

```sh
npm run server
```

Send a test notification:

```sh
npm run test-notify
```

## Home Assistant Callback Automations

Add these to Home Assistant. Replace `YOUR_MAC_LAN_IP` and
`YOUR_WATCH_BRIDGE_TOKEN` with the values from `.env`.

```yaml
rest_command:
  codex_watch_reply_okay_whats_next:
    url: "http://YOUR_MAC_LAN_IP:8765/reply?token=YOUR_WATCH_BRIDGE_TOKEN&choice=okay_whats_next"
    method: POST
    content_type: "application/json"
    payload: '{"token":"YOUR_WATCH_BRIDGE_TOKEN","choice":"okay_whats_next"}'

  codex_watch_reply_lets_do_that:
    url: "http://YOUR_MAC_LAN_IP:8765/reply?token=YOUR_WATCH_BRIDGE_TOKEN&choice=lets_do_that"
    method: POST
    content_type: "application/json"
    payload: '{"token":"YOUR_WATCH_BRIDGE_TOKEN","choice":"lets_do_that"}'

automation:
  - alias: "Codex Watch reply: okay what's next"
    mode: single
    trigger:
      - platform: event
        event_type: mobile_app_notification_action
        event_data:
          action: CODEX_WATCH_OKAY_WHATS_NEXT
    action:
      - service: rest_command.codex_watch_reply_okay_whats_next

  - alias: "Codex Watch reply: let's do that"
    mode: single
    trigger:
      - platform: event
        event_type: mobile_app_notification_action
        event_data:
          action: CODEX_WATCH_LETS_DO_THAT
    action:
      - service: rest_command.codex_watch_reply_lets_do_that
```

After tapping an action on your watch, check the bridge reply log:

```sh
npm run replies
```

## Notes

Home Assistant receives the watch action event first, then calls the bridge.
The bridge records the reply against the latest task if the callback does not
include a task id. That is good enough for one active Codex completion at a
time; a later PR can add per-notification task identifiers to the callback.
