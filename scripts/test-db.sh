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

for f in "${ROOT}"/supabase/tests/[1-9]*.sql; do
  echo "› running $(basename "$f")"
  "${RUN_AS[@]}" "${PSQL[@]}" -f "$f" 2>&1 \
    | sed -e 's/^psql:[^ ]* NOTICE:  /  /' | grep -v '^\s*$'
done
if [[ -n "${EXTRA_SQL:-}" ]]; then
  echo "› extra SQL ${EXTRA_SQL}"
  "${RUN_AS[@]}" "${PG_BIN}/psql" -h "${WORK}" -p "${PORT}" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -At -f "${EXTRA_SQL}"
fi

echo "› schema verification (scripts/sql/verify-schema.sql)"
"${RUN_AS[@]}" "${PSQL[@]}" -f "${ROOT}/scripts/sql/verify-schema.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]* NOTICE:  /  /' | grep -v '^\s*$'

echo "› advisor lints (local approximation, scripts/sql/advisor-lints.sql)"
"${RUN_AS[@]}" "${PG_BIN}/psql" -h "${WORK}" -p "${PORT}" -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -f "${ROOT}/scripts/sql/advisor-lints.sql" > "${ADVISOR_OUT:-${WORK}/advisor-lints.txt}"
grep -cE '^ (ERROR|WARN|INFO) ' "${ADVISOR_OUT:-${WORK}/advisor-lints.txt}" | sed 's/^/  advisor findings: /' || true
if grep -qE '^ ERROR ' "${ADVISOR_OUT:-${WORK}/advisor-lints.txt}"; then
  echo "advisor lints: ERROR-level findings" >&2
  grep -E '^ ERROR ' "${ADVISOR_OUT:-${WORK}/advisor-lints.txt}" >&2
  exit 1
fi

echo 'ALL DATABASE TESTS PASSED'
