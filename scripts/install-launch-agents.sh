#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
GUI_DOMAIN="gui/$(id -u)"

HA_LABEL="com.nash226.watchdex.homeassistant"
BRIDGE_LABEL="com.nash226.watchdex.bridge"
SESSION_WATCH_LABEL="com.nash226.watchdex.session-watch"
LEGACY_HA_LABEL="com.nash226.codex-watch.homeassistant"
LEGACY_BRIDGE_LABEL="com.nash226.codex-watch.bridge"

HA_PLIST="$LAUNCH_AGENTS_DIR/$HA_LABEL.plist"
BRIDGE_PLIST="$LAUNCH_AGENTS_DIR/$BRIDGE_LABEL.plist"
SESSION_WATCH_PLIST="$LAUNCH_AGENTS_DIR/$SESSION_WATCH_LABEL.plist"

usage() {
  cat <<'EOF'
Usage:
  scripts/install-launch-agents.sh install
  scripts/install-launch-agents.sh start
  scripts/install-launch-agents.sh stop
  scripts/install-launch-agents.sh status

The installer writes user LaunchAgents for:
  - local Home Assistant Core on port 8123
  - WatchDex on port 8765
  - WatchDex session watcher for missed Codex Stop hooks
EOF
}

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

write_plists() {
  mkdir -p "$LAUNCH_AGENTS_DIR" "$ROOT/.local"

  cat > "$HA_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$HA_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$ROOT/.local/homeassistant-venv/bin/hass")</string>
    <string>--config</string>
    <string>$(xml_escape "$ROOT/.local/homeassistant-config")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>DYLD_LIBRARY_PATH</key>
    <string>/opt/homebrew/lib:/usr/local/lib</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$ROOT/.local/launchd-homeassistant.out.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$ROOT/.local/launchd-homeassistant.err.log")</string>
</dict>
</plist>
EOF

  cat > "$BRIDGE_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$BRIDGE_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>$(xml_escape "$ROOT/bin/codex-watch.js")</string>
    <string>server</string>
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
  <string>$(xml_escape "$ROOT/.local/launchd-bridge.out.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$ROOT/.local/launchd-bridge.err.log")</string>
</dict>
</plist>
EOF

  cat > "$SESSION_WATCH_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SESSION_WATCH_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>$(xml_escape "$ROOT/bin/codex-watch.js")</string>
    <string>watch-sessions</string>
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
  <string>$(xml_escape "$ROOT/.local/launchd-session-watch.out.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$ROOT/.local/launchd-session-watch.err.log")</string>
</dict>
</plist>
EOF

  plutil -lint "$HA_PLIST" "$BRIDGE_PLIST" "$SESSION_WATCH_PLIST"
  echo "Wrote $HA_PLIST"
  echo "Wrote $BRIDGE_PLIST"
  echo "Wrote $SESSION_WATCH_PLIST"
}

bootout_if_loaded() {
  local label="$1"
  launchctl bootout "$GUI_DOMAIN/$label" >/dev/null 2>&1 || true
}

bootstrap() {
  launchctl bootstrap "$GUI_DOMAIN" "$HA_PLIST" 2>/dev/null || true
  launchctl bootstrap "$GUI_DOMAIN" "$BRIDGE_PLIST" 2>/dev/null || true
  launchctl bootstrap "$GUI_DOMAIN" "$SESSION_WATCH_PLIST" 2>/dev/null || true
}

kickstart() {
  launchctl kickstart -k "$GUI_DOMAIN/$HA_LABEL" 2>/dev/null || true
  launchctl kickstart -k "$GUI_DOMAIN/$BRIDGE_LABEL" 2>/dev/null || true
  launchctl kickstart -k "$GUI_DOMAIN/$SESSION_WATCH_LABEL" 2>/dev/null || true
}

case "${1:-}" in
  install)
    write_plists
    bootout_if_loaded "$HA_LABEL"
    bootout_if_loaded "$BRIDGE_LABEL"
    bootout_if_loaded "$SESSION_WATCH_LABEL"
    bootout_if_loaded "$LEGACY_HA_LABEL"
    bootout_if_loaded "$LEGACY_BRIDGE_LABEL"
    bootstrap
    kickstart
    ;;

  start)
    bootstrap 2>/dev/null || true
    kickstart
    ;;

  stop)
    bootout_if_loaded "$HA_LABEL"
    bootout_if_loaded "$BRIDGE_LABEL"
    bootout_if_loaded "$SESSION_WATCH_LABEL"
    ;;

  status)
    launchctl print "$GUI_DOMAIN/$HA_LABEL" 2>/dev/null || true
    launchctl print "$GUI_DOMAIN/$BRIDGE_LABEL" 2>/dev/null || true
    launchctl print "$GUI_DOMAIN/$SESSION_WATCH_LABEL" 2>/dev/null || true
    ;;

  ""|help|-h|--help)
    usage
    ;;

  *)
    usage >&2
    exit 2
    ;;
esac
