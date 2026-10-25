#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT

scenario() (
  source "$root_dir/scripts/dev-env.sh"
  STATE_DIR="$test_dir/$1"
  LOG_DIR="$STATE_DIR/logs"
  ENV_FILE=.env.example
  FRONTEND_PORT=13440
  WEB_MODE=$3
  mkdir -p "$LOG_DIR"
  printf '%s\n' "$2" > "$STATE_DIR/web.mode"
  local calls="$STATE_DIR/calls"
  : > "$calls"
  FRESH_STATUS=$4
  BUILD_STATUS=$5
  curl() { return 0; }
  node() { return "$FRESH_STATUS"; }
  make() { printf 'build\n' >> "$calls"; return "$BUILD_STATUS"; }
  record_component_listener() { printf '999999'; }
  port_free() { return 0; }
  stop_component() { printf 'stop\n' >> "$calls"; }
  launch_detached() {
    printf 'launch:%s\n' "$6" >> "$calls"
    printf '999999\n' > "$(pid_file web)"
  }
  start_web > "$STATE_DIR/output" 2>&1
)

check() {
  local name=$1 current=$2 requested=$3 fresh=$4 expected=$5
  scenario "$name" "$current" "$requested" "$fresh" 0
  [ "$(cat "$test_dir/$name/calls")" = "$expected" ] || {
    echo "Unexpected launch order for $name" >&2
    cat "$test_dir/$name/calls" >&2
    exit 1
  }
}
check reuse development development 0 ""
check fresh production production 0 ""
check prepare development production 1 $'build\nstop\nlaunch:web-start'
check rebuild production production 1 $'stop\nbuild\nlaunch:web-start'
check develop production development 0 $'stop\nlaunch:web-dev'
if scenario failed-build development production 1 1; then
  echo "Expected failed production build to stop the switch" >&2; exit 1
fi
[ "$(cat "$test_dir/failed-build/calls")" = build ] || { echo "Failed build stopped the working development service" >&2; exit 1; }
if bash "$root_dir/scripts/dev-env.sh" up --web-mode invalid > "$test_dir/invalid" 2>&1; then
  echo "Invalid web mode was accepted" >&2; exit 1
fi
rg -q 'Web mode must be development or production' "$test_dir/invalid"
echo "Web mode lifecycle checks passed."
