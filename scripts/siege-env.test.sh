#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
sleep 60 &
FOREIGN_PID=$!
trap 'kill "$FOREIGN_PID" 2>/dev/null || true; rm -rf "$TEST_ROOT"' EXIT
mkdir -p "$TEST_ROOT/scripts" "$TEST_ROOT/.siege/sessions"
cp "$REPO_ROOT/scripts/siege-env.sh" "$TEST_ROOT/scripts/siege-env.sh"
printf '%s' "$FOREIGN_PID" > "$TEST_ROOT/.siege/api.pid"
printf 'not-a-pid' > "$TEST_ROOT/.siege/web.pid"
printf 'keep' > "$TEST_ROOT/.siege/sessions/sentinel"
printf 'SIEGE_WEB_PORT=13217\n' > "$TEST_ROOT/.env.siege"
OUTPUT="$(bash "$TEST_ROOT/scripts/siege-env.sh" status)"
[[ "$OUTPUT" == *"api stopped"* && "$OUTPUT" == *"web stopped"* && "$OUTPUT" == *"13217/siege/"* ]]
bash "$TEST_ROOT/scripts/siege-env.sh" down
kill -0 "$FOREIGN_PID"
[[ "$(cat "$TEST_ROOT/.siege/sessions/sentinel")" == "keep" ]]
[[ ! -e "$TEST_ROOT/.siege/api.pid" && ! -e "$TEST_ROOT/.siege/web.pid" ]]
bash -n "$REPO_ROOT/scripts/siege-env.sh"
printf 'SIEGE environment lifecycle checks passed\n'
