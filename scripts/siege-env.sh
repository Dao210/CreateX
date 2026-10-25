#!/usr/bin/env bash
set -euo pipefail

SIEGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIEGE_RUNTIME="$SIEGE_ROOT/.siege"
mkdir -p "$SIEGE_RUNTIME/tmp" "$SIEGE_RUNTIME/logs"
if [ -f "$SIEGE_ROOT/.env.siege" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SIEGE_ROOT/.env.siege"
  set +a
fi
export SIEGE_API_PORT="${SIEGE_API_PORT:-18107}"
export SIEGE_WEB_PORT="${SIEGE_WEB_PORT:-13107}"
export SIEGE_DATA_DIR="${SIEGE_DATA_DIR:-$SIEGE_RUNTIME/sessions}"
export SIEGE_LISTEN_ADDR="127.0.0.1:$SIEGE_API_PORT"
export SIEGE_ASSETS_DIR="$SIEGE_ROOT/apps/siege/dist"
export GOCACHE="${GOCACHE:-$SIEGE_RUNTIME/go-cache}"
export GOTMPDIR="$SIEGE_RUNTIME/tmp"

owned_pid() {
  local component="$1" file="$SIEGE_RUNTIME/$1.pid" pid command
  [ -f "$file" ] || return 1
  pid="$(cat "$file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$component:$command" in
    api:*"$SIEGE_RUNTIME/siege-server"*) printf '%s' "$pid" ;;
    web:*"$SIEGE_ROOT/apps/siege/node_modules/vite/bin/vite.js"*) printf '%s' "$pid" ;;
    *) return 1 ;;
  esac
}

status() {
  local component pid
  for component in api web; do
    if pid="$(owned_pid "$component")"; then printf 'SIEGE %s running (pid %s)\n' "$component" "$pid"; else printf 'SIEGE %s stopped\n' "$component"; fi
  done
  if owned_pid api >/dev/null; then
    node -e 'fetch(process.argv[1]).then(async r=>{if(!r.ok) throw new Error("health failed"); const s=await r.json(); console.log(`Mode: ${s.mode}; model ready: ${s.ready}; rules: ${s.rulesVersion}`)}).catch(()=>process.exit(1))' "http://127.0.0.1:$SIEGE_API_PORT/api/siege/status"
  fi
  printf 'Game: http://127.0.0.1:%s/siege/play/\nWorkshop: http://127.0.0.1:%s/siege/\nData: %s\n' "$SIEGE_WEB_PORT" "$SIEGE_WEB_PORT" "$SIEGE_DATA_DIR"
}

down() {
  local component pid
  for component in web api; do
    if pid="$(owned_pid "$component")"; then
      kill "$pid"
      for _ in $(seq 1 80); do if ! kill -0 "$pid" 2>/dev/null; then break; fi; sleep .2; done
      if kill -0 "$pid" 2>/dev/null; then printf 'SIEGE %s is still shutting down\n' "$component" >&2; return 1; fi
    fi
    rm -f "$SIEGE_RUNTIME/$component.pid"
  done
}

up() {
  if owned_pid api >/dev/null && owned_pid web >/dev/null; then status; return; fi
  if owned_pid api >/dev/null || owned_pid web >/dev/null; then down; fi
  node -e 'const net=require("net"); Promise.all(process.argv.slice(1).map(p=>new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(Number(p),"127.0.0.1",()=>s.close(resolve))}))).catch(e=>{console.error("SIEGE port unavailable:",e.message);process.exit(1)})' "$SIEGE_API_PORT" "$SIEGE_WEB_PORT"
  if [ ! -f "$SIEGE_ROOT/apps/siege/node_modules/vite/bin/vite.js" ]; then printf 'Install dependencies: pnpm install --filter @auro/siege...\n' >&2; exit 1; fi
  (cd "$SIEGE_ROOT/server" && go build -o "$SIEGE_RUNTIME/siege-server" ./cmd/siege)
  launch api "$SIEGE_ROOT/server" "$SIEGE_RUNTIME/siege-server"
  launch web "$SIEGE_ROOT/apps/siege" node "$SIEGE_ROOT/apps/siege/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port "$SIEGE_WEB_PORT"
  for _ in $(seq 1 60); do
    if node -e 'Promise.all(process.argv.slice(1).map(u=>fetch(u).then(r=>{if(!r.ok) throw new Error("not ready")}))).catch(()=>process.exit(1))' "http://127.0.0.1:$SIEGE_API_PORT/api/siege/status" "http://127.0.0.1:$SIEGE_WEB_PORT/siege/" >/dev/null 2>&1; then status; return; fi
    sleep .5
  done
  printf 'SIEGE did not start. Read .siege/logs/api.log and .siege/logs/web.log\n' >&2
  down
  exit 1
}

launch() {
  local component="$1" cwd="$2"
  shift 2
  node - "$SIEGE_RUNTIME/$component.pid" "$SIEGE_RUNTIME/logs/$component.log" "$cwd" "$@" <<'NODE'
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [pidFile, logFile, cwd, command, ...args] = process.argv.slice(2);
const log = fs.openSync(logFile, "w", 0o600);
const child = spawn(command, args, { cwd, detached: true, stdio: ["ignore", log, log], env: process.env });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
if (child.pid) fs.writeFileSync(pidFile, String(child.pid));
child.unref();
fs.closeSync(log);
NODE
}

case "${1:-status}" in
  up) up ;;
  status) status ;;
  down) down ;;
  *) printf 'Usage: siege-env.sh up|status|down\n' >&2; exit 1 ;;
esac
