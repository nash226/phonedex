#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT/ios"
PROJECT_PATH="$IOS_DIR/PhoneDex.xcodeproj"
COMPATIBLE_XCODE_VERSION="${PHONEDEX_XCODE_VERSION:-26.3}"

usage() {
  cat <<'EOF'
Usage:
  scripts/ios-dev.sh doctor
  scripts/ios-dev.sh install-xcode
  scripts/ios-dev.sh generate
  scripts/ios-dev.sh open

The native PhoneDex notification UI requires:
  - Xcode.app installed and selected
  - XcodeGen installed

This Mac is currently on macOS Sequoia 15.6.x. The latest App Store Xcode may
require macOS Tahoe, so the install helper pins Xcode 26.3 by default. Override
with PHONEDEX_XCODE_VERSION if needed.
EOF
}

has_full_xcode() {
  [[ -d /Applications/Xcode.app ]] &&
    xcode-select -p 2>/dev/null | grep -q "/Applications/Xcode.app"
}

doctor() {
  local ok=0

  if [[ -d /Applications/Xcode.app ]]; then
    echo "Xcode.app: installed"
  else
    echo "Xcode.app: missing"
    ok=1
  fi

  local selected
  selected="$(xcode-select -p 2>/dev/null || true)"
  echo "Selected developer directory: ${selected:-none}"

  if has_full_xcode; then
    xcodebuild -version
  else
    echo "Full Xcode is not selected. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    ok=1
  fi

  if command -v xcodegen >/dev/null 2>&1; then
    xcodegen version
  else
    echo "XcodeGen: missing. Install with: brew install xcodegen"
    ok=1
  fi

  if [[ -d "$PROJECT_PATH" ]]; then
    echo "Project: $PROJECT_PATH"
  else
    echo "Project: not generated yet"
  fi

  return "$ok"
}

install_xcode() {
  if ! command -v xcodes >/dev/null 2>&1; then
    echo "xcodes is missing. Install with: brew install xcodes" >&2
    exit 1
  fi

  echo "Installing Xcode $COMPATIBLE_XCODE_VERSION with xcodes."
  echo "This may prompt for your Apple ID and macOS admin password."
  echo "Apple lists Xcode 26.3 as compatible with macOS Sequoia 15.6+."
  xcodes install "$COMPATIBLE_XCODE_VERSION" --select --empty-trash
}

generate() {
  if ! command -v xcodegen >/dev/null 2>&1; then
    echo "XcodeGen is missing. Install with: brew install xcodegen" >&2
    exit 1
  fi

  (cd "$IOS_DIR" && xcodegen generate)
  echo "Generated $PROJECT_PATH"
}

open_project() {
  if [[ ! -d "$PROJECT_PATH" ]]; then
    generate
  fi
  open "$PROJECT_PATH"
}

case "${1:-}" in
  doctor)
    doctor
    ;;
  install-xcode)
    install_xcode
    ;;
  generate)
    generate
    ;;
  open)
    open_project
    ;;
  ""|help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
