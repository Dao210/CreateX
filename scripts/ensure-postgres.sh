#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Create .env from .env.example, or run 'make worktree-env' and use .env.worktree." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

for tool in node psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing prerequisite: $tool. Install Node.js and PostgreSQL client tools, and add them to PATH." >&2
    exit 1
  fi
done

# DATABASE_URL owns the endpoint and credentials. POSTGRES_* only supplies
# defaults when no URL was configured; never override a URL with PGPASSWORD.
# A managed environment passes its recorded URL as the second argument.
DATABASE_URL="${2:-${DATABASE_URL:-$(node -e '
  const e = process.env;
  process.stdout.write("postgres://" + encodeURIComponent(e.POSTGRES_USER || "auro") + ":" + encodeURIComponent(e.POSTGRES_PASSWORD ?? "auro") + "@localhost:" + (e.POSTGRES_PORT || "5432") + "/" + encodeURIComponent(e.POSTGRES_DB || "auro") + "?sslmode=disable");
')}}"
export DATABASE_URL PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-5}"

if ! db_config="$(node <<'NODE'
try {
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  const host = url.searchParams.get("hostaddr") || url.searchParams.get("host") || decodeURIComponent(url.hostname) || "local socket";
  const port = url.searchParams.get("port") || url.port || "5432";
  const name = url.searchParams.get("dbname") || decodeURIComponent(url.pathname.slice(1));
  if (!name || [host, port, name].some(value => /[\t\r\n]/.test(value))) throw new Error();
  url.pathname = "/postgres";
  if (url.searchParams.has("dbname")) url.searchParams.set("dbname", "postgres");
  process.stdout.write([host, port, name, url.toString()].join("\t"));
} catch {
  console.error("Invalid DATABASE_URL. Use a PostgreSQL URL with an explicit database name.");
  process.exit(1);
}
NODE
)"; then
  exit 1
fi
IFS=$'\t' read -r db_host db_port db_name admin_url <<< "$db_config"

db_error="$(mktemp)"
trap 'rm -f "$db_error"' EXIT

database_error() {
  cat "$db_error" >&2
  echo "Cannot connect to PostgreSQL at $db_host:$db_port. Check DATABASE_URL and start your PostgreSQL service." >&2
  echo "For the optional Docker database, run 'make db-up' explicitly." >&2
  exit 1
}

psql_query() {
  psql -X -w --dbname="$1" -v ON_ERROR_STOP=1 -Atc "$2"
}

echo "==> Checking PostgreSQL at $db_host:$db_port (database: $db_name)..."
if ! psql_query "$DATABASE_URL" 'SELECT 1' >/dev/null 2>"$db_error"; then
  case "$db_host" in
    localhost | 127.0.0.1 | ::1 | '[::1]' | 'local socket' | /*)
      psql_query "$admin_url" 'SELECT 1' >/dev/null 2>"$db_error" || database_error
      echo "==> Ensuring local database '$db_name' exists..."
      # psql quotes the literal and format(%I) quotes the identifier. This also
      # leaves existing databases intact when a connection failed for another reason.
      psql -X -w --dbname="$admin_url" -v ON_ERROR_STOP=1 -v db_name="$db_name" >/dev/null 2>"$db_error" <<'SQL' || database_error
SELECT format('CREATE DATABASE %I', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec
SQL
      psql_query "$DATABASE_URL" 'SELECT 1' >/dev/null 2>"$db_error" || database_error
      ;;
    *) database_error ;;
  esac
fi

server_version="$(psql_query "$DATABASE_URL" 'SHOW server_version_num')"
if [ "$server_version" -lt 170000 ]; then
  echo "PostgreSQL 17 or newer is required. Update the service selected by DATABASE_URL." >&2
  exit 1
fi
missing_extensions="$(psql_query "$DATABASE_URL" "SELECT name FROM (VALUES ('pgcrypto'), ('pg_trgm')) AS required(name) WHERE NOT EXISTS (SELECT 1 FROM pg_available_extensions AS available WHERE available.name = required.name)")"
if [ -n "$missing_extensions" ]; then
  echo "Missing PostgreSQL extensions: $missing_extensions. Install them on the server selected by DATABASE_URL; migrations enable them." >&2
  exit 1
fi

echo "✓ PostgreSQL ready through DATABASE_URL. Database: $db_name"
