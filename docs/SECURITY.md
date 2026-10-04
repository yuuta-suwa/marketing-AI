# Security

## Controls

| Requirement | Implementation | Verified by |
|---|---|---|
| User A cannot read/modify User B data | org-scoped RLS on every table; profiles self-only | `npm run test:db` |
| Org A cannot read Org B | `private.is_org_member` in every policy; composite FKs block cross-tenant links | `npm run test:db` |
| Roles | viewer < member < admin < owner from `organization_members` | DB tests + `authorization` unit tests |
| `user_metadata` not used for authorization | roles only from `organization_members`; metadata used only for display name at signup | code review, `server-context.ts` |
| service_role never in frontend | used only by `/api/cron/*` system jobs (server-only module, `CRON_SECRET` bearer, constant-time compare); every system query is scoped to an organization and opportunity reads are re-checked against the watchlist's org | `.env.example`, grep, E2E 401 test |
| No secrets in `NEXT_PUBLIC_*` | connector/AI keys read server-side only (`server-only` modules) | build |
| anon has no table access | `revoke all ... from anon` | DB tests |
| Human decisions attributable | `decisions.decided_by = auth.uid()` in RLS | DB tests |
| Audit log | `record_audit_event` (actor forced), admins read, no direct insert | DB tests |
| Append-only logs | `cost_ledger`, `connector_runs`, `opportunity_scores`, `red_team_reviews` have no update/delete policies | DB tests |
| Input validation | Zod on every server action, directive, connector output and AI output | unit tests |
| Unauthorized API access | every page/action re-resolves the session server-side; proxy is only an optimistic redirect | E2E 404 test |
| Data integrity | `public.integrity_report()` (orphan signals/opportunities, non-verbatim evidence, empty clusters, duplicate items) — all zero in tests | `npm run test:db` |
| Filter injection | user text in PostgREST `.or()` is stripped of grammar characters and quoted | code review |
| Error leakage | actions return generic messages for internal errors; details logged as JSON | `actions/result.ts` |
| Headers | `X-Frame-Options: DENY`, nosniff, HSTS, Referrer-Policy, Permissions-Policy, `frame-ancestors 'none'`, no `X-Powered-By` | E2E |
| Open redirect | auth callback accepts only same-origin relative paths | code |

## Rate limiting

- Supabase Auth enforces its own auth rate limits.
- Research cost is bounded per run/day/month by the budget (a natural limiter for expensive work).
- Per-user rate limiting (`public.consume_rate_limit`, atomic per user+bucket with an advisory lock; in-memory equivalent in demo) on research start, additional research, FRIDAY commands, analyses, report generation and URL import (`src/application/rate-limit.ts`).

## Security-definer functions

All live in `private` (not exposed by PostgREST) except `create_organization` and `record_audit_event`, which validate `auth.uid()`, membership and inputs and use `set search_path = ''`.

## Demo mode

`MRO_DEMO_MODE=true` disables authentication and stores data in process memory. It is ignored when Supabase is configured, shows a permanent banner, and must not be used with real data. In a production build it is rejected unless `ENABLE_MOCK_CONNECTORS=true` marks an explicit test deployment (E2E).

## Phase 5 additions

- **Job queue**: `public.jobs` is select-only for members (RLS). Enqueue/cancel/re-queue go through SECURITY DEFINER RPCs that check role and that referenced runs/opportunities belong to the organization (BOLA). `claim_jobs`, `heartbeat_job`, `complete_job`, `fail_job`, `release_job`, `job_queue_stats` are executable by `service_role` only. Every worker write is conditional on owning the lease.
- **Worker isolation**: the worker uses the service-role key but builds a context per job from the job's organization and owner, re-checks the owner's membership/role before executing, and every repository query filters `organization_id`. Audit rows written by the worker are attributed to the job owner (`metadata.via = "worker"`).
- **Mock safety**: mock connectors only with `NODE_ENV != production` or `ENABLE_MOCK_CONNECTORS=true`; otherwise the process throws. MOCK data is labelled and a persistent banner is shown; missing credentials never fall back to mocks.
- **Prompt injection**: see `src/domain/agent/prompt-boundary.ts`; suspicious content is flagged (`metadata.promptInjectionSuspected`) and still analysed only as data.
- **Unresolved warnings** are listed in `docs/PRODUCTION_READINESS_AUDIT.md` (Supabase advisors not runnable without a hosted project; member update policy on `research_runs`; dev-only `braces` advisory).

## Phase 6 additions

- **Worker-controlled data:**
  - Members cannot UPDATE `research_runs`. They can insert one only in a clean DRAFT/QUEUED state, created by themselves.
  - Members cannot write source items, evidence, signals, clusters, opportunity–evidence links, connector runs, opportunity scores, or `opportunities.score_total` / `confidence` / `momentum` / `organization_id`. Column-level grant: they may change `status` and their own analysis summaries.
  - Cancellation goes through `request_research_cancellation()`. Score reassessment is a worker job.
- **Platform operators:** worker health is readable only by `private.platform_operators`. Organization owners are not operators, because every user owns a personal organization.
- **`APP_ENV`:** explicit environment identity. Production never uses the demo store. Mocks need a flagged double opt-in there.
- **Credential diagnostics:** statuses only, never values.
- **Advisor lints:** run locally on every DB test run; ERROR-level findings fail CI. The hosted advisors are pending. See [SUPABASE_ADVISOR_REPORT.md](SUPABASE_ADVISOR_REPORT.md).
