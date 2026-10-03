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
| Error leakage | actions return generic messages for internal errors; details logged as JSON | `actions/result.ts` |
| Headers | `X-Frame-Options: DENY`, nosniff, HSTS, Referrer-Policy, Permissions-Policy, `frame-ancestors 'none'`, no `X-Powered-By` | E2E |
| Open redirect | auth callback accepts only same-origin relative paths | code |

## Rate limiting

- Supabase Auth enforces its own auth rate limits.
- Research cost is bounded per run/day/month by the budget (a natural limiter for expensive work).
- Per-user rate limiting for expensive server actions: see Final QA (RELEASE notes).

## Security-definer functions

All live in `private` (not exposed by PostgREST) except `create_organization` and `record_audit_event`, which validate `auth.uid()`, membership and inputs and use `set search_path = ''`.

## Demo mode

`MRO_DEMO_MODE=true` disables authentication and stores data in process memory. It is ignored when Supabase is configured, shows a permanent banner, and must not be used with real data.
