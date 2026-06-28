#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
GUI_DOMAIN="gui/$(id -u)"
LABEL="com.nash226.watchdex.homeassistant-tunnel"
PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
LOG="$ROOT/.local/cloudflared-homeassistant.log"
CLOUDFLARED="${CLOUDFLARED:-/opt/homebrew/bin/cloudflared}"

usage() {
  cat <<'EOF'
Usage:
  scripts/home-assistant-remote-tunnel.sh install
  scripts/home-assistant-remote-tunnel.sh start
  scripts/home-assistant-remote-tunnel.sh stop
  scripts/home-assistant-remote-tunnel.sh status
  scripts/home-assistant-remote-tunnel.sh url

This uses Cloudflare Quick Tunnel to expose local Home Assistant at:
  http://127.0.0.1:8123

Quick Tunnel URLs are temporary trycloudflare.com URLs. Use a named tunnel or
Tailscale for a stable long-term remote address.
EOF
}

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

write_plist() {
  if [[ ! -x "$CLOUDFLARED" ]]; then
    echo "cloudflared not found at $CLOUDFLARED. Run: brew install cloudflared" >&2
    exit 1
  fi

  mkdir -p "$LAUNCH_AGENTS_DIR" "$ROOT/.local"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$CLOUDFLARED")</string>
    <string>tunnel</string>
    <string>--no-autoupdate</string>
    <string>--url</string>
    <string>http://127.0.0.1:8123</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG")</string>
</dict>
</plist>
EOF
  plutil -lint "$PLIST"
  echo "Wrote $PLIST"
}

bootout_if_loaded() {
  launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
}

print_url() {
  local url
  url="$(grep -Eo 'https://[-a-zA-Z0-9.]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$url" ]]; then
    echo "No trycloudflare.com URL found yet. Check: $LOG" >&2
    return 1
  fi
  echo "$url"
}

case "${1:-}" in
  install)
    write_plist
    bootout_if_loaded
    : > "$LOG"
    launchctl bootstrap "$GUI_DOMAIN" "$PLIST"
    launchctl kickstart -k "$GUI_DOMAIN/$LABEL"
    ;;

  start)
    launchctl bootstrap "$GUI_DOMAIN" "$PLIST" 2>/dev/null || true
    launchctl kickstart -k "$GUI_DOMAIN/$LABEL"
    ;;

  stop)
    bootout_if_loaded
    ;;

  status)
    launchctl print "$GUI_DOMAIN/$LABEL" 2>/dev/null || true
    ;;

  url)
    print_url
    ;;

  ""|help|-h|--help)
    usage
    ;;

  *)
    usage >&2
    exit 2
    ;;
esac
