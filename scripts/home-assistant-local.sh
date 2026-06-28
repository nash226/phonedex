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
  scripts/home-assistant-local.sh start
  scripts/home-assistant-local.sh doctor

Environment:
  PYTHON_BIN                  Python executable to use. Defaults to python3.
  HOME_ASSISTANT_LOCAL_VENV   Virtualenv path. Defaults to .local/homeassistant-venv.
  HOME_ASSISTANT_LOCAL_CONFIG Config path. Defaults to .local/homeassistant-config.
EOF
}

command="${1:-}"

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
