#!/usr/bin/env bash
# Spins up a throwaway PostgreSQL cluster (needs PostgreSQL 15+ and pgvector),
# applies a Supabase shim + all migrations, then runs the RLS/integrity tests.
#
#   npm run test:db
#
# Override binaries with PG_BIN=/usr/lib/postgresql/16/bin.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "${PG_BIN}" || ! -x "${PG_BIN}/initdb" ]]; then
  echo "PostgreSQL binaries not found. Set PG_BIN." >&2
  exit 1
fi

WORK="$(mktemp -d -t mro-db-XXXXXX)"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  chown -R postgres:postgres "${WORK}"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" "${PG_BIN}/pg_ctl" -D "${WORK}/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

"${RUN_AS[@]}" "${PG_BIN}/initdb" -D "${WORK}/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "${PG_BIN}/pg_ctl" -D "${WORK}/data" -o "-p ${PORT} -k ${WORK} -c listen_addresses=''" \
  -l "${WORK}/pg.log" -w start >/dev/null

PSQL=("${PG_BIN}/psql" -h "${WORK}" -p "${PORT}" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t)

echo "› applying Supabase shim"
"${RUN_AS[@]}" "${PSQL[@]}" -f "${ROOT}/supabase/tests/00_supabase_shim.sql"

for f in "${ROOT}"/supabase/migrations/*.sql; do
  echo "› migration $(basename "$f")"
  "${RUN_AS[@]}" "${PSQL[@]}" -f "$f"
done

echo "› running database tests"
"${RUN_AS[@]}" "${PSQL[@]}" -f "${ROOT}/supabase/tests/10_rls_and_integrity.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]* NOTICE:  /  /' | grep -v '^\s*$'
