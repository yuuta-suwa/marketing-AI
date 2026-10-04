#!/usr/bin/env bash
# Verifies a hosted Supabase database after `supabase db push`.
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres' npm run verify:hosted-db
#
# Read-only: schema/RLS/policies/functions/triggers/indexes/grants/realtime/migration history
# (scripts/sql/verify-schema.sql) + the local advisor approximation (scripts/sql/advisor-lints.sql).
# The connection string is a secret: pass it via the environment, never on the command line history.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "BLOCKED: SUPABASE_DB_URL is not set (Project Settings → Database → Connection string, session pooler)." >&2
  exit 2
fi
command -v psql >/dev/null || { echo "psql (PostgreSQL client) is required" >&2; exit 2; }
OUT_DIR="${ROOT}/docs/advisors"
mkdir -p "${OUT_DIR}"
echo "› schema verification"
psql "${SUPABASE_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${ROOT}/scripts/sql/verify-schema.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /'
echo "› advisor lints (local approximation) → docs/advisors/local-lints.txt"
psql "${SUPABASE_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${ROOT}/scripts/sql/advisor-lints.sql" > "${OUT_DIR}/local-lints.txt"
grep -E '^ (ERROR|WARN) ' "${OUT_DIR}/local-lints.txt" || echo "  no ERROR/WARN findings"
echo "HOSTED SCHEMA VERIFIED"
