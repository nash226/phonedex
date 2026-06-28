#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${HOME_ASSISTANT_LOCAL_VENV:-$ROOT/.local/homeassistant-venv}"
CONFIG_DIR="${HOME_ASSISTANT_LOCAL_CONFIG:-$ROOT/.local/homeassistant-config}"

usage() {
  cat <<'EOF'
Usage:
  scripts/home-assistant-local.sh install
  scripts/home-assistant-local.sh init-config
  scripts/home-assistant-local.sh start
  scripts/home-assistant-local.sh doctor

Environment:
  PYTHON_BIN                  Python executable to use. Defaults to python3.
  HOME_ASSISTANT_LOCAL_VENV   Virtualenv path. Defaults to .local/homeassistant-venv.
  HOME_ASSISTANT_LOCAL_CONFIG Config path. Defaults to .local/homeassistant-config.
EOF
}

command="${1:-}"

write_minimal_config() {
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/configuration.yaml" <<'EOF'
homeassistant:
  name: WatchDex Local
  latitude: 40.7128
  longitude: -74.0060
  elevation: 10
  unit_system: us_customary
  time_zone: America/New_York

http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 127.0.0.1
    - ::1

frontend:

api:

mobile_app:

automation: !include automations.yaml
script: !include scripts.yaml
EOF
  [[ -f "$CONFIG_DIR/automations.yaml" ]] || printf '[]\n' > "$CONFIG_DIR/automations.yaml"
  [[ -f "$CONFIG_DIR/scripts.yaml" ]] || printf '{}\n' > "$CONFIG_DIR/scripts.yaml"
  [[ -f "$CONFIG_DIR/scenes.yaml" ]] || printf '[]\n' > "$CONFIG_DIR/scenes.yaml"
  echo "Wrote minimal Home Assistant config to $CONFIG_DIR"
}

case "$command" in
  install)
    mkdir -p "$CONFIG_DIR"
    if [[ ! -x "$VENV_DIR/bin/python" ]]; then
      "$PYTHON_BIN" -m venv "$VENV_DIR"
    fi
    "$VENV_DIR/bin/python" -m pip install --upgrade pip wheel
    "$VENV_DIR/bin/python" -m pip install --upgrade homeassistant
    echo "Home Assistant Core installed in $VENV_DIR"
    ;;

  init-config)
    write_minimal_config
    ;;

  start)
    if [[ ! -x "$VENV_DIR/bin/hass" ]]; then
      echo "Home Assistant is not installed yet. Run scripts/home-assistant-local.sh install first." >&2
      exit 1
    fi
    mkdir -p "$CONFIG_DIR"
    exec "$VENV_DIR/bin/hass" --config "$CONFIG_DIR" --open-ui
    ;;

  doctor)
    "$PYTHON_BIN" --version
    if [[ -x "$VENV_DIR/bin/hass" ]]; then
      "$VENV_DIR/bin/hass" --version
    else
      echo "Home Assistant is not installed in $VENV_DIR"
    fi
    echo "Config: $CONFIG_DIR"
    ;;

  ""|help|-h|--help)
    usage
    ;;

  *)
    usage >&2
    exit 2
    ;;
esac
