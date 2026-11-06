#!/usr/bin/env bash
# Deployment boundaries: these tests never connect to or mutate a remote host.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/deploy/createx-host.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
reject() { if ("$@") >"$TEMP/error" 2>&1; then echo "Expected rejection: $*" >&2; exit 1; fi; }

# A port may be reused only by the exact systemd process on loopback.
ss() { printf '%s' "${LISTENERS:-}"; }
systemctl() { printf '%s' 123; }
LISTENERS=''
service_port 28080 createx-api.service
LISTENERS='LISTEN 0 4096 127.0.0.1:28080 0.0.0.0:* users:(("server",pid=123,fd=3))'
service_port 28080 createx-api.service
LISTENERS='LISTEN 0 4096 127.0.0.1:28080 0.0.0.0:* users:(("other",pid=456,fd=3))'
reject service_port 28080 createx-api.service
LISTENERS='LISTEN 0 4096 0.0.0.0:28080 0.0.0.0:* users:(("server",pid=123,fd=3))'
reject service_port 28080 createx-api.service
LISTENERS=$'LISTEN 0 4096 127.0.0.1:28080 0.0.0.0:* users:(("server",pid=123,fd=3))\nLISTEN 0 4096 [::]:28080 [::]:* users:(("other",pid=456,fd=3))'
reject service_port 28080 createx-api.service

printf 'Existing unrelated site\n' > "$TEMP/foreign"
reject owned_file "$TEMP/foreign"
printf '%s\n' "$MARKER" > "$TEMP/ours"
owned_file "$TEMP/ours"
ln -s "$TEMP/ours" "$TEMP/symlink"
reject owned_file "$TEMP/symlink"
valid_release 20261028T120000Z-0123456789ab-dirty
valid_release 20261028T120000Z-0123456789ab-web
valid_release 20261028T120000Z-0123456789ab-dirty-web
reject valid_release 20261028T120000Z-0123456789ab-api
reject valid_release '../../agentpage'

# Retired ledgers fail before building; fresh and partially initialized current
# databases remain deployable. Database failures must never look like emptiness.
(
  preflight() { :; }
  database_versions() { printf '%s' "$MIGRATION_VERSIONS"; }
  MIGRATION_VERSIONS=$'001_init\n588_tank_training_history'
  reject deploycheck 001_application_schema
  grep -Fq 'back up, rebuild an empty database and selectively import' "$TEMP/error"
  MIGRATION_VERSIONS=''
  deploycheck 001_application_schema >/dev/null
  MIGRATION_VERSIONS=$'001_application_schema\n002_current_index'
  deploycheck 001_application_schema >/dev/null

  mkdir "$TEMP/migrations"
  touch "$TEMP/migrations/001_application_schema.up.sql" "$TEMP/migrations/002_current_index.up.sql"
  require_database_versions "$TEMP/migrations"
  MIGRATION_VERSIONS=$'001_application_schema\n003_newer_index'
  reject require_database_versions "$TEMP/migrations"
  MIGRATION_VERSIONS=$'001_application_schema\n../../foreign'
  reject require_database_versions "$TEMP/migrations"
  database_versions() { return 42; }
  reject deploycheck 001_application_schema
)

# A passing co-host check must not replace the failing deployment's exit code
# or leave the final output looking like a successful deployment.
(
  cohost_assert_unchanged() { echo 'Co-hosts healthy'; }
  touch "$TEMP/finish-before"
  if (finish_mutation 7 "$TEMP/finish-before" deploy) >"$TEMP/finish-output" 2>&1; then
    echo 'Expected the deployment error to survive cleanup' >&2; exit 1
  else
    [[ $? = 7 ]]
  fi
  grep -Fxq 'Createx deploy failed (exit 7)' "$TEMP/finish-output"
  [[ ! -e "$TEMP/finish-before" ]]
)

render_nginx > "$TEMP/internal"
grep -Fq 'listen 127.0.0.1:23080;' "$TEMP/internal"
if grep -Eq 'listen (80|443)|default_server|proxy_cache' "$TEMP/internal"; then echo 'Unexpected public listener or dynamic cache' >&2; exit 1; fi
render_nginx weavea.world /etc/certs/site.pem /etc/certs/site.key > "$TEMP/public"
grep -Fq 'return 308 https://weavea.world$request_uri;' "$TEMP/public"
grep -Fq 'listen 443 ssl http2;' "$TEMP/public"
grep -Fq 'proxy_set_header Upgrade $http_upgrade;' "$TEMP/public"
grep -Fq 'proxy_buffering off;' "$TEMP/public"
grep -Fq 'location ^~ /api/collect/static/' "$TEMP/public"
grep -Fq 'proxy_pass https://$createx_posthog_assets;' "$TEMP/public"
grep -Fq 'proxy_pass https://$createx_posthog_api;' "$TEMP/public"
grep -Fq 'location ^~ /api/collect/array/' "$TEMP/public"
grep -Fq 'default $remote_addr;' "$TEMP/public"
grep -Fq 'X-Forwarded-For $createx_posthog_client_ip;' "$TEMP/public"
grep -Fq 'proxy_pass_request_headers off;' "$TEMP/public"
grep -Fq 'proxy_ssl_verify on;' "$TEMP/public"
[[ "$(grep -Fc 'proxy_ssl_verify_depth 3;' "$TEMP/public")" = 6 ]]

# Origin replacement must update all four fields without touching secrets.
printf 'JWT_SECRET=keep\nFRONTEND_ORIGIN=http://localhost:23080\nCORS_ALLOWED_ORIGINS=http://localhost:23080\nAURO_APP_URL=http://localhost:23080\nAURO_PUBLIC_URL=http://localhost:23080\n' > "$TEMP/env"
sed -E 's|^(FRONTEND_ORIGIN\|CORS_ALLOWED_ORIGINS\|AURO_APP_URL\|AURO_PUBLIC_URL)=.*|\1=https://weavea.world|' "$TEMP/env" > "$TEMP/updated"
[[ "$(grep -c '=https://weavea.world$' "$TEMP/updated")" = 4 ]]
grep -Fxq 'JWT_SECRET=keep' "$TEMP/updated"

# A failed activation restores the previous pointer. On the first deployment
# it removes the failed pointer instead of creating a self-referential link.
BASE="$TEMP/releases-test"
mkdir -p "$BASE/releases/old" "$BASE/releases/new"
switch_link() { rm -f "$BASE/current"; ln -s "$1" "$BASE/current"; }
journalctl() { :; }
systemctl() {
  if [[ "$1" = restart && "$(readlink "$BASE/current")" = "$BASE/releases/new" ]]; then return 1; fi
}
wait_ready() { [[ "$(readlink "$BASE/current")" = "$BASE/releases/old" ]]; }
ln -s "$BASE/releases/old" "$BASE/current"
reject activate "$BASE/releases/new"
[[ "$(readlink "$BASE/current")" = "$BASE/releases/old" ]]
rm "$BASE/current"
reject activate "$BASE/releases/new"
[[ ! -L "$BASE/current" ]]

# A web-only update requires a current full release to carry the API binaries.
BASE="$TEMP/web-only-test"
mkdir -p "$BASE/releases"
reject current_release
mkdir -p "$BASE/releases/old"
printf 'release=old\ncommit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' > "$BASE/releases/old/manifest"
ln -s "$BASE/releases/old" "$BASE/current"
[[ "$(current_release)" = "$BASE/releases/old" ]]

# A failed web activation restores the pointer without restarting the API.
mkdir -p "$BASE/releases/new"
systemctl() {
  [[ "$1 $2" = 'restart createx-web' ]] || { echo "Unexpected systemctl call: $*" >&2; exit 1; }
  [[ "$(readlink "$BASE/current")" = "$BASE/releases/new" ]] && return 1
  return 0
}
wait_ready_web() { [[ "$(readlink "$BASE/current")" != "$BASE/releases/new" ]]; }
reject activate_web "$BASE/releases/new"
[[ "$(readlink "$BASE/current")" = "$BASE/releases/old" ]]
[[ ! -L "$BASE/previous" ]]

# A successful web activation switches the pointer, marks previous, and only
# ever restarts createx-web.
systemctl() {
  [[ "$1 $2" = 'restart createx-web' ]] || { echo "Unexpected systemctl call: $*" >&2; exit 1; }
  return 0
}
wait_ready_web() { :; }
activate_web "$BASE/releases/new"
[[ "$(readlink "$BASE/current")" = "$BASE/releases/new" ]]
[[ "$(readlink "$BASE/previous")" = "$BASE/releases/old" ]]

# Successful command completion must not hide a changed neighbour or a failed
# neighbour health check; neither case restarts the other application.
cohost_snapshot() { printf '%s\n' "$COHOST_STATE"; }
cohost_health() { [[ "$COHOST_HEALTH" = healthy ]]; }
COHOST_STATE='pid=123 configuration=original'
COHOST_HEALTH=healthy
cohost_snapshot > "$TEMP/cohosts"
cohost_assert_unchanged "$TEMP/cohosts" >/dev/null
COHOST_STATE='pid=456 configuration=original'
reject cohost_assert_unchanged "$TEMP/cohosts"
COHOST_STATE='pid=123 configuration=changed'
reject cohost_assert_unchanged "$TEMP/cohosts"
COHOST_STATE='pid=123 configuration=original'
COHOST_HEALTH=unhealthy
reject cohost_assert_unchanged "$TEMP/cohosts"

# The first request immediately after nginx reload can still reach an old
# worker. Retry verified TLS, but reject a certificate that never becomes valid.
TLS_CALLS=0
curl() { TLS_CALLS=$((TLS_CALLS + 1)); [[ "$TLS_CALLS" -ge 2 ]]; }
sleep() { :; }
wait_origin weavea.world ''
[[ "$TLS_CALLS" = 2 ]]
curl() { return 60; }
reject wait_origin weavea.world ''

# Pruning after several web-only updates must retain the running backend's
# original release so an internal compute child can restart from its bundle.
(
  BASE="$TEMP/prune-life"
  for n in 1 2 3 4 5 6; do mkdir -p "$BASE/releases/20261103T12000${n}Z-00000000000${n}"; done
  ln -s "$BASE/releases/20261103T120006Z-000000000006" "$BASE/current"
  ln -s "$BASE/releases/20261103T120005Z-000000000005" "$BASE/previous"
  active_api_release() { printf '%s' "$BASE/releases/20261103T120001Z-000000000001"; }
  prune
  [[ -d "$BASE/releases/20261103T120001Z-000000000001" ]]
  [[ ! -d "$BASE/releases/20261103T120002Z-000000000002" ]]
)

# The normal no-argument invocation is a local plan and works without SSH.
bash "$ROOT/scripts/deploy-createx.sh" > "$TEMP/plan"
grep -Fq 'Target: auro;' "$TEMP/plan"
echo 'Createx deployment boundary tests passed'
