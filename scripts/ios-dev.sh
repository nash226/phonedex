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
  scripts/ios-dev.sh install-xcode [path-to-Xcode.xip]
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
    echo "XcodeGen: $(xcodegen version)"
  else
    echo "XcodeGen: missing. Install with: brew install xcodegen"
    ok=1
  fi

  if command -v xcodes >/dev/null 2>&1; then
    echo "xcodes: $(xcodes version)"
  else
    echo "xcodes: missing. Install with: brew install xcodes"
    ok=1
  fi

  if [[ -n "${FASTLANE_SESSION:-}" ]]; then
    echo "Fastlane session: configured"
  else
    echo "Fastlane session: not configured; xcodes may prompt for Apple ID"
  fi

  if xcrun --find simctl >/dev/null 2>&1; then
    echo "Simulator tools: available"
  else
    echo "Simulator tools: unavailable until full Xcode is selected"
  fi

  if xcrun --find devicectl >/dev/null 2>&1; then
    echo "Device tools: available"
  else
    echo "Device tools: unavailable until full Xcode is selected"
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

  if [[ -n "${1:-}" ]]; then
    local xip_path="$1"
    if [[ ! -f "$xip_path" ]]; then
      echo "Xcode .xip not found: $xip_path" >&2
      exit 1
    fi

    echo "Installing Xcode $COMPATIBLE_XCODE_VERSION from $xip_path."
    echo "This may prompt for your macOS admin password."
    xcodes install "$COMPATIBLE_XCODE_VERSION" --path "$xip_path" --select --empty-trash
    return
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
    install_xcode "${2:-}"
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
