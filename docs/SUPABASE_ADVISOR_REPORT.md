# Supabase Advisor Report — Phase 6

Date: 2026-10-04 · Migrations: 14 (`supabase/migrations/`)

## Status: hosted advisors **NOT RUN** (blocked on live infrastructure)

The hosted Supabase **Security Advisor** and **Performance Advisor** have not been run, for two reasons:

1. No hosted Supabase project or credentials exist in this environment.
2. The environment's egress policy denies `api.supabase.com` (verified 2026-10-04).

Until they run, this report records two things:

- **(A)** A local approximation of the advisor lints, run against the exact migrated schema. Every finding is fixed or classified.
- **(B)** A manual security review of the Phase 6 changes.

Neither replaces the hosted advisors. Run them as soon as the project exists:

```bash
SUPABASE_DB_URL='postgresql://…' npm run verify:hosted-db          # schema + local lints against the hosted DB
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… bash scripts/supabase-advisors.sh   # hosted advisors → docs/advisors/*.json
# or: Dashboard → Advisors → Security / Performance
```

Then replace §C with the hosted findings, classified as CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL.

## A. Local advisor approximation (`scripts/sql/advisor-lints.sql`)

These are splinter-style lints evaluated on PostgreSQL 16 + pgvector after all migrations. `scripts/test-db.sh` runs them on every DB test run and **fails on any ERROR-level finding**.

| Lint | Supabase lint | Before Phase 6 fixes | After | Classification |
| --- | --- | --- | --- | --- |
| RLS disabled in public | `rls_disabled_in_public` | 0 | 0 | — |
| Security-definer view | `security_definer_view` | 0 (`opportunity_lineage` uses `security_invoker`) | 0 | — |
| `auth.users` exposed by a view | `auth_users_exposed` | 0 | 0 | — |
| Function `search_path` mutable | `function_search_path_mutable` | 0 | 0 | — |
| SECURITY DEFINER executable by anon | — | 0 | 0 | — |
| Extension in public | `extension_in_public` | 0 (`vector`, `pgcrypto` live in `extensions`) | 0 | — |
| RLS re-evaluating `auth.uid()` per row | `auth_rls_initplan` | 0 (every policy wraps calls in `(select …)`) | 0 | — |
| Multiple permissive policies | `multiple_permissive_policies` | 0 | 0 | — |
| Duplicate index | `duplicate_index` | 0 | 0 | — |
| FK leading column not indexed (stricter, local) | — | **41** | 0 | **MEDIUM, fixed** |
| Unindexed foreign keys | `unindexed_foreign_keys` | **66** (INFO) | 0 | LOW, fixed |
| RLS enabled, no policy | `rls_enabled_no_policy` | — | 1: `worker_heartbeats` | INFORMATIONAL (by design) |

**Fix:** migration `20261005000400_fk_indexes.sql` adds 66 covering indexes, generated from the catalog.
- The most important is `opportunities(research_run_id, organization_id)`. "Opportunities of this run" is read on every run page and by every pipeline stage, and it was a sequential scan.
- The others cover cascade deletes: run → items/evidence/signals, and organization or user deletion.

**Accepted:** `worker_heartbeats` has RLS enabled and no policies. This is intentional:
- only `service_role` (the worker) writes it;
- members have no grants;
- platform operators read an aggregate through `worker_health_summary()`.

## B. Manual security review (Phase 6 changes)

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Members could UPDATE their organization's `research_runs`: status, cost, progress, stats, error text and `organization_id` (pre-existing policy, flagged in the Phase 5 audit). | **HIGH** | **Fixed.** Migration `20261005000100_worker_controlled_data.sql`: the UPDATE privilege is revoked; inserts are only allowed in a clean DRAFT/QUEUED state, created by the caller; cancellation goes through `request_research_cancellation()`. 10 DB tests (`30_worker_controlled_data.sql`). |
| 2 | Members could write pipeline output directly: `source_items`, `evidence`, `signals`, links, clusters, `connector_runs`, `opportunity_scores`, opportunity score/confidence columns, and the worker-only RPCs. | **HIGH** | **Fixed.** INSERT/UPDATE revoked. Column-level grant: members may update only `opportunities.status` and the summaries of analyses they run. The worker RPCs are `service_role` only. Score reassessment moved to an `OPPORTUNITY_REASSESSMENT` worker job. |
| 3 | Worker health would have been readable by every organization owner. Every user owns a personal organization, so in practice by every user. | **HIGH** (would have leaked platform infrastructure) | **Fixed before release.** Readable only by `private.platform_operators`, an allow-list managed with the service role. Never exposes job ids. |
| 4 | Members could alter RUNNING `agent_runs` of pipeline runs. | MEDIUM | **Fixed.** The update policy is limited to agent runs without `research_run_id`, i.e. analyses started in the member's own request. |
| 5 | Agent runs and cost entries of *user-triggered analyses* (Red Team, competitors, CFO) are still inserted with the member's credentials. The rows are append-only: cost_ledger cannot be updated or deleted. | LOW | **Accepted for MVP.** Moving these analyses to worker jobs is a product-flow change, out of Phase 6 scope. A member can only add records to their own organization. |
| 6 | `jobs.payload` of `RESEARCH_COLLECTION` contains text a member pasted. It is visible to the same organization. | LOW | Accepted (same audience as `source_items`). |
| 7 | `request_research_cancellation`, `enqueue_job`, `cancel_job`, `requeue_dead_letter` and `worker_health_summary` are SECURITY DEFINER. | INFORMATIONAL | Each one pins `search_path=''`, checks `auth.uid()` plus membership, role or operator status, and is limited to one state change. Verified by `scripts/sql/verify-schema.sql`. |
| 8 | Dev-only `npm audit` finding: `braces` via `eslint-config-next`. | LOW | Not shipped. Production dependencies: 0 vulnerabilities. |

No CRITICAL findings are known. All HIGH findings are fixed and covered by DB tests.

## C. Hosted advisor findings

_Pending — not run._ Fill this in from `docs/advisors/security.json` and `docs/advisors/performance.json`. Fix every CRITICAL or HIGH finding that affects correctness or security, and record the reason for each one accepted.

| Advisor | Lint | Object | Level | Classification | Action |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |

Expected hosted-only items to review:
- Auth settings: leaked-password protection, OTP expiry, MFA. These are configured in the Dashboard, not in migrations.
- The Realtime publication.
