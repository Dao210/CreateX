#!/usr/bin/env bash
# Remote half of deploy-createx.sh. All mutations stay inside Createx resources.
set -Eeuo pipefail
BASE=/opt/createx
CONFIG=/etc/createx
STATE=/var/lib/createx
SITE=/etc/nginx/sites-available/createx.conf
ENABLED=/etc/nginx/sites-enabled/createx.conf
MARKER='# Managed by createx deployment v1'
ORIGIN=http://localhost:23080

die() { echo "Createx: $*" >&2; exit 1; }
valid_release() { [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}(-dirty)?$ ]]; }
owned_file() {
  if [[ -e "$1" || -L "$1" ]]; then
    [[ -f "$1" && ! -L "$1" ]] && head -n 1 "$1" | grep -Fxq "$MARKER" || die "Refusing foreign file: $1"
  fi
}
service_port() {
  local port="$1" unit="$2" listeners pid line
  listeners="$(ss -H -ltnp "sport = :$port")"
  [[ -n "$listeners" ]] || return 0
  pid="$(systemctl show "$unit" -p MainPID --value 2>/dev/null || true)"
  while IFS= read -r line; do
    [[ "${pid:-0}" != 0 && "$line" = *"pid=$pid,"* ]] || die "Port $port is already used by another process"
    [[ "$line" = *"127.0.0.1:$port "* ]] || die "Port $port is not loopback-only"
  done <<< "$listeners"
}

cohost_snapshot() {
  local unit
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    printf '[%s]\n' "$unit"
    systemctl show "$unit" -p ActiveState -p MainPID -p ExecMainStartTimestampMonotonic || return 1
    systemctl cat "$unit" | sha256sum || return 1
  done < <(systemctl list-unit-files --no-legend --no-pager 'agentpage*.service' 'aurocreator*.service' | awk '{print $1}' | sort)
  # A graceful nginx reload keeps its master PID; PostgreSQL must not restart.
  systemctl show nginx.service postgresql@17-main.service -p Id -p MainPID -p ExecMainStartTimestampMonotonic || return 1
  nginx -T 2>/dev/null | awk -v site="$SITE" -v enabled="$ENABLED" '
    $1 == "#" && $2 == "configuration" && $3 == "file" {file=$4; sub(/:$/, "", file)}
    file != site && file != enabled {print}
  ' | sha256sum
}

cohost_health() {
  local name api web
  for name in agentpage aurocreator; do
    if [[ "$name" = agentpage ]]; then api=18080; web=13000; else api=8080; web=3000; fi
    if systemctl is-active --quiet "$name-backend.service"; then
      curl -fsS --max-time 5 "http://127.0.0.1:$api/health" >/dev/null || return 1
    fi
    if systemctl is-active --quiet "$name-web.service"; then
      curl -fsS --max-time 10 "http://127.0.0.1:$web/" >/dev/null || return 1
    fi
  done
}

cohost_assert_unchanged() {
  local before="$1" after
  after="$(mktemp /tmp/createx-cohost-after.XXXXXXXX)"
  if ! cohost_snapshot > "$after" || ! cmp -s "$before" "$after"; then
    diff -u "$before" "$after" >&2 || true
    rm -f "$after"
    echo 'Co-hosted service processes or configuration changed; inspect before continuing' >&2
    return 1
  fi
  rm -f "$after"
  cohost_health || return 1
  echo 'AgentPage/AuroCreator processes and configuration unchanged; health checks passed'
}

finish_mutation() {
  local status="$1" before="$2"
  trap - EXIT
  if ! cohost_assert_unchanged "$before"; then status=1; fi
  rm -f "$before"
  exit "$status"
}

preflight() {
  local tool file
  [[ "$(uname -m)" = aarch64 ]] || die 'This artifact targets Linux ARM64'
  for tool in node nginx psql pg_dump systemctl systemd-run ss python3 openssl flock runuser rsync curl; do
    command -v "$tool" >/dev/null || die "Missing dependency: $tool"
  done
  [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]] || die 'Node >=22 required'
  nginx -t
  runuser -u postgres -- psql -XAtc 'SELECT 1' >/dev/null
  [[ "$(df -Pk /opt | awk 'NR==2 {print $4}')" -ge 2097152 ]] || die 'Need at least 2 GiB free on /opt'
  if [[ -e "$BASE" ]]; then
    [[ -f "$BASE/.createx-deployment" ]] && grep -Fxq "$MARKER" "$BASE/.createx-deployment" || die "Foreign directory: $BASE"
  else
    ! id createx >/dev/null 2>&1 || die 'createx user already exists without a deployment marker'
    [[ "$(runuser -u postgres -- psql -XAtc "SELECT count(*) FROM pg_database WHERE datname='createx'")" = 0 ]] || die 'createx database already exists without a deployment marker'
    [[ "$(runuser -u postgres -- psql -XAtc "SELECT count(*) FROM pg_roles WHERE rolname='createx'")" = 0 ]] || die 'createx role already exists without a deployment marker'
    [[ ! -e "$CONFIG" && ! -e "$STATE" ]] || die 'Foreign Createx config/data directory'
  fi
  for file in "$SITE" /etc/systemd/system/createx-{api,web}.service /etc/systemd/system/createx.slice; do owned_file "$file"; done
  if [[ -e "$ENABLED" || -L "$ENABLED" ]]; then
    [[ -L "$ENABLED" && "$(readlink "$ENABLED")" = "$SITE" ]] || die 'Foreign nginx site link'
  fi
  service_port 23000 createx-web.service
  service_port 28080 createx-api.service
  service_port 26060 createx-api.service
  if [[ -n "$(ss -H -ltn 'sport = :23080')" ]]; then
    [[ -L "$ENABLED" ]] && grep -Fxq "$MARKER" "$SITE" || die 'Gateway port 23080 is occupied'
    service_port 23080 nginx.service
  fi
  echo 'Createx preflight passed (no changes)'
}

locations() {
  cat <<'NGINX'
    client_max_body_size 32m;
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # Only content-addressed Next assets are cached across application releases.
    location ^~ /_next/static/ {
        alias /var/lib/createx/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location ~ ^/(debug|metrics|maintenance)(/|$) { return 404; }
    location ~ ^/(api|auth|v1|uploads)(/|$)|^/(ws|health|readyz)$|^/\.well-known/reach\.json$ {
        proxy_pass http://127.0.0.1:28080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $createx_connection_upgrade;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location / {
        proxy_pass http://127.0.0.1:23000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";
        proxy_read_timeout 120s;
    }
NGINX
}

render_nginx() {
  local domain="${1:-}" cert="${2:-}" key="${3:-}"
  printf '%s\n' "$MARKER"
  cat <<'NGINX'
map $http_upgrade $createx_connection_upgrade {
    default upgrade;
    '' '';
}
server {
    listen 127.0.0.1:23080;
    server_name localhost;
NGINX
  locations
  echo '}'
  if [[ -n "$domain" ]]; then
    cat <<NGINX
server {
    listen 80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root $STATE/acme; }
    location / { return 308 https://$domain\$request_uri; }
}
server {
    listen 443 ssl http2;
    server_name $domain;
    ssl_certificate $cert;
    ssl_certificate_key $key;
    ssl_protocols TLSv1.2 TLSv1.3;
NGINX
    locations
    echo '}'
  fi
}

install_nginx() {
  local candidate="$1" backup
  owned_file "$SITE"
  backup="$(mktemp /tmp/createx-nginx.XXXXXXXX)"
  if [[ -f "$SITE" ]]; then cp "$SITE" "$backup"; fi
  install -m 0644 "$candidate" "$SITE"
  ln -sfn "$SITE" "$ENABLED"
  if ! nginx -t || ! systemctl reload nginx; then
    if [[ -s "$backup" ]]; then cp "$backup" "$SITE"; else rm -f "$ENABLED" "$SITE"; fi
    nginx -t && systemctl reload nginx || true
    rm -f "$backup"
    die 'Nginx activation failed; restored the previous Createx configuration'
  fi
  rm -f "$backup"
}

bootstrap() {
  local password jwt
  if [[ -f "$BASE/.createx-deployment" ]]; then
    [[ -s "$CONFIG/backend.env" && -s "$CONFIG/web.env" ]] || die 'Incomplete bootstrap; inspect config before retrying'
    return
  fi
  install -d -m 0755 "$BASE" "$BASE/releases" "$CONFIG" "$STATE"
  useradd --system --home-dir "$STATE" --no-create-home --shell /usr/sbin/nologin createx
  install -d -o createx -g createx -m 0750 "$STATE/uploads" "$STATE/plugins" "$STATE/cache"
  install -d -m 0755 "$STATE/static"
  install -d -m 0700 /var/backups/createx
  password="$(openssl rand -hex 32)"
  jwt="$(openssl rand -hex 32)"
  # Only the dedicated database is created/tuned. Shared PostgreSQL is not restarted.
  runuser -u postgres -- psql -Xq -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE createx LOGIN PASSWORD '$password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE createx OWNER createx;
REVOKE ALL ON DATABASE createx FROM PUBLIC;
ALTER ROLE createx SET work_mem = '8MB';
ALTER ROLE createx SET statement_timeout = '60s';
ALTER ROLE createx SET idle_in_transaction_session_timeout = '60s';
SQL
  runuser -u postgres -- psql -Xq -v ON_ERROR_STOP=1 -d createx <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
  umask 077
  cat > "$CONFIG/backend.env" <<ENV
APP_ENV=production
SERVER_HOST=127.0.0.1
PORT=28080
AURO_PPROF_ADDR=127.0.0.1:26060
DATABASE_URL=postgres://createx:$password@127.0.0.1:5432/createx?sslmode=disable
JWT_SECRET=$jwt
FRONTEND_ORIGIN=$ORIGIN
CORS_ALLOWED_ORIGINS=$ORIGIN
AURO_APP_URL=$ORIGIN
AURO_PUBLIC_URL=$ORIGIN
AURO_TRUSTED_PROXIES=127.0.0.1/32
LOCAL_UPLOAD_DIR=$STATE/uploads
AURO_PLUGIN_DIR=$STATE/plugins
DO_NOT_TRACK=1
ALLOW_SIGNUP=true
ENV
  cat > "$CONFIG/web.env" <<'ENV'
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
HOSTNAME=127.0.0.1
PORT=23000
REMOTE_API_URL=http://127.0.0.1:28080
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_WS_URL=
ENV
  chmod 600 "$CONFIG/"*.env
  printf '%s\n' "$MARKER" > "$BASE/.createx-deployment"
  umask 022
}

write_slice() {
  owned_file /etc/systemd/system/createx.slice
  cat > /etc/systemd/system/createx.slice <<EOF
$MARKER
[Unit]
Description=Createx services
[Slice]
CPUAccounting=true
MemoryAccounting=true
EOF
}

resources() {
  local unit
  preflight
  # Remove only the presets introduced by this deployment workflow.
  sed -i -E '/^GOMEMLIMIT=768MiB$/d; /^GOMAXPROCS=2$/d; /^DATABASE_MAX_CONNS=10$/d; /^DATABASE_MIN_CONNS=1$/d; /^DATABASE_SEARCH_WORK_MEM_MB=16$/d; s/&pool_max_conns=10&pool_min_conns=1$//' "$CONFIG/backend.env"
  sed -i '/^NODE_OPTIONS=--max-old-space-size=768$/d' "$CONFIG/web.env"
  runuser -u postgres -- psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
ALTER ROLE createx CONNECTION LIMIT -1;
ALTER DATABASE createx CONNECTION LIMIT -1;
SQL
  install_units
  # Replace previously generated runtime drop-ins as well as persistent units.
  systemctl set-property --runtime createx.slice CPUQuota= CPUWeight=100 IOWeight=100 MemoryHigh=infinity MemoryMax=infinity TasksMax=infinity
  for unit in createx-api.service createx-web.service; do
    systemctl set-property --runtime "$unit" MemoryMax=infinity
  done
  systemctl restart createx-api createx-web
  wait_ready || die 'Createx did not recover after removing runtime presets'
  systemctl show createx.slice -p CPUQuotaPerSecUSec -p CPUWeight -p IOWeight -p MemoryHigh -p MemoryMax
  verify
}

install_units() {
  local name binary writes node
  node="$(command -v node)"
  write_slice
  for name in api web; do
    if [[ "$name" = api ]]; then binary="$BASE/current/bin/server"; writes="$STATE/uploads $STATE/plugins";
    else binary="$node $BASE/current/web/apps/web/server.js"; writes="$STATE/cache"; fi
    cat > "/etc/systemd/system/createx-$name.service" <<EOF
$MARKER
[Unit]
Description=Createx $name
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
Type=simple
User=createx
Group=createx
WorkingDirectory=$BASE/current$(if [[ "$name" = web ]]; then printf /web; fi)
EnvironmentFile=$CONFIG/$(if [[ "$name" = api ]]; then printf backend; else printf web; fi).env
ExecStart=$binary
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
LimitNOFILE=65535
Slice=createx.slice
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$writes
InaccessiblePaths=-/etc/agentpage -/etc/aurocreator -/opt/agentpage -/opt/aurocreator
RestrictSUIDSGID=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
[Install]
WantedBy=multi-user.target
EOF
  done
  systemctl daemon-reload
  systemctl enable createx-api.service createx-web.service
}

wait_ready() {
  local attempt
  for attempt in {1..45}; do
    if systemctl is-active --quiet createx-api createx-web &&
      curl -fs --max-time 3 http://127.0.0.1:28080/readyz >/dev/null &&
      curl -fs --max-time 5 http://127.0.0.1:23000/ >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
switch_link() { ln -sfn "$1" "$BASE/current.next"; mv -Tf "$BASE/current.next" "$BASE/current"; }

activate() {
  local target="$1" old
  old=""
  if [[ -L "$BASE/current" ]]; then old="$(readlink -f "$BASE/current")"; fi
  switch_link "$target"
  if ! systemctl restart createx-api createx-web || ! wait_ready; then
    journalctl -u createx-api -u createx-web -n 30 --no-pager >&2
    if [[ -n "$old" ]]; then
      switch_link "$old"
      systemctl restart createx-api createx-web
      wait_ready || die 'Previous release also failed; inspect journal'
    else
      systemctl stop createx-api createx-web
      rm -f "$BASE/current"
    fi
    die 'Application activation failed; database migrations remain applied'
  fi
  if [[ -n "$old" && "$old" != "$target" ]]; then ln -sfn "$old" "$BASE/previous"; fi
}

smoke_native() {
  local target="$1"
  (cd "$target/web/apps/web" && runuser -u createx -- node -e 'const {createRequire}=require("module"); const r=createRequire(require.resolve("next/package.json")); r("sharp")({create:{width:1,height:1,channels:3,background:"red"}}).png().toBuffer().then(b=>{if(!b.length)process.exit(1)}).catch(e=>{console.error(e);process.exit(1)})')
}

wait_origin() {
  local domain="$1" ca="${2:-}" attempt error
  local -a tls_args=(--proto '=https')
  if [[ -n "$ca" ]]; then
    [[ "$ca" =~ ^/[a-zA-Z0-9_./-]+$ && -s "$ca" ]] || die 'Origin CA bundle is missing'
    tls_args+=(--cacert "$ca")
  fi
  error="$(mktemp /tmp/createx-origin-check.XXXXXXXX)"
  # nginx reload returns before replacement workers have adopted the new SNI
  # configuration. Keep certificate verification enabled throughout the wait.
  for attempt in {1..15}; do
    if curl -fsS --noproxy '*' --max-time 3 "${tls_args[@]}" --resolve "$domain:443:127.0.0.1" "https://$domain/readyz" >/dev/null 2>"$error"; then
      rm -f "$error"
      return 0
    fi
    sleep 1
  done
  cat "$error" >&2
  rm -f "$error"
  return 1
}

verify_origin() {
  local domain ca
  [[ -f "$CONFIG/site.conf" ]] || return 0
  owned_file "$CONFIG/site.conf"
  domain="$(sed -n 's/^DOMAIN=//p' "$CONFIG/site.conf")"
  ca="$(sed -n 's/^CA=//p' "$CONFIG/site.conf")"
  [[ "$domain" =~ ^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$ ]] || die 'Invalid origin configuration'
  wait_origin "$domain" "$ca" || die 'Origin TLS verification failed'
  echo "HTTPS origin healthy (local SNI verification): $domain"
}

verify() {
  local target health commit expected port unit pid current
  target="$(readlink -f "$BASE/current")"
  [[ "$target" = "$BASE/releases/"* && -s "$target/manifest" ]] || die 'Invalid release pointer'
  wait_ready || die 'Services not ready'
  for unit in api web; do
    pid="$(systemctl show "createx-$unit" -p MainPID --value)"
    current="$(readlink -f "/proc/$pid/cwd")"
    if [[ "$unit" = api ]]; then expected="$target"; else expected="$target/web/apps/web"; fi
    [[ "$current" = "$expected" ]] || die "Stale $unit process"
  done
  service_port 23000 createx-web.service
  service_port 28080 createx-api.service
  service_port 26060 createx-api.service
  service_port 23080 nginx.service
  curl -fsS --max-time 5 http://127.0.0.1:26060/debug/pprof/ >/dev/null
  health="$(curl -fsS --max-time 5 http://127.0.0.1:28080/health)"
  commit="$(printf '%s' "$health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["commit"])')"
  expected="$(sed -n 's/^commit=//p' "$target/manifest")"
  [[ "$commit" = "$expected" ]] || die 'Running API commit differs from artifact'
  # Also exercise the target-platform native image dependency without user traffic.
  smoke_native "$target"
  curl -fsS --max-time 10 http://127.0.0.1:23080/ >/dev/null
  curl -fsS --max-time 5 http://127.0.0.1:23080/readyz >/dev/null
  verify_origin
  echo "Createx verified: $target"
  echo 'Internal gateway: http://localhost:23080 (SSH tunnel)'
}

deploy() {
  local upload="$1" release="$2" target candidate
  [[ "$upload" =~ ^/tmp/createx-upload\.[a-zA-Z0-9]+$ ]] || die 'Invalid upload directory'
  valid_release "$release" || die 'Invalid release ID'
  preflight
  (cd "$upload" && sha256sum -c "$release.tar.gz.sha256")
  target="$BASE/releases/$release"
  [[ ! -e "$target" ]] || die 'Release already exists'
  bootstrap
  install -d -m 0755 "$target"
  tar -xzf "$upload/$release.tar.gz" -C "$target" --no-same-owner
  [[ -x "$target/bin/server" && -x "$target/bin/migrate" && -f "$target/web/apps/web/server.js" ]] || die 'Incomplete artifact'
  grep -Fxq "release=$release" "$target/manifest" || die 'Release manifest mismatch'
  # Persist the writable image cache; compiled application files stay read-only.
  rm -rf "$target/web/apps/web/.next-createx/cache"
  ln -s "$STATE/cache" "$target/web/apps/web/.next-createx/cache"
  cp -a "$target/web/apps/web/.next-createx/static/." "$STATE/static/"
  chmod -R a+rX "$STATE/static" "$target"
  smoke_native "$target"
  runuser -u postgres -- pg_dump -Fc createx > "/var/backups/createx/$release.dump"
  chmod 600 "/var/backups/createx/$release.dump"
  install_units
  # No credentials appear in the command line or logs; systemd reads the env file.
  systemd-run --quiet --wait --pipe --collect --unit="createx-migrate-$release" \
    -p User=createx -p Group=createx -p "WorkingDirectory=$target" \
    -p "EnvironmentFile=$CONFIG/backend.env" -p Slice=createx.slice \
    --setenv='PGOPTIONS=-c statement_timeout=0 -c lock_timeout=10s' \
    "$target/bin/migrate" up
  activate "$target"
  # Preserve an existing public site on subsequent internal deployments.
  if [[ ! -f "$SITE" ]]; then
    candidate="$(mktemp /tmp/createx-site.XXXXXXXX)"
    render_nginx > "$candidate"
    install_nginx "$candidate"
    rm -f "$candidate"
  fi
  verify
  prune
}

domain_available() {
  local domain="$1" conflict
  [[ "$domain" =~ ^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$ && "$domain" != *..* ]] || die 'Invalid domain'
  # Refuse to shadow a domain that another active site owns.
  conflict="$(nginx -T 2>/dev/null | awk -v domain="$domain" -v site="$SITE" -v enabled="$ENABLED" '
    $1 == "#" && $2 == "configuration" && $3 == "file" {file=$4; sub(/:$/, "", file)}
    $1 == "server_name" && file != site && file != enabled {
      for(i=2;i<=NF;i++){gsub(/;/,"",$i);if($i==domain)print file}
    }')"
  [[ -z "$conflict" ]] || die "Domain already served by $conflict"
}

publish() {
  local domain="$1" cert="$2" key="$3" ca="${4:-}" candidate public_key private_key backup_site
  domain_available "$domain"
  [[ "$cert" =~ ^/[a-zA-Z0-9_./-]+$ && "$key" =~ ^/[a-zA-Z0-9_./-]+$ ]] || die 'Invalid certificate paths'
  [[ -s "$cert" && -s "$key" ]] || die 'Certificate/key must already exist on the host'
  if [[ -n "$ca" ]]; then
    [[ "$ca" =~ ^/[a-zA-Z0-9_./-]+$ && -s "$ca" ]] || die 'Invalid CA bundle'
    openssl verify -purpose sslserver -verify_hostname "$domain" -CAfile "$ca" "$cert" >/dev/null || die 'Certificate CA verification failed'
  fi
  preflight
  verify
  openssl x509 -in "$cert" -noout -checkhost "$domain" >/dev/null || die 'Certificate hostname mismatch'
  openssl x509 -in "$cert" -noout -checkend 86400 >/dev/null || die 'Certificate expires within 24 hours'
  public_key="$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)"
  private_key="$(openssl pkey -in "$key" -pubout -outform DER | sha256sum)"
  [[ "$public_key" = "$private_key" ]] || die 'Certificate and key do not match'
  candidate="$(mktemp /tmp/createx-site.XXXXXXXX)"
  backup_site="$(mktemp /tmp/createx-site-before.XXXXXXXX)"
  cp "$SITE" "$backup_site"
  render_nginx "$domain" "$cert" "$key" > "$candidate"
  cp "$CONFIG/backend.env" "$CONFIG/backend.env.before-publish"
  sed -i -E "s|^(FRONTEND_ORIGIN\|CORS_ALLOWED_ORIGINS\|AURO_APP_URL\|AURO_PUBLIC_URL)=.*|\1=https://$domain|" "$CONFIG/backend.env"
  systemctl restart createx-api
  if ! wait_ready; then
    cp "$CONFIG/backend.env.before-publish" "$CONFIG/backend.env"
    systemctl restart createx-api
    die 'Public origin update failed; restored env'
  fi
  if ! (install_nginx "$candidate") || ! wait_origin "$domain" "$ca"; then
    install_nginx "$backup_site"
    cp "$CONFIG/backend.env.before-publish" "$CONFIG/backend.env"
    systemctl restart createx-api
    rm -f "$candidate" "$backup_site"
    die 'HTTPS verification failed; restored site and origin'
  fi
  rm -f "$candidate" "$backup_site"
  printf '%s\nDOMAIN=%s\nCERT=%s\nKEY=%s\nCA=%s\n' "$MARKER" "$domain" "$cert" "$key" "$ca" > "$CONFIG/site.conf"
  chmod 644 "$CONFIG/site.conf"
  echo "HTTPS origin configured and locally verified: https://$domain"
}

https() {
  local domain="$1" candidate backup_site token response
  domain_available "$domain"
  command -v certbot >/dev/null || die 'certbot must already be installed'
  preflight
  verify
  # Refuse new account registration: use only a previously configured ACME
  # account, without accepting new terms or selecting an arbitrary email.
  [[ -d /etc/letsencrypt/accounts ]] && find /etc/letsencrypt/accounts -name regr.json -print -quit | grep -q . || die 'Configure a certbot ACME account first'
  install -d -m 0755 "$STATE/acme/.well-known/acme-challenge"
  candidate="$(mktemp /tmp/createx-acme-site.XXXXXXXX)"
  backup_site="$(mktemp /tmp/createx-acme-before.XXXXXXXX)"
  cp "$SITE" "$backup_site"
  render_nginx > "$candidate"
  cat >> "$candidate" <<EOF
server {
    listen 80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root $STATE/acme; }
    location / { return 503; }
}
EOF
  install_nginx "$candidate"
  token="$(openssl rand -hex 16)"
  printf '%s' "$token" > "$STATE/acme/.well-known/acme-challenge/$token"
  response="$(curl -fsS --max-time 15 "http://$domain/.well-known/acme-challenge/$token" 2>/dev/null || true)"
  rm -f "$STATE/acme/.well-known/acme-challenge/$token"
  if [[ "$response" != "$token" ]] || ! certbot certonly --webroot -w "$STATE/acme" \
    --non-interactive --keep-until-expiring --cert-name "createx-$domain" -d "$domain" \
    --deploy-hook 'nginx -t && systemctl reload nginx'; then
    install_nginx "$backup_site"
    rm -f "$candidate" "$backup_site"
    die 'ACME validation failed; check domain DNS and inbound HTTP. Restored site.'
  fi
  # Restore the existing site before publish owns its rollback transaction.
  install_nginx "$backup_site"
  rm -f "$candidate" "$backup_site"
  publish "$domain" "/etc/letsencrypt/live/createx-$domain/fullchain.pem" "/etc/letsencrypt/live/createx-$domain/privkey.pem"
}

prune() {
  local current previous path index=0
  current="$(readlink -f "$BASE/current")"
  previous="$(readlink -f "$BASE/previous" 2>/dev/null || true)"
  while IFS= read -r path; do
    valid_release "${path##*/}" || continue
    index=$((index + 1))
    if [[ "$index" -gt 3 && "$path" != "$current" && "$path" != "$previous" ]]; then rm -rf -- "$path"; fi
  done < <(find "$BASE/releases" -mindepth 1 -maxdepth 1 -type d | sort -r)
}

main() {
  [[ "$EUID" = 0 ]] || die 'Remote host script requires sudo'
  case "${1:-}" in
    preflight|verify) [[ $# = 1 ]] || die 'Unexpected arguments'; "$1" ;;
    deploy|publish|https|rollback|prune|resources)
      # flock releases automatically even when SSH disconnects. No stale lock file deletion.
      exec 9>/run/lock/createx-deploy.lock
      flock -n 9 || die 'Another Createx deployment is running'
      cohost_health || die 'Co-hosted services are unhealthy; refusing mutation'
      before="$(mktemp /tmp/createx-cohost-before.XXXXXXXX)"
      if ! cohost_snapshot > "$before"; then rm -f "$before"; die 'Cannot snapshot co-hosted services'; fi
      trap 'finish_mutation "$?" "$before"' EXIT
      case "$1" in
        deploy) [[ $# = 3 ]] || die 'Expected upload and release'; deploy "$2" "$3" ;;
        publish) [[ $# = 4 || $# = 5 ]] || die 'Expected domain, certificate, key and optional CA'; publish "$2" "$3" "$4" "${5:-}" ;;
        https) [[ $# = 2 ]] || die 'Expected domain'; https "$2" ;;
        rollback)
          preflight
          previous="$(readlink -f "$BASE/previous")"
          [[ "$previous" = "$BASE/releases/"* && -s "$previous/manifest" ]] || die 'No previous release'
          activate "$previous"; verify
          ;;
        prune) preflight; prune ;;
        resources) [[ $# = 1 ]] || die 'Unexpected arguments'; resources ;;
      esac
      ;;
    *) die 'Unknown command' ;;
  esac
}
if [[ "${BASH_SOURCE[0]:-$0}" = "$0" ]]; then main "$@"; fi
