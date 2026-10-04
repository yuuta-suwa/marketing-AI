# Production Readiness Audit

Audited: 2026-10-04.
Baseline: commit `3610a8b` (`release: market radar os mvp`, local tag `v0.1.0`).
Method: I read the code, migrations, tests, routes and environment contract directly. Earlier completion reports were not trusted. Each claim below points to the file that shows it.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **IMPLEMENTED** | Working code path, covered by automated tests. |
| **PARTIAL** | Works, but a stated part of the scope is missing or simplified. |
| **MOCK** | Only runs against canned or synthetic data. |
| **NOT IMPLEMENTED** | Scaffold or placeholder only. |
| **BLOCKED** | Code exists, but live use needs credentials or infrastructure this environment lacks. |
| **PENDING COMPLIANCE** | Code exists, but execution is gated until terms or a licence review is done. |

The **Live** column says whether the component was exercised against real external services in this audit. No credentials are available in the build environment, so no external API was called. Supabase-specific behaviour (RLS, triggers, RPCs) runs against real PostgreSQL 16 using a Supabase shim (`supabase/tests/00_supabase_shim.sql`), not against a hosted project.

## Component audit

### Platform

| Component | At `3610a8b` (verified) | After Phase 5 | Live | Evidence (code) |
| --- | --- | --- | --- | --- |
| Authentication | IMPLEMENTED | IMPLEMENTED | BLOCKED (no hosted Supabase) | Email + password via Supabase Auth: `src/app/actions/auth.ts`, `src/app/auth/callback`. Session refresh: `src/proxy.ts`. Route guard: `src/lib/auth-guard.ts`. Role comes from `organization_members`, never from user metadata: `src/infrastructure/server-context.ts`. |
| Supabase | IMPLEMENTED (schema) | IMPLEMENTED (+ job queue migration) | BLOCKED | 10 migrations in `supabase/migrations/`, applied by `scripts/test-db.sh` on PostgreSQL 16 + pgvector. Never applied to a hosted project. |
| RLS | IMPLEMENTED | IMPLEMENTED | Real PostgreSQL | RLS is enabled on every public table (`20261003000400_security.sql`). `jobs` allows select only; writes go through SECURITY DEFINER RPCs. 115 DB assertions pass (`supabase/tests/10_*.sql`, `20_job_queue.sql`). |
| Organization isolation | IMPLEMENTED | IMPLEMENTED | Real PostgreSQL + unit | Composite tenant foreign keys `(id, organization_id)`. Every Supabase repository query filters `organization_id`, including under the service role. The worker re-checks membership for each job (`src/infrastructure/worker/runtime.ts`). Tests: `queue-worker.test.ts` (tenancy), `20_job_queue.sql` (BOLA). |
| Background Jobs | **PARTIAL** — research ran in `after()` inside the request (`src/app/actions/research.ts@3610a8b`). Additional research ran synchronously in the request. | IMPLEMENTED | BLOCKED (needs hosted DB + worker process) | Postgres queue: `public.jobs` with `claim_jobs` (`FOR UPDATE SKIP LOCKED`), `heartbeat_job`, `complete_job`, `fail_job`, `release_job`. Provider-agnostic ports: `src/application/jobs/ports.ts`. Worker: `src/application/jobs/worker.ts`. Process entry: `scripts/worker.ts`. |
| Realtime Progress | **NOT IMPLEMENTED** — 2 s `router.refresh()` polling with no percentage. | IMPLEMENTED | Polling verified in E2E. Realtime BLOCKED (no hosted project). | `research_runs.progress_percent` and `current_action`. Both tables are added to the `supabase_realtime` publication. UI: `src/components/run-progress.tsx` (Realtime with polling fallback, backoff 2 s → 10 s). |
| Cost Ledger | IMPLEMENTED | IMPLEMENTED + env hard limits | Unit / integration | `cost_ledger`, `org_spend_usd`, `BudgetTracker`. Phase 5 adds `MAX_*` limits (`src/application/limits.ts`) and stops counting MOCK requests as spend. |
| Production Deployment | PARTIAL — `vercel.json`, `docs/DEPLOYMENT.md`, no worker. | PARTIAL / BLOCKED | Not deployed | `docs/PRODUCTION_DEPLOYMENT.md`, `/api/health`, worker `/healthz`. Real infrastructure has not been provisioned. |

### Research pipeline

| Component | At `3610a8b` | After Phase 5 | Live | Evidence |
| --- | --- | --- | --- | --- |
| Research Directive | IMPLEMENTED | IMPLEMENTED | LLM path BLOCKED (no key) | `create-research.ts`, `agents/market-director.ts`. Rule parser fallback. The LLM parse now counts toward `MAX_LLM_CALLS_PER_RUN`. |
| Research State Machine | IMPLEMENTED | IMPLEMENTED (stage-resumable) | Real PostgreSQL | SQL trigger and TypeScript state machine kept in sync (`tests/unit/state-machines.test.ts`). The pipeline runs as four idempotent stages with checkpoints (`pipeline.ts`). |
| Manual Connector | IMPLEMENTED | IMPLEMENTED | n/a (user data) | `connectors/manual-import.ts`, `url-import.ts`, CSV import. |
| Web Search Connector (Brave) | IMPLEMENTED (mock-tested) | IMPLEMENTED + `smokeTest` | **BLOCKED** → READY_NEEDS_CREDENTIALS (`BRAVE_SEARCH_API_KEY`, `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED`) | `connectors/web-search.ts`, `search/brave.ts`. Snippets only; result pages are never crawled. Stays PENDING_REVIEW until storage rights are confirmed. |
| e-Stat Connector | PARTIAL (table metadata only, mock-tested) | PARTIAL + `smokeTest` | **BLOCKED** → READY_NEEDS_CREDENTIALS (`ESTAT_APP_ID`) | `connectors/estat.ts`. Returns statistics table metadata as STATISTIC evidence. Numeric values are not fetched automatically; market sizing uses explicit inputs. |
| X Connector | PENDING COMPLIANCE (mock-tested) | PENDING COMPLIANCE | BLOCKED (`X_BEARER_TOKEN`, `X_TERMS_CONFIRMED`) | `connectors/x.ts`. Official API v2 recent search only. |
| Google Places Connector | PENDING COMPLIANCE | PENDING COMPLIANCE | Will not run | `connectors/google-places.ts`. Content-storage terms need review. |
| Tripadvisor Connector | PENDING COMPLIANCE | PENDING COMPLIANCE | Will not run | `connectors/tripadvisor.ts`. Licence for analytical storage needed. |
| Instagram Connector | NOT IMPLEMENTED | NOT IMPLEMENTED | — | Scaffold in `connectors/scaffold.ts` (DISABLED_PENDING_COMPLIANCE). The Graph API does not allow general post collection. |
| Reddit Connector | NOT IMPLEMENTED | NOT IMPLEMENTED | — | Scaffold (DISABLED_PENDING_COMPLIANCE). Commercial or AI use needs a Reddit contract. |
| Evidence | IMPLEMENTED | IMPLEMENTED (+ unique per source/excerpt) | Real PostgreSQL | Verbatim-excerpt trigger. `evidence_source_text_uidx` makes re-delivery idempotent. Chain checker: `application/integrity/evidence-chain.ts`. |
| Signal Extraction | IMPLEMENTED | IMPLEMENTED (atomic + resumable) | LLM path BLOCKED | `stages/extract-signals.ts`, `agents/pain-miner.ts`. Signal and its evidence links are inserted in one transaction (`insert_signals_with_evidence`). |
| Embedding | PARTIAL | PARTIAL | OpenAI BLOCKED | Default is `local-hash` (lexical, zero cost). The OpenAI `text-embedding-3-small` adapter exists but has not been run live. |
| Clustering | IMPLEMENTED | IMPLEMENTED (deterministic by content) | — | `domain/cluster/cluster.ts`: single-pass centroid clustering. Phase 5 makes ordering content-based so results no longer depend on random ids. |

### Opportunity and analysis

| Component | At `3610a8b` | After Phase 5 | Live | Evidence |
| --- | --- | --- | --- | --- |
| Opportunity Engine | IMPLEMENTED | IMPLEMENTED (unique per cluster, atomic) | LLM path BLOCKED | `stages/generate-opportunities.ts`. `create_opportunity_with_evidence` RPC. `opportunities_cluster_uidx`. |
| Opportunity Score | IMPLEMENTED | IMPLEMENTED | — | 14 criteria, weights sum to 100 (enforced in the DB): `domain/scoring/score.ts`. |
| Evidence Confidence | IMPLEMENTED | IMPLEMENTED | — | `domain/scoring/confidence.ts`. Kept separate from Score. |
| Market Sizing | PARTIAL | PARTIAL | — | `application/analysis/market-size.ts`. A deterministic calculator over explicit inputs (FACT with evidence, or ASSUMPTION). No automatic data retrieval. |
| Competitor Analysis | PARTIAL | PARTIAL | LLM path BLOCKED | `analysis/competitors.ts`. Only competitors named in collected evidence; no external competitor search. |
| Business Model | IMPLEMENTED (rule-based) | IMPLEMENTED (rule-based) | — | `analysis/business-model.ts`. |
| CFO Analysis | IMPLEMENTED (deterministic) | IMPLEMENTED | — | `domain/analysis/cfo.ts`. Unit economics from labelled assumptions. |
| Red Team | IMPLEMENTED | IMPLEMENTED | LLM path BLOCKED | `opportunity/red-team.ts`, `agents/red-team.ts`. Heuristic fallback. |
| Additional Research | IMPLEMENTED (synchronous in request) | IMPLEMENTED (queued) | — | `opportunity/additional-research.ts` returns `{runId, jobId}`. The worker runs the stages and incorporates evidence into the opportunity. |
| Experiment | IMPLEMENTED | IMPLEMENTED | — | Human approval gate and state machine (DB-enforced). |

### Executive layer

| Component | At `3610a8b` | After Phase 5 | Live | Evidence |
| --- | --- | --- | --- | --- |
| FRIDAY | PARTIAL (rule-based) | PARTIAL (rule-based; research now queued) | — | See `docs/FRIDAY_CURRENT_CAPABILITIES.md`. |
| Advisor Council | PARTIAL (rule-based perspectives) | PARTIAL | — | `domain/executive/advisor-council.ts`. Analytic perspectives, not people. No LLM. |
| Watchlist | IMPLEMENTED | IMPLEMENTED (cron enqueues `WATCHLIST_REFRESH`) | BLOCKED (cron needs deployment) | `executive/watchlist.ts`, `api/cron/monitor`. |
| Daily Brief | IMPLEMENTED | IMPLEMENTED (cron enqueues `DAILY_BRIEF`) | BLOCKED | `executive/daily-brief.ts`, `api/cron/daily-brief`. |
| Notifications | PARTIAL (in-app only) | PARTIAL | — | `notifications` table with dedupe. No email or push channel. |
| PoC Generator | IMPLEMENTED (template) | IMPLEMENTED | — | `executive/poc.ts`. Gated: marked DRAFT unless the PoC is approved. |
| Claude Code Export | IMPLEMENTED (template) | IMPLEMENTED | — | `exportClaudeCodePrompt` (CEO-gated content). |
| Feedback Loop | PARTIAL | PARTIAL | — | `executive/feedback.ts`. Outcomes are recorded and exported (`opportunity_lineage`). Nothing learns from them automatically yet. |

## Critical issues found and fixed in Phase 5

1. **Research ran inside the HTTP request lifecycle.**
   - `after()` in the start-research action, and fully synchronous additional research in `additionalResearchAction`.
   - Fix: enqueue-only actions plus a Postgres-backed worker.
2. **Mock connectors could not be enabled in a production build safely, and misconfiguration was silent.**
   - `AI_PROVIDER=anthropic` or `EMBEDDING_PROVIDER=openai` without a key quietly degraded.
   - Fix: `validateEnvironment()` reports these as errors. The worker exits with code 78. `/api/health` returns 503.
3. **No idempotency for re-executed stages.**
   - Evidence, signals and opportunities could be duplicated by a re-run.
   - Fix: unique constraints, atomic RPCs, stage checkpoints, and discarding partial output before a stage resumes.
4. **Clustering depended on random UUID order.**
   - Identical input could produce 9 or 10 clusters.
   - Found by the new crash/resume test. Fixed with content-based ordering.
5. **`enqueue_job` had an ambiguous column reference.**
   - Found by the new DB test.
   - Fixed with a named constraint.
6. **Mock requests recorded fake search spend.**
   - Fix: MOCK connectors now record $0.
7. **Worker audit rows were not attributed to anyone.**
   - Fix: they are now attributed to the job owner, with `via: worker`.

## Unresolved (documented, not blocking the code)

- **No hosted Supabase project.** `supabase db advisors` (security and performance) could not be run.
  - Manual review of the new SQL: every SECURITY DEFINER function sets `search_path = ''` and revokes PUBLIC.
  - Worker RPCs are granted to `service_role` only.
- ~~**Members can update their own organization's `research_runs` rows.**~~ **Resolved in Phase 6.** Members have no UPDATE on runs; cancellation goes through an RPC. Pipeline output and system scores are worker-only. See `docs/SUPABASE_ADVISOR_REPORT.md` §B.
- **The `jobs.payload` of `RESEARCH_COLLECTION` holds the manual text a member pasted.**
  - Members of the same organization can read it. That is the same audience as `source_items`.
- **Dev-only npm audit finding.**
  - `braces` is pulled in through `eslint-config-next`. No patched version is published yet.
  - Production dependencies: 0 vulnerabilities (`npm audit --omit=dev`).
