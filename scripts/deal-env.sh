#!/usr/bin/env bash
set -euo pipefail

DEAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEAL_RUNTIME="$DEAL_ROOT/.deal"
mkdir -p "$DEAL_RUNTIME/tmp" "$DEAL_RUNTIME/logs"
if [ -f "$DEAL_ROOT/.env.deal" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$DEAL_ROOT/.env.deal"
  set +a
fi
export DEAL_API_PORT="${DEAL_API_PORT:-18106}"
export DEAL_WEB_PORT="${DEAL_WEB_PORT:-13106}"
export DEAL_DATA_DIR="${DEAL_DATA_DIR:-$DEAL_RUNTIME/sessions}"
export DEAL_LISTEN_ADDR="127.0.0.1:$DEAL_API_PORT"
export DEAL_ASSETS_DIR="$DEAL_ROOT/apps/deal/dist"
export GOCACHE="${GOCACHE:-$DEAL_RUNTIME/go-cache}"
export GOTMPDIR="$DEAL_RUNTIME/tmp"

owned_pid() {
  local component="$1" file="$DEAL_RUNTIME/$1.pid" pid command
  [ -f "$file" ] || return 1
  pid="$(cat "$file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$component:$command" in
    api:*"$DEAL_RUNTIME/deal-server"*) printf '%s' "$pid" ;;
    web:*"$DEAL_ROOT/apps/deal/node_modules/vite/bin/vite.js"*) printf '%s' "$pid" ;;
    *) return 1 ;;
  esac
}

status() {
  local component pid
  for component in api web; do
    if pid="$(owned_pid "$component")"; then printf 'DEAL %s running (pid %s)\n' "$component" "$pid"; else printf 'DEAL %s stopped\n' "$component"; fi
  done
  if owned_pid api >/dev/null; then
    node -e 'fetch(process.argv[1]).then(async r=>{if(!r.ok) throw new Error("health failed"); const s=await r.json(); console.log(`Mode: ${s.mode}; model ready: ${s.ready}; scenario: ${s.scenario_version}`)}).catch(()=>process.exit(1))' "http://127.0.0.1:$DEAL_API_PORT/api/deal/status"
  fi
  printf 'Game: http://127.0.0.1:%s/deal/\nData: %s\n' "$DEAL_WEB_PORT" "$DEAL_DATA_DIR"
}

down() {
  local component pid
  for component in web api; do
    if pid="$(owned_pid "$component")"; then
      kill "$pid"
      for _ in $(seq 1 80); do if ! kill -0 "$pid" 2>/dev/null; then break; fi; sleep .2; done
      if kill -0 "$pid" 2>/dev/null; then printf 'DEAL %s is still shutting down\n' "$component" >&2; return 1; fi
    fi
    rm -f "$DEAL_RUNTIME/$component.pid"
  done
}

up() {
  if owned_pid api >/dev/null && owned_pid web >/dev/null; then status; return; fi
  if owned_pid api >/dev/null || owned_pid web >/dev/null; then down; fi
  node -e 'const net=require("net"); Promise.all(process.argv.slice(1).map(p=>new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(Number(p),"127.0.0.1",()=>s.close(resolve))}))).catch(e=>{console.error("DEAL port unavailable:",e.message);process.exit(1)})' "$DEAL_API_PORT" "$DEAL_WEB_PORT"
  if [ ! -f "$DEAL_ROOT/apps/deal/node_modules/vite/bin/vite.js" ]; then printf 'Install dependencies: pnpm install --filter @auro/deal...\n' >&2; exit 1; fi
  (cd "$DEAL_ROOT/server" && go build -o "$DEAL_RUNTIME/deal-server" ./cmd/deal)
  launch api "$DEAL_ROOT/server" "$DEAL_RUNTIME/deal-server"
  launch web "$DEAL_ROOT/apps/deal" node "$DEAL_ROOT/apps/deal/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port "$DEAL_WEB_PORT"
  for _ in $(seq 1 60); do
    if node -e 'Promise.all(process.argv.slice(1).map(u=>fetch(u).then(r=>{if(!r.ok) throw new Error("not ready")}))).catch(()=>process.exit(1))' "http://127.0.0.1:$DEAL_API_PORT/api/deal/status" "http://127.0.0.1:$DEAL_WEB_PORT/deal/" >/dev/null 2>&1; then status; return; fi
    sleep .5
  done
  printf 'DEAL did not start. Read .deal/logs/api.log and .deal/logs/web.log\n' >&2
  down
  exit 1
}

launch() {
  local component="$1" cwd="$2"
  shift 2
  node - "$DEAL_RUNTIME/$component.pid" "$DEAL_RUNTIME/logs/$component.log" "$cwd" "$@" <<'NODE'
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
  *) printf 'Usage: deal-env.sh up|status|down\n' >&2; exit 1 ;;
esac
