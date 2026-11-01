#!/usr/bin/env bash
# Build locally; deploy only isolated Createx releases to the existing auro host.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${CREATEX_DEPLOY_HOST:-auro}"
OUT="$ROOT/.cache/createx-deploy"
DIST=.next-createx
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15)
[[ "$HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || { echo 'Invalid SSH host alias' >&2; exit 1; }

usage() {
  cat <<'HELP'
Usage: scripts/deploy-createx.sh [plan|preflight|webcheck|build|web|deploy|verify|rollback|prune|resources]
       scripts/deploy-createx.sh publish DOMAIN CERT_PATH KEY_PATH [CA_PATH]
       scripts/deploy-createx.sh https DOMAIN

plan       Print the deployment boundaries (default; no network or writes).
preflight  Inspect remote resources without changing them.
webcheck   Read-only preflight plus a current-release check for web-only deploys.
build      Cross-compile Go and package Next standalone for Linux ARM64 locally.
web        Build and activate only the Next web app; the API, units, database
           and migrations stay untouched.
deploy     Preflight, build, upload, back up Createx DB, migrate and activate.
verify     Check service ownership, release, readiness and loopback listeners.
rollback   Activate the previous application release; keep database migrations.
prune      Keep current/previous and the newest three releases; keep DB backups.
resources  Remove Createx deployment resource caps and restart only Createx.
publish    Add HTTPS for one domain using existing certificate files on the host.
https      Issue/renew a domain certificate with existing certbot, then publish.

Fixed isolated ports: gateway 23080, web 23000, API 28080, pprof 26060.
SSH tunnel: ssh -N -L 23080:127.0.0.1:23080 auro
Production secrets live only in /etc/createx/backend.env on the host.
HELP
}

remote() {
  local command
  printf -v command '%q ' sudo -n bash -s -- "$@"
  "${SSH[@]}" "$HOST" "$command" < "$ROOT/scripts/deploy/createx-host.sh"
}

build_setup() {
  local expected actual
  expected="$(node -p 'require(process.argv[1]).packageManager.split("@")[1]' "$ROOT/package.json")"
  actual="$(pnpm --version)"
  [[ "$actual" = "$expected" ]] || { echo "Use pnpm $expected (found $actual)" >&2; exit 1; }
  mkdir -p "$OUT"
  export GOCACHE="${GOCACHE:-$OUT/go-cache}"
  export npm_config_cache="$OUT/npm-cache"
  # An atomic mkdir works with macOS Bash too. Never delete someone else's lock.
  mkdir "$OUT/build.lock" 2>/dev/null || { echo "Local build locked: $OUT/build.lock" >&2; exit 1; }
  trap 'rm -rf "$OUT/build.lock"' EXIT
}

build_next() {
  local stage="$1" release="$2"
  mkdir -p "$stage/web/apps/web/$DIST" "$OUT/downloads"
  (
    cd "$ROOT"
    # Clear public/local upstreams before dotenv runs. No local env file is shipped.
    export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STANDALONE=true AURO_WEB_DIST_DIR="$DIST"
    export REMOTE_API_URL= DOCS_URL= NEXT_PUBLIC_API_URL= NEXT_PUBLIC_WS_URL= NEXT_PUBLIC_APP_VERSION="$release"
    pnpm --filter @auro/web build
  )
  rsync -a --exclude='.env*' "$ROOT/apps/web/$DIST/standalone/" "$stage/web/"
  rsync -a "$ROOT/apps/web/$DIST/static/" "$stage/web/apps/web/$DIST/static/"
  rsync -a "$ROOT/apps/web/public/" "$stage/web/apps/web/public/"
}

pack_sharp() {
  local stage="$1" package package_version packed
  # A macOS standalone trace contains Darwin sharp. Add the exact Linux ARM64
  # optional packages declared by the installed sharp version, without running
  # an install or pruning the traced dependency tree on the production host.
  for package in @img/sharp-linux-arm64 @img/sharp-libvips-linux-arm64; do
    package_version="$(cd "$ROOT/apps/web" && PACKAGE_NAME="$package" node -e 'const {createRequire}=require("module"),fs=require("fs"),path=require("path"); const r=createRequire(require.resolve("next/package.json")); const p=JSON.parse(fs.readFileSync(path.resolve(path.dirname(r.resolve("sharp")),"../package.json"),"utf8")); process.stdout.write(p.optionalDependencies[process.env.PACKAGE_NAME]);')"
    [[ "$package_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid sharp runtime version' >&2; exit 1; }
    packed="$(npm pack "$package@$package_version" --ignore-scripts --pack-destination "$OUT/downloads" --json | node -e 'let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s)[0].filename))')"
    mkdir -p "$stage/web/node_modules/$package"
    tar -xzf "$OUT/downloads/$packed" --strip-components=1 -C "$stage/web/node_modules/$package"
  done
}

finish_release() {
  local stage="$1" release="$2"
  printf 'release=%s\ncommit=%s\narch=linux-arm64\ndist=%s\n' "$release" "$REVISION" "$DIST" > "$stage/manifest"
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT/$release.tar.gz" -C "$stage" .
  (cd "$OUT" && shasum -a 256 "$release.tar.gz" > "$release.tar.gz.sha256")
  printf '%s\n' "$release" > "$OUT/latest"
  echo "Artifact: $OUT/$release.tar.gz"
  rm -rf "$OUT/build.lock"
  trap - EXIT
}

build() {
  local release stage
  build_setup
  REVISION="$(git -C "$ROOT" rev-parse HEAD)"
  release="$(date -u +%Y%m%dT%H%M%SZ)-${REVISION:0:12}"
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then release="$release-dirty"; fi
  stage="$OUT/$release"
  mkdir -p "$stage/bin"
  echo "Building $release for linux/arm64"
  (
    cd "$ROOT/server"
    export CGO_ENABLED=0 GOOS=linux GOARCH=arm64
    go build -trimpath -ldflags "-s -w -X main.commit=$REVISION -X main.version=$release" -o "$stage/bin/server" ./cmd/server
    go build -trimpath -ldflags '-s -w' -o "$stage/bin/migrate" ./cmd/migrate
  )
  build_next "$stage" "$release"
  cp -R "$ROOT/server/migrations" "$stage/migrations"
  cp "$ROOT/LICENSE" "$ROOT/NOTICE" "$stage/"
  pack_sharp "$stage"
  finish_release "$stage" "$release"
}

build_web() {
  local release stage
  build_setup
  REVISION="$(git -C "$ROOT" rev-parse HEAD)"
  release="$(date -u +%Y%m%dT%H%M%SZ)-${REVISION:0:12}"
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then release="$release-dirty"; fi
  release="$release-web"
  stage="$OUT/$release"
  echo "Building web-only release $release for linux/arm64"
  build_next "$stage" "$release"
  pack_sharp "$stage"
  finish_release "$stage" "$release"
}

publish_artifact() {
  local action="$1" release upload
  release="$(cat "$OUT/latest")"
  # SSH creates an unpredictable, private upload directory; source and secrets
  # are not synced. The root-owned host lock covers mutations.
  upload="$("${SSH[@]}" "$HOST" 'mktemp -d /tmp/createx-upload.XXXXXXXX')"
  [[ "$upload" =~ ^/tmp/createx-upload\.[a-zA-Z0-9]+$ ]] || exit 1
  trap '"${SSH[@]}" "$HOST" "rm -rf -- $upload"' EXIT
  rsync -az -e "${SSH[*]}" "$OUT/$release.tar.gz" "$OUT/$release.tar.gz.sha256" "$HOST:$upload/"
  remote "$action" "$upload" "$release"
  "${SSH[@]}" "$HOST" "rm -rf -- $upload"
  trap - EXIT
}

case "${1:-plan}" in
  plan)
    usage
    printf '\nTarget: %s; /opt/createx; user/database: createx\n' "$HOST"
    printf 'No Docker, shared Redis, daemon, global pnpm changes, or firewall changes.\n'
    ;;
  preflight|webcheck|verify|rollback|prune|resources)
    [[ $# = 1 ]] || { usage; exit 1; }
    remote "$1"
    ;;
  build) [[ $# = 1 ]] || exit 1; build ;;
  deploy)
    [[ $# = 1 ]] || exit 1
    remote preflight
    build
    publish_artifact deploy
    ;;
  web)
    [[ $# = 1 ]] || exit 1
    remote webcheck
    build_web
    publish_artifact web
    ;;
  publish)
    [[ $# = 4 || $# = 5 ]] || { usage; exit 1; }
    remote publish "$2" "$3" "$4" "${5:-}"
    ;;
  https)
    [[ $# = 2 ]] || { usage; exit 1; }
    remote https "$2"
    ;;
  *) usage; exit 1 ;;
esac
