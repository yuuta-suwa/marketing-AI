# Production Deployment

```
Mobile / PWA ──► Vercel (Next.js web)  ──enqueue──►  Supabase Postgres (jobs, data, RLS, Auth, Realtime)
                     │  ▲                                     ▲          │
                     │  └──── Realtime / polling progress ────┘          │ claim / heartbeat / complete
                     └── Vercel Cron → /api/cron/* (enqueue only)        ▼
                                                        Worker (npm run worker, any Node 22 host / container)
                                                              └─► Brave · e-Stat · Anthropic (official APIs)
```

- The web tier never executes research. It creates the run, enqueues a job and returns.
- The worker is a separate long-running process. It is not tied to Vercel request limits.
- The queue sits behind ports (`src/application/jobs/ports.ts`), so the Postgres queue can later be swapped for another provider without touching the pipeline.

## 1. Supabase

1. Create a project (PostgreSQL 15+). Enable the `vector` extension.
2. Apply the migrations in filename order:
   ```bash
   supabase link --project-ref <ref>
   supabase db push            # supabase/migrations/*.sql (10 files)
   ```
   `20261004000100_job_queue.sql` adds `jobs`, the worker RPCs, progress columns, the idempotency constraints and the Realtime publication entries.
3. **Realtime:** confirm `research_runs` and `jobs` appear under Database → Publications → `supabase_realtime`. The migration adds them when the publication exists.
4. **Auth:**
   - Site URL is the app URL. Redirect URL is `<app>/auth/callback`.
   - Enable the Email (password) provider. Turn email confirmation on.
5. **Advisors:** run `supabase db advisors` (or Dashboard → Advisors) for both security and performance. Resolve any ERROR-level finding before going live, and record warnings in `docs/SECURITY.md`.
6. **Keys:**
   - The web app gets the publishable key.
   - The worker gets the service-role key.
   - Never give the web app the service-role key, except for the cron routes.

## 2. Secrets and environment

Full contract: [`docs/ENVIRONMENT.md`](ENVIRONMENT.md).

| Process | Must have | Must NOT have |
| --- | --- | --- |
| Vercel (web) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (cron enqueue only) | `MRO_DEMO_MODE`, `CONNECTOR_MOCK_MODE`, `ENABLE_MOCK_CONNECTORS`, `WORKER_MODE=embedded` |
| Worker | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, connector/AI credentials, `MAX_*` limits | the mock and demo flags above |

- Store secrets in the platform's secret manager (Vercel Environment Variables, or the worker host's secrets).
- Never commit them or put them in `NEXT_PUBLIC_*`.
- Before the first deploy, run `npm run smoke:live` with the worker's environment. Every configured connector must report `LIVE_READY`; anything else lists the exact variables that are missing.

## 3. Worker

The worker is a plain Node process with no web server. It needs outbound HTTPS to Supabase and the connector APIs.

```bash
# any VM / container host (Fly.io, Render, Railway, ECS, Cloud Run jobs with min instances, a VPS…)
docker build -f Dockerfile.worker -t market-radar-worker .
docker run -d --restart=always --env-file worker.env -e WORKER_HEALTH_PORT=8080 -p 8080:8080 market-radar-worker
# or without Docker
npm ci --omit=dev && npm run worker
```

**Behaviour:**
- Polls `claim_jobs` (`FOR UPDATE SKIP LOCKED`). Leases default to 120 s, with a heartbeat every lease/4.
- Retries transient errors with exponential backoff and jitter (15 s → 15 min), up to `max_attempts`, which defaults to 5.
- Dead-letters jobs that exhaust their attempts or hit a non-retryable error. The research run is then marked `FAILED` with the reason. Dead letters are listed in Settings › Observability, and admins can re-queue them.

**Scaling:**
- Run 2 or more replicas for availability. Leasing guarantees one owner per job.
- Stages are idempotent, so a duplicate delivery or a crashed replica never duplicates evidence or opportunities.

**Shutdown:**
- SIGTERM stops claiming. The current job stops at its next checkpoint or finishes.
- Its lease expires and another replica resumes it.
- Give the container at least 30 s to stop.

**Logs:** one JSON object per line on stdout, carrying `job_id`, `job_type`, `organization_id`, `research_run_id`, `attempt`, `worker_id`, `status` and `duration_ms`. Secrets are redacted by key name.

**One-shot drain** (e.g. a scheduled container): `npm run worker -- --once`.

## 4. Frontend (Vercel)

1. Import the repository. Framework: Next.js. Node 22.
2. Set the web environment variables from §2.
3. Deploy. `npm run build` runs typegen, the type check and the production build.
4. PWA: HTTPS is required for installation. `manifest.webmanifest` and `sw.js` are served from the root.

The default function duration is sufficient. Requests now only create a directive and run and enqueue a job; the directive parse may make one LLM call.

## 5. Cron and watchlists

`vercel.json`:
- `/api/cron/monitor` runs hourly at :17 and enqueues `WATCHLIST_REFRESH`, one job per user with active watchlists. The idempotency key is per hour.
- `/api/cron/daily-brief` runs at 22:43 UTC (about 07:43 JST) and enqueues `DAILY_BRIEF`, one job per organization owner. The key is per day.

Both routes require `Authorization: Bearer $CRON_SECRET` (constant-time comparison), stay short (60 s max) and execute nothing themselves. On other hosts, call them from any scheduler with the bearer header.

Automatic recurring *research* is not enabled. Turn it on only after reviewing the cost limits (`MAX_*`) against real spend in Settings › Costs.

## 6. Health checks

| Endpoint | Use | Healthy |
| --- | --- | --- |
| `GET /api/health` (web) | Uptime monitor, deploy gate | `200 {ok:true, mode:"supabase", mockConnectors:false, configErrors:0}` |
| `GET :$WORKER_HEALTH_PORT/healthz` (worker) | Container liveness and readiness | `200 {ok:true, queue:[…]}`. It returns 503 if the DB is unreachable. |
| Settings › Observability | Operators | No growing dead-letter list. Jobs do not sit `QUEUED` for more than a minute. The run page warns when a job has waited over 60 s for a worker. |

**Alert on:**
- `worker.dead_lettered` and `worker.poll_failed` log events;
- `/api/health` returning non-200;
- the oldest `QUEUED` job (`job_queue_stats()`) being older than 5 minutes.

## 7. Release procedure and rollback

1. Run `npm run lint && npm run typecheck && npm test && npm run test:db && npm run build && npm run test:e2e`.
2. Apply the migrations (`supabase db push`). Migrations are additive in this release (new table, columns, indexes and functions).
3. Deploy the worker first. It is backwards compatible: it only claims jobs.
4. Deploy the web app.
5. Run `npm run smoke:live -- --workflow` against the deployed environment's credentials. Then run one real research from the PWA and check that its progress reaches 100%.

**Rollback:**
- **Web:** Vercel "Promote previous deployment". Jobs created by the new version stay in the queue and the worker keeps processing them.
- **Worker:** redeploy the previous image. In-flight jobs are re-claimed after their lease expires, and stages are idempotent.
- **Database:** there are no destructive migrations in this release. If the job queue must be removed, run a reviewed down-script, but first stop the worker and confirm that no `PROCESSING` jobs remain. Do not drop `jobs` while runs are in progress.
- To stop all background work immediately, scale the worker to 0. Queued jobs wait safely, and runs show the "waiting for worker" notice.

## 8. Release tag

The annotated tag `v0.1.0` exists locally at `3610a8b`. The build environment's git proxy only permits pushing the working branch. A maintainer with push rights should run:

```bash
git push origin v0.1.0
```

This does not block the application. No new tag is created for Phase 5.
