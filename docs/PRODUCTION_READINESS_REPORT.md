# Production Readiness Report — Phase 5

Date: 2026-10-04 · Branch: `claude/market-radar-os-uyp7mf` · Baseline: `3610a8b` (v0.1.0, tag local only)

## Final status: **READY_WITH_LIMITATIONS**

The codebase can be deployed to the target architecture:
- Vercel for the frontend;
- Supabase for the database, Auth, Realtime and the queue;
- a separate worker process.

It meets the Phase 5 acceptance criteria in automated tests against real PostgreSQL and a production build.

It is **not** `PRODUCTION_READY`. No real infrastructure exists yet, and no external API has been called:
- there is no hosted Supabase project;
- no worker is deployed;
- no credentials are available in this environment;
- the live smoke workflow has not been run.

Until the gate in §11 passes, every market result the system produces comes from manual input or **labelled MOCK** data.

| Status | Definition used here |
| --- | --- |
| NOT_READY | Code or schema defects prevent a correct deployment |
| **READY_WITH_LIMITATIONS** | Deployable and verified in tests. External prerequisites and documented functional limits remain. |
| PRODUCTION_READY | Additionally: deployed, live connectors verified, real smoke workflow passed, advisors clean |

## 1. Architecture

```
PWA → Vercel (server action: create run + enqueue, returns immediately)
        → Supabase Postgres public.jobs ← worker (npm run worker): claim (SKIP LOCKED) → stage → enqueue next stage
                                                                     ↘ Brave / e-Stat / Anthropic (official APIs)
      ← Realtime (research_runs.progress_percent/current_action) · polling fallback
Vercel Cron → /api/cron/* → enqueue WATCHLIST_REFRESH / DAILY_BRIEF (idempotent per slot)
```

- **Research runs as four chained jobs**, each idempotent and resumable: RESEARCH_COLLECTION → SIGNAL_EXTRACTION → CLUSTER_GENERATION → OPPORTUNITY_GENERATION.
- **Other job types:** DEEP_RESEARCH, COMPETITOR_RESEARCH, MARKET_SIZE_RESEARCH, RED_TEAM, DAILY_BRIEF and WATCHLIST_REFRESH.
- **Queue ports** (`JobQueue` for users, `JobStore` for the worker) keep the Postgres queue replaceable.

Details: `docs/ARCHITECTURE.md` and `docs/PRODUCTION_DEPLOYMENT.md`.

## 2. Live capabilities (real code paths, no mocks)

These work with real data now:
- manual text, CSV and URL import (SSRF-guarded, robots.txt respected);
- the full evidence pipeline (evidence, signals, clusters, opportunities, score, confidence);
- Red Team, analyses, experiments and decisions;
- FRIDAY (rule-based);
- watchlists, daily brief, the cost ledger and the hard limits;
- the queue and worker.

Deterministic agents run without an LLM.

## 3. Mock capabilities

`CONNECTOR_MOCK_MODE=true` runs the real Brave, e-Stat and X adapters against canned responses:
- items are prefixed `[MOCK]` and carry `metadata.synthetic=true`;
- a persistent MOCK CONNECTORS banner is shown;
- Settings › Connectors shows mode `MOCK`;
- `/api/health` reports `mockConnectors:true`;
- spend is recorded as $0.

Mock mode is allowed only outside production, or with `ENABLE_MOCK_CONNECTORS=true` for a test deployment. A production process that asks for mocks without the opt-in refuses to run (`EnvironmentError`; the worker exits with code 78).

## 4. Connector status

| Connector | Code | Readiness here | To go live |
| --- | --- | --- | --- |
| Manual / CSV / URL import | IMPLEMENTED | NO_CREDENTIALS_REQUIRED | — |
| Web Search (Brave) | IMPLEMENTED + smoke test | **READY_NEEDS_CREDENTIALS** | `BRAVE_SEARCH_API_KEY`, `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true` (plan must permit storage) |
| e-Stat | PARTIAL (table metadata) + smoke test | **READY_NEEDS_CREDENTIALS** | `ESTAT_APP_ID` |
| Anthropic (LLM agents) | IMPLEMENTED + free `count_tokens` ping | **READY_NEEDS_CREDENTIALS** | `ANTHROPIC_API_KEY` |
| X | IMPLEMENTED + smoke test | READY_NEEDS_CREDENTIALS / PENDING COMPLIANCE | `X_BEARER_TOKEN`, `X_TERMS_CONFIRMED=true` after a terms review |
| Google Places, Tripadvisor | IMPLEMENTED | PENDING COMPLIANCE (will not run) | Licence / terms review |
| Instagram, Reddit, YouTube, others | Scaffold | NOT_IMPLEMENTED | Permitted access method and contract |
| OpenAI embeddings | IMPLEMENTED | Optional (local embeddings by default) | `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY` |

Each live connector has:
- credential validation;
- a health check;
- one minimal smoke request;
- a timeout and bounded retry with backoff (rate limits wait longer);
- error classification (AUTH / RATE_LIMITED / TIMEOUT / UPSTREAM_5XX / NETWORK / BAD_REQUEST / INVALID_RESPONSE);
- cost logging.

All of this is tested with stubbed HTTP. `npm run smoke:live` was run here: every credentialed connector reported READY_NEEDS_CREDENTIALS, and no network call was made.

## 5. Security status

- RLS is enabled on every table, and organization isolation uses composite tenant foreign keys. 115 DB assertions cover RLS, integrity and the queue.
- **`jobs`:** select-only for members.
  - Enqueue, cancel and re-queue go through SECURITY DEFINER RPCs with role checks and BOLA checks on referenced ids.
  - The worker RPCs are `service_role` only.
  - Every worker write is conditional on owning the lease.
- **Service role:** used only by the worker and the cron enqueue.
  - The worker re-verifies the job owner's membership and role for every job.
  - Each job's context is scoped to its organization.
  - Audit rows are attributed to the owner (`via: worker`).
- **IDOR / BOLA:** cross-org job, run and evidence access is rejected or invisible (integration tests and SQL tests). The approval gates (human decision, CEO for PoC/launch) are unchanged and DB-enforced.
- **Prompt injection:**
  - Every LLM call is separated into SYSTEM INSTRUCTIONS, `<user_directive>` and `<external_market_data>`, with inert JSON so tags cannot be forged.
  - Injected text is stored as data and flagged.
  - Invented evidence ids are rejected (tested).
- **Not done:** Supabase security and performance advisors (no hosted project). Unresolved warnings are listed in `PRODUCTION_READINESS_AUDIT.md`.
- **Dependencies:** production `npm audit --omit=dev` reports 0. Dev-only: 5 high findings from the `braces` chain in `eslint-config-next`, with no patched release yet. It is not shipped.

## 6. Queue status

The Postgres queue is implemented:
- idempotent enqueue (unique per org + key);
- priority and availability scheduling;
- `FOR UPDATE SKIP LOCKED` claims;
- leases with heartbeats;
- exponential backoff with jitter;
- `max_attempts`, after which the job is dead-lettered and its research run marked FAILED;
- cancellation (queued: immediate; processing: at the next checkpoint);
- admin re-queue;
- queue stats.

Verified on PostgreSQL 16 (`supabase/tests/20_job_queue.sql`) and with the in-memory implementation (`queue-worker.test.ts`).

## 7. Worker status

`npm run worker` (Node 22, `tsx`) or `Dockerfile.worker`:
- validates the environment at start and refuses to run on errors;
- writes structured JSON logs;
- backs off on DB errors;
- shuts down gracefully on SIGTERM/SIGINT, releasing claimed jobs and waking idle sleeps;
- exposes an optional `/healthz`;
- supports one-shot drains with `--once`.

Verified locally:
- the startup path and the poll/backoff/shutdown loop against an unreachable DB;
- full research execution through the worker in demo mode (E2E) and in tests.

It has **not** been deployed or run against a hosted Supabase.

## 8. Evidence integrity

`checkEvidenceChain()` traces every opportunity: Opportunity → Cluster → Signals → Evidence → SourceItem → URL / manual source. It verifies verbatim excerpts and organization-scoped resolution.

Tests prove that it:
- passes for real pipeline output;
- detects invented ids, cross-organization evidence and non-verbatim quotes.

DB triggers and constraints enforce the same rules. The new atomic RPCs ensure that no signal or opportunity is ever written without its evidence links.

## 9. Cost controls

The env hard limits cap the per-organization DB budgets:
- `MAX_COST_PER_RESEARCH_RUN`
- `MAX_DAILY_AI_COST`
- `MAX_MONTHLY_AI_COST`
- `MAX_SEARCH_REQUESTS_PER_RUN`
- `MAX_SOURCE_ITEMS_PER_RUN`
- `MAX_LLM_CALLS_PER_RUN`

When a limit is reached:
- completed work is kept;
- optional work stops (LLM calls fall back to heuristics, extra requests are skipped, excess items are not stored);
- the run ends as `PARTIAL_SUCCESS`;
- the reasons appear in `stats.limitStops` and on the run page.

Each limit has a dedicated test. A resumed stage counts earlier spend once toward the run limit, and not twice toward the daily or monthly limits. Automatic recurring *research* is not enabled.

## 10. Known limitations

- **FRIDAY and the Advisor Council are rule-based.** They have no conversational LLM. See `FRIDAY_CURRENT_CAPABILITIES.md`.
- **Data sources:**
  - e-Stat returns table metadata only; numeric values are not fetched.
  - Competitor analysis only names competitors found in collected evidence.
  - Market sizing is a calculator over explicit inputs.
- **Embeddings:** the default embeddings are lexical (local hash), and clustering is a single-pass MVP.
- **Notifications** are in-app only (no email or push).
- **Feedback loop:** the feedback loop records outcomes but does not learn automatically.
- **Request path:** the directive parse may make one synchronous LLM call in the web request. It is bounded by budget and the call cap, and has a rule-parser fallback.
- **Supabase project:** Realtime and Auth have not been verified against a hosted project. The polling fallback is verified in E2E.
- **Research run policy:** members can still update their organization's `research_runs`; the state-machine trigger still applies. Narrowing this is recommended once the worker is live.

## 11. Credentials still required

| Purpose | Variables |
| --- | --- |
| Core (web + worker) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` |
| Live market data | `BRAVE_SEARCH_API_KEY` + `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true`, and/or `ESTAT_APP_ID` |
| LLM agents | `ANTHROPIC_API_KEY` |
| Optional | `X_BEARER_TOKEN` + `X_TERMS_CONFIRMED`, `OPENAI_API_KEY` (+ `EMBEDDING_PROVIDER=openai`) |

## 12. Manual setup required (the gate to PRODUCTION_READY)

1. Create the Supabase project, run `supabase db push` (10 migrations), confirm the Realtime publication, and configure Auth URLs.
2. Run the Supabase security and performance advisors. Resolve ERROR-level findings.
3. Deploy the worker (`Dockerfile.worker`, at least 1 replica, `WORKER_HEALTH_PORT`) with the worker secrets.
4. Deploy the web app to Vercel with the web secrets, then confirm `/api/health` returns `{ok:true, mode:"supabase", mockConnectors:false}`.
5. Run `npm run smoke:live`. Brave and/or e-Stat and Anthropic must be `LIVE_READY`.
6. Run `npm run smoke:live -- --workflow` with the query 「日本の旅行市場で、利用者が感じている不満・不便・不足から新規事業機会を探して」. It must pass every step: Directive, Queue, Worker, Web/e-Stat source, Evidence, Signal, Cluster, at least 3 opportunities, Score, Confidence, Red Team, FRIDAY and the evidence chain, with `mockSources: []`. Then repeat the scenario once from the deployed PWA.
7. Push the release tag from a machine with tag rights: `git push origin v0.1.0`. The proxy here rejects tag pushes; this was verified on 2026-10-04.

## 13. Verification summary (this commit)

| Check | Result |
| --- | --- |
| Unit + integration (Vitest) | **187 passed** in 20 files. 53 are new in Phase 5: queue/worker 19, production hardening 16, unit 18. |
| Database (PostgreSQL 16 + pgvector, RLS, queue) | **115 assertions passed** |
| E2E (Playwright, production build, mobile/iPhone/Android/desktop) | **57 passed** |
| Lint / typecheck / production build | pass / pass / pass |
| Dependency audit | production 0 vulnerabilities. Dev-only: 5 high (`braces` via `eslint-config-next`, no fix published). |
| Live connector smoke | not executable here: READY_NEEDS_CREDENTIALS |
| Real scenario harness | passes on MOCK sources (reported as such); the live run is pending credentials |

Scenarios covered explicitly:
- worker restart mid-job (lease expiry, resume, no duplicates against a clean baseline);
- connector timeout;
- one connector failing while the others succeed;
- duplicate queue delivery;
- retry and backoff;
- dead letter;
- cancellation;
- tenancy.
