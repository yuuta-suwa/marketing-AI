# Phase 6 — Live Validation

## Current status: **BLOCKED_ON_LIVE_INFRASTRUCTURE**

All code-side preparation is complete and tested. The live validation itself (hosted Supabase, deployed worker and frontend, real Brave / e-Stat / Anthropic data, the Golden Run) has **not** happened. No live result is claimed anywhere in this repository.

Verified blockers in the build environment (2026-10-04):

| Blocker | Evidence |
| --- | --- |
| No hosted Supabase project and no keys | `npm run golden-run` preflight: every Supabase credential is `MISSING` |
| No Brave / e-Stat / Anthropic credentials | same preflight: `READY_NEEDS_CREDENTIALS` |
| Egress denied to `api.search.brave.com`, `api.e-stat.go.jp`, `api.supabase.com` | proxy `connect_rejected` |

**Release decision: none.** A decision needs at least one Golden Run. The statuses are LIVE_VALIDATION_FAILED, LIVE_VALIDATION_PARTIAL and MVP_LIVE_VALIDATED. Production readiness remains **READY_WITH_LIMITATIONS** (Phase 5) and is not PRODUCTION_READY.

## What the human must supply (exact checklist)

**1. Hosted Supabase project** (one for staging; production later)
- Project ref and region.
- Enable the `vector` extension. Run `supabase link --project-ref <ref>`, then `supabase db push` to apply the **14** migrations.
- Auth:
  - Site URL = frontend URL; redirect `<frontend>/auth/callback`;
  - email/password provider on;
  - leaked-password protection on.
- Seed at least one platform operator (worker health visibility):
  ```sql
  insert into private.platform_operators (user_id, note) values ('<auth user uuid>', 'operator');
  ```

**2. Secrets.** Set them in the platform secret stores. Never paste them into chat or commit them.

| Variable | Where |
| --- | --- |
| `APP_ENV=staging` (later `production`) | web, worker |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web (URL also worker) |
| `SUPABASE_SERVICE_ROLE_KEY` | worker (and web, for cron enqueue) |
| `CRON_SECRET` (≥ 16 chars) | web |
| `BRAVE_SEARCH_API_KEY` + `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true` (only once your Brave plan permits storing results) | worker |
| `ESTAT_APP_ID` | worker |
| `ANTHROPIC_API_KEY` | worker (and web, for directive parsing) |
| `APP_VERSION` (commit sha; Vercel provides `VERCEL_GIT_COMMIT_SHA`) | worker build arg |
| Optional: `OPENAI_API_KEY` + `EMBEDDING_PROVIDER=openai` | worker |

**3. Deployments**
- **Worker:** build `Dockerfile.worker` with `--build-arg APP_VERSION=$(git rev-parse --short HEAD)` and run it on a long-running host with `WORKER_HEALTH_PORT`. Outbound access is needed to the Supabase host, `api.search.brave.com`, `api.e-stat.go.jp` and `api.anthropic.com`.
- **Frontend:** Vercel project with the web secrets.
- **Golden Run user:** an account that is a member of the target organization. Its id goes in `GOLDEN_RUN_USER_ID`.

**4. To run the validation from this cloud environment instead of a laptop**
- Add the hosts above (plus your `*.supabase.co` host) to the environment's network allowlist: environment settings → Network access → Custom → Allowed domains.
- Store the secrets as environment variables of the environment.

## Validation runbook (in order)

| # | Step | Command | Pass criterion |
| --- | --- | --- | --- |
| 1 | Migrations applied | `supabase db push` | 14 migrations, no errors |
| 2 | Schema verification | `SUPABASE_DB_URL=… npm run verify:hosted-db` | `HOSTED SCHEMA VERIFIED`, realtime publication includes `research_runs`, `jobs` |
| 3 | Advisors | `bash scripts/supabase-advisors.sh` (or Dashboard) | every CRITICAL/HIGH fixed; `docs/SUPABASE_ADVISOR_REPORT.md` §C filled |
| 4 | Worker health | `curl :$WORKER_HEALTH_PORT/healthz`; Settings › Observability as an operator | `HEALTHY`, version = deployed sha |
| 5 | Frontend health | `curl https://<app>/api/health` | `{ok:true, appEnv:"staging", mode:"supabase", mockConnectors:false, configErrors:0}` |
| 6 | Live connector smoke | `npm run smoke:live` | Brave and e-Stat `LIVE_READY`; Anthropic `LIVE_READY` |
| 7 | Live preflight | `npm run golden-run -- --preflight-only` | `READY`; Anthropic structured-output probe ok, with its cost reported |
| 8 | Golden Run | `npm run golden-run` | `MVP_LIVE_VALIDATED`, `mockSources: []`, evidence chain intact |
| 9 | Human review | run page › Quality review (≥ 2 reviewers) | KPI baselines recorded; `docs/MARKET_INTELLIGENCE_QUALITY_REVIEW.md` completed |
| 10 | PWA check | install on a phone; start research; watch progress | request returns immediately; Realtime progress updates |

## Environment separation

`APP_ENV` is explicit. Security behaviour never depends on hostnames.

| | local | staging | production |
| --- | --- | --- | --- |
| Mock connectors | allowed (`CONNECTOR_MOCK_MODE=true`) | only with `ENABLE_MOCK_CONNECTORS=true` | **off**. An override needs `ENABLE_MOCK_CONNECTORS=true` **and** `ALLOW_MOCK_IN_PRODUCTION=true`, and shows *PRODUCTION MOCK OVERRIDE* in the banner, `/api/health` and the logs |
| Demo store (`MRO_DEMO_MODE`) | allowed | only with `ENABLE_MOCK_CONNECTORS=true` (E2E) | **never** |
| Embedded worker | allowed | error | error |
| Missing `APP_ENV` on a production build | — | — | treated as production and reported as an error |

A real connector failure (outage, missing credentials, quota, malformed response) stays a failure. It is recorded with its class, and the run degrades to PARTIAL_SUCCESS or fails with the reason. Mock data is never substituted (`tests/integration/failure-behaviour.test.ts`).

## Preliminary PRODUCTION_READY threshold

All of the following must hold:
1. **3 independent Golden Runs** (different days or questions) reach `MVP_LIVE_VALIDATED`.
2. 0 critical security failures. Every CRITICAL/HIGH hosted advisor finding is addressed.
3. 0 cross-organization data leaks, both in the DB tests and in a staging test with two real tenants.
4. 0 duplicate business records from retries. The live worker restart test is repeated against hosted Supabase.
5. 100 % Opportunity → Evidence traceability (`checkEvidenceChain` on every Golden Run).
6. A mock source rate of 0 % in every Golden Run.
7. A successful worker recovery test on the deployed worker: kill it mid-job, then confirm the lease expires, another replica resumes, and no duplicates appear.
8. Budget enforcement verified live: one run with a deliberately low `MAX_COST_PER_RESEARCH_RUN` ends as PARTIAL_SUCCESS with the reason recorded.

## Code-side Phase 6 work (done)

- **Authorization lockdown:**
  - members cannot modify run state, cost, progress, errors, pipeline output, system scores or worker state;
  - cancellation goes through a secured RPC;
  - reassessment runs as a worker job.
  - Coverage: DB tests (`30_*.sql`) and request-path tests.
- **Environment identity and policy:** `APP_ENV`; the stricter mock and demo policy; credential diagnostics (CONFIGURED / MISSING / INVALID / EXPIRED / RATE_LIMITED / READY, never values).
- **Worker health:** `worker_heartbeats`, `/healthz`, and a platform-operator-only HEALTHY / DEGRADED / OFFLINE view.
- **Golden Run tooling:**
  - live preflight with a minimal Anthropic structured-output probe;
  - the Golden Run orchestrator (refuses MOCK);
  - evidence-quality metrics, product KPIs and the cost baseline;
  - the human review table (editable, in app);
  - the report generator.
- **Hosted DB tooling:** `verify:hosted-db`, `scripts/supabase-advisors.sh`, and the local advisor lints. The lints found 41 missing FK indexes, now fixed.
- **Failure behaviour tests:** Brave, e-Stat and Anthropic outages, malformed responses, quota, missing credentials, a temporary DB error, budget, and worker crash.
