#!/usr/bin/env bash
# Fetches the hosted Supabase Security + Performance Advisors (Management API).
#
#   SUPABASE_ACCESS_TOKEN=<personal access token> SUPABASE_PROJECT_REF=<ref> bash scripts/supabase-advisors.sh
#
# Writes docs/advisors/{security,performance}.json; classify findings in docs/SUPABASE_ADVISOR_REPORT.md.
# If the API is unavailable for your plan/region, use Dashboard → Advisors and export the results.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${SUPABASE_ACCESS_TOKEN:?BLOCKED: SUPABASE_ACCESS_TOKEN is not set}"
: "${SUPABASE_PROJECT_REF:?BLOCKED: SUPABASE_PROJECT_REF is not set}"
OUT_DIR="${ROOT}/docs/advisors"
mkdir -p "${OUT_DIR}"
for kind in security performance; do
  code=$(curl -sS -o "${OUT_DIR}/${kind}.json" -w '%{http_code}' \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/advisors/${kind}")
  echo "› ${kind} advisors: HTTP ${code} → docs/advisors/${kind}.json"
  if [[ "${code}" != "200" ]]; then echo "  (failed — use Dashboard → Advisors)" >&2; fi
done
# Summary by level (requires jq; optional).
if command -v jq >/dev/null; then
  for kind in security performance; do
    jq -r --arg k "${kind}" '.lints // . | if type=="array" then .[] | "\($k)\t\(.level)\t\(.name)\t\(.detail // .title // "")" else empty end' "${OUT_DIR}/${kind}.json" 2>/dev/null | sort | uniq -c || true
  done
fi
