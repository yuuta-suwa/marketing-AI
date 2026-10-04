# Environment

The source of truth is `src/infrastructure/env-contract.ts` (`ENV_CONTRACT`). It is mirrored by `.env.example`, and a unit test fails if the two drift apart.

## Processes

| Process | Runs | Gets |
| --- | --- | --- |
| **web** | Next.js on Vercel (PWA, server actions, `/api/*`) | Public Supabase config, `CRON_SECRET`, optional AI key (directive parsing) |
| **worker** | `npm run worker` on any long-running Node 22 host | Service-role key, connector and AI credentials, limits |

The web process only **enqueues** jobs. It never executes collection or analysis.

`SUPABASE_SERVICE_ROLE_KEY` is needed on the web side only if the `/api/cron/*` routes run there, because they enqueue scheduled jobs.

## Variables

### REQUIRED_FOR_CORE

| Variable | Process | Secret | Notes |
| --- | --- | --- | --- |
| `APP_ENV` | both | no | `local` / `staging` / `production`. **Required for production builds.** It drives the mock, demo and embedded-worker policy (see below). If it is missing on a production build, the app assumes `production` and reports an error. |
| `NEXT_PUBLIC_SUPABASE_URL` | both | no | Supabase project URL (https outside local) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | no | Publishable or legacy anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted). RLS protects data. |
| `SUPABASE_SERVICE_ROLE_KEY` | worker (+ web for cron) | **yes** | Bypasses RLS. The worker filters every query by the job's organization. Never put it in a browser or a user-request path. |
| `CRON_SECRET` | web | **yes** | Bearer token for `/api/cron/*`. At least 16 characters. Vercel Cron sends it. |

### REQUIRED_FOR_CONNECTOR

When a variable is missing, its connector reports **READY_NEEDS_CREDENTIALS** in Settings › Connectors and in `npm run smoke:live`. It is never replaced by mock data.

| Variable(s) | Unlocks | Extra condition |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | LLM agents (MarketDirector, PainMiner, ClusterNamer, JTBDAnalyst, RedTeam, CompetitorAnalyst) | Without it every agent uses its deterministic fallback |
| `BRAVE_SEARCH_API_KEY` + `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true` | `web_search` | Your Brave plan must permit storing results |
| `ESTAT_APP_ID` | `estat` | Attribution required: 出典：政府統計の総合窓口(e-Stat) |
| `X_BEARER_TOKEN` + `X_TERMS_CONFIRMED=true` | `x` | Developer terms for your tier reviewed |
| `GOOGLE_PLACES_API_KEY` | `google_places` | PENDING_REVIEW: will not run even with a key |
| `TRIPADVISOR_API_KEY` | `tripadvisor` | PENDING_REVIEW: will not run even with a key |
| `OPENAI_API_KEY` | OpenAI embeddings | Only with `EMBEDDING_PROVIDER=openai` |

### OPTIONAL

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` if the key is set, else `none` | An explicit `anthropic` without a key is an **error**. Any value other than `anthropic` or `none` is an error. |
| `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | built-in default / `medium` | |
| `EMBEDDING_PROVIDER` | `local` | `openai` without `OPENAI_API_KEY` is an **error** |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | |
| `GEMINI_API_KEY` | — | Reserved; no adapter yet |
| `MAX_COST_PER_RESEARCH_RUN` | `1` (USD) | Hard limits cap each organization's DB budget. Invalid values are an **error**. |
| `MAX_DAILY_AI_COST` | `10` | Counts all metered spend in `cost_ledger` (AI, embeddings, search) |
| `MAX_MONTHLY_AI_COST` | `100` | |
| `MAX_SEARCH_REQUESTS_PER_RUN` | `10` | Each external request attempt counts, retries included. Manual import does not count. |
| `MAX_SOURCE_ITEMS_PER_RUN` | `200` | Items above the cap are not stored |
| `MAX_LLM_CALLS_PER_RUN` | `40` | Includes the directive parse. Heuristic agents are exempt. |
| `WORKER_ID` | `hostname-pid` | Shown in leases and logs |
| `WORKER_CONCURRENCY` | `1` | Jobs claimed per poll; they run sequentially |
| `WORKER_POLL_INTERVAL_MS` | `2000` | Idle poll interval. Backs off on DB errors. |
| `WORKER_LEASE_SECONDS` | `120` | Heartbeat every lease/4 |
| `WORKER_HEALTH_PORT` | off | Serves `GET /healthz` with queue stats |
| `WORKER_MODE` | `external` | `embedded` drains the queue inside `next dev`. Development only; an **error** in production. |

When a hard limit is hit:
- completed work is kept;
- optional work stops;
- the run ends as `PARTIAL_SUCCESS`;
- `stats.limitStops` lists what was skipped, and the run page shows it under 「省略した処理（上限）」.

### Operator tooling (never deployed)

| Variable | Used by |
| --- | --- |
| `GOLDEN_RUN_USER_ID`, `GOLDEN_RUN_ORG_ID`, `GOLDEN_RUN_TIMEOUT_SECONDS` | `npm run golden-run` |
| `SUPABASE_DB_URL` (secret) | `npm run verify:hosted-db` |
| `SUPABASE_ACCESS_TOKEN` (secret), `SUPABASE_PROJECT_REF` | `scripts/supabase-advisors.sh` |
| `APP_VERSION` | worker health / `/api/health` (defaults to `VERCEL_GIT_COMMIT_SHA` / `GIT_COMMIT_SHA` / `dev`) |

### DEVELOPMENT_ONLY — mock and demo policy (by `APP_ENV`)

| | local | staging | production |
| --- | --- | --- | --- |
| `CONNECTOR_MOCK_MODE=true` | allowed | needs `ENABLE_MOCK_CONNECTORS=true` | rejected. An override needs `ENABLE_MOCK_CONNECTORS=true` **and** `ALLOW_MOCK_IN_PRODUCTION=true`, and is shown as **PRODUCTION MOCK OVERRIDE** (banner, `/api/health`, logs) |
| `MRO_DEMO_MODE=true` | allowed | needs `ENABLE_MOCK_CONNECTORS=true` (E2E test deployment) | **never** |
| `WORKER_MODE=embedded` | allowed | error | error |

| Variable | Rule |
| --- | --- |
| `MRO_DEMO_MODE` | In-process demo store (see the table above). |
| `CONNECTOR_MOCK_MODE` | Real adapters run against canned responses. Items are labelled `[MOCK]` with `metadata.synthetic=true`, a persistent **MOCK CONNECTORS** banner is shown, and spend is recorded as $0. When not allowed, the process **refuses** (EnvironmentError). |
| `ENABLE_MOCK_CONNECTORS` | Explicit opt-in for a staging or E2E test deployment. |
| `ALLOW_MOCK_IN_PRODUCTION` | Second flag for a production mock override. Never set it in normal operation. |
| `CONNECTOR_MOCK_FAIL` | Comma-separated connector ids that fail in mock mode |
| `MRO_LOG_IN_TESTS` | Print structured logs in vitest |

## Failure behaviour

- `validateEnvironment(role)` returns errors, warnings and the connectors that are missing credentials. Only variable **names** are reported, never values.
- **Worker:** refuses to start on any error. It exits with code 78 (`EX_CONFIG`) and logs `worker.invalid_environment`.
- **Web:**
  - `/api/health` returns 503 with `configErrors > 0`. Public output contains counts only.
  - The login page lists the misconfigured variable names while the app is unconfigured.
  - A production process that asks for mock connectors without the opt-in throws when it builds a context.
- **Missing credentials never fall back to mock data.** The connector stays DISABLED with READY_NEEDS_CREDENTIALS. A run with no runnable source fails with an explicit reason.

## Credential diagnostics

`src/infrastructure/credentials.ts` reports each Golden Run credential by **name** with one status:

| Status | Meaning |
| --- | --- |
| `MISSING` | not set |
| `INVALID` | malformed, or rejected by the provider (401/403). Example: a service-role key equal to the publishable key. |
| `EXPIRED` | rejected with an expiry message |
| `RATE_LIMITED` | 429 during the live check |
| `CONFIGURED` | set and well-formed; not live-checked, or the check was inconclusive (timeout / network) |
| `READY` | the live check succeeded |

The worker publishes its statuses in worker health (Settings › Observability, platform operators only). `npm run golden-run -- --preflight-only` prints them after live checks. Values are never printed.

## Checking an environment

```bash
npm run smoke:live                      # credential validation + one minimal live request per configured connector
npm run smoke:live -- --workflow        # + the real research scenario (needs a live web or e-Stat source)
curl -s https://<app>/api/health        # web process
curl -s http://<worker>:$WORKER_HEALTH_PORT/healthz
```
