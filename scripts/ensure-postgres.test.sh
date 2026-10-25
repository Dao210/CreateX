#!/usr/bin/env bash
# Exercise database startup without a real server or Docker.
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/bin"

fail() { echo "FAIL: $*" >&2; exit 1; }
require_contains() { grep -Fq -- "$2" "$1" || fail "Expected '$2' in $1"; }

cat > "$tmp_dir/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "Docker must not be called" >> "$TEST_DOCKER_LOG"
exit 99
STUB
cat > "$tmp_dir/bin/psql" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_PSQL_LOG"
case "$*" in
  *server_version_num*) echo "${TEST_PG_VERSION:-170010}" ;;
  *pg_available_extensions*) printf '%s' "${TEST_MISSING_EXTENSIONS:-}" ;;
  *"/postgres"*)
    [ "${TEST_ADMIN_UNAVAILABLE:-0}" != 1 ] || { echo 'authentication failed' >&2; exit 2; }
    if [ ! -t 0 ]; then
      sql="$(cat)"
      printf '%s\n' "$sql" >> "$TEST_PSQL_LOG"
      case "$sql" in *"CREATE DATABASE"*) touch "$TEST_CREATED" ;; esac
    fi
    ;;
  *)
    if [ "${TEST_DB_MISSING:-0}" = 1 ] && [ ! -f "$TEST_CREATED" ]; then
      echo 'database does not exist' >&2
      exit 2
    fi
    echo 1
    ;;
esac
STUB
chmod +x "$tmp_dir/bin/psql" "$tmp_dir/bin/docker"
export PATH="$tmp_dir/bin:$PATH"
export TEST_PSQL_LOG="$tmp_dir/psql.log" TEST_DOCKER_LOG="$tmp_dir/docker.log" TEST_CREATED="$tmp_dir/created"
out="$tmp_dir/out"

write_env() {
  printf 'POSTGRES_DB=wrong_database\nPOSTGRES_USER=wrong_user\nDATABASE_URL=%q\n' "$1" > "$tmp_dir/test.env"
  : > "$TEST_PSQL_LOG"
  rm -f "$TEST_CREATED"
}

check_database() { bash "$root_dir/scripts/ensure-postgres.sh" "$tmp_dir/test.env" > "$out" 2>&1; }

# An existing native server must be reached with the application's credentials.
write_env 'postgres://dev:p%40ss@localhost:55432/project?sslmode=disable'
check_database || fail "An existing native database required Docker"
require_contains "$out" "project"
require_contains "$TEST_PSQL_LOG" 'postgres://dev:p%40ss@localhost:55432/project?sslmode=disable'
[ ! -f "$TEST_CREATED" ] || fail "An existing database was recreated"

# The registry's recorded connection must survive edits to the source env file.
bash "$root_dir/scripts/ensure-postgres.sh" "$tmp_dir/test.env" 'postgres://dev@localhost/recorded_project' > "$out" 2>&1 \
  || fail "Managed environment's database URL was rejected"
require_contains "$out" 'recorded_project'

# Local creation follows DATABASE_URL, even when POSTGRES_DB is stale.
write_env 'postgres://dev@127.0.0.1:55432/project?sslmode=disable'
TEST_DB_MISSING=1 check_database || fail "Local database creation failed"
[ -f "$TEST_CREATED" ] || fail "Missing local database was not created"
require_contains "$TEST_PSQL_LOG" 'postgres://dev@127.0.0.1:55432/postgres?sslmode=disable'
require_contains "$TEST_PSQL_LOG" 'db_name=project'
if grep -Fq 'wrong_database' "$TEST_PSQL_LOG"; then fail "POSTGRES_DB overrode DATABASE_URL"; fi

# Authentication failure must fail promptly, without attempting Docker.
write_env 'postgres://dev:secret@localhost/project'
if TEST_DB_MISSING=1 TEST_ADMIN_UNAVAILABLE=1 check_database; then fail "Authentication failure was ignored"; fi
require_contains "$out" 'DATABASE_URL'
if grep -Fq 'secret' "$out"; then fail "Connection error exposed the password"; fi

# Remote databases are checked but never provisioned by local startup.
write_env 'postgres://dev@db.example.com/project'
check_database || fail "Reachable remote database was rejected"
if TEST_DB_MISSING=1 check_database; then fail "Missing remote database was accepted"; fi
[ ! -f "$TEST_CREATED" ] || fail "A remote database was provisioned"

# Query-string host overrides must not turn a remote database into a local one.
write_env 'postgres://dev@localhost/project?host=db.example.com'
if TEST_DB_MISSING=1 check_database; then fail "Remote host override was ignored"; fi
[ ! -f "$TEST_CREATED" ] || fail "Remote host override allowed creation"

# Fail before migrations when the native server cannot support the schema.
write_env 'postgres://dev@[::1]/project'
if TEST_PG_VERSION=160000 check_database; then fail "Unsupported PostgreSQL version was accepted"; fi
require_contains "$out" '17'
if TEST_MISSING_EXTENSIONS=pg_trgm check_database; then fail "Missing extension was ignored"; fi
require_contains "$out" 'pg_trgm'

write_env 'https://dev:secret@localhost/project'
if check_database; then fail "Invalid database URL was accepted"; fi
if grep -Fq 'secret' "$out"; then fail "Invalid URL exposed the password"; fi

# Exercise the make-dev entrypoint with no Docker executable on PATH. Stop at
# the migration command so this test never launches application processes.
fixture="$tmp_dir/checkout"
mkdir -p "$fixture/scripts" "$fixture/server" "$fixture/node_modules" "$tmp_dir/native-bin"
cp "$root_dir/scripts/dev.sh" "$root_dir/scripts/local-env.sh" "$root_dir/scripts/ensure-postgres.sh" "$fixture/scripts/"
cp "$root_dir/package.json" "$fixture/"
for tool in node bash dirname mktemp rm cat touch; do
  ln -s "$(command -v "$tool")" "$tmp_dir/native-bin/$tool"
done
cp "$tmp_dir/bin/psql" "$tmp_dir/native-bin/psql"
cat > "$tmp_dir/native-bin/go" <<'STUB'
#!/usr/bin/env bash
echo "migration reached: $DATABASE_URL"
exit 42
STUB
cat > "$tmp_dir/native-bin/pnpm" <<'STUB'
#!/usr/bin/env bash
exit 99
STUB
chmod +x "$tmp_dir/native-bin/go" "$tmp_dir/native-bin/pnpm"
printf 'DATABASE_URL=postgres://dev@localhost/default_project\n' > "$fixture/.env"
printf 'DATABASE_URL=postgres://dev@localhost/selected_project\n' > "$fixture/selected.env"
status=0
ENV_FILE="$fixture/selected.env" PATH="$tmp_dir/native-bin" bash "$fixture/scripts/dev.sh" > "$out" 2>&1 || status=$?
[ "$status" = 42 ] || fail "make-dev did not reach migrations without Docker (exit $status)"
require_contains "$out" 'migration reached: postgres://dev@localhost/selected_project'

[ ! -s "$TEST_DOCKER_LOG" ] || fail "Database startup invoked Docker"
echo "✓ Native PostgreSQL startup verified"
