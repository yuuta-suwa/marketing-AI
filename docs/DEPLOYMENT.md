# Deployment

## 1. Supabase

1. Create a project (PostgreSQL 15+). Enable the `vector` extension (Database → Extensions) if not already available.
2. Apply migrations in order:
   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations/*.sql
   ```
   (or paste each file into the SQL editor in filename order).
3. Auth → URL configuration: Site URL = your app URL; add `<app-url>/auth/callback` to redirect URLs.
4. Auth → Providers: Email (password). Email confirmation on is recommended.
5. Copy the project URL and the **publishable** (or legacy anon) key. Do **not** use the service-role key in the web app.

Signup automatically creates a profile, a personal organization (owner), and default scoring weights.

## 2. Environment

Set the variables from `.env.example` on the hosting platform:

| Variable | Scope | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`) | server | optional (deterministic agents otherwise) |
| `BRAVE_SEARCH_API_KEY`, `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED` | server | optional |
| `ESTAT_APP_ID` | server | optional |
| `X_BEARER_TOKEN`, `X_TERMS_CONFIRMED` | server | optional |

Never set `MRO_DEMO_MODE=true` in production (it is ignored when Supabase is configured).

## 3. App (Vercel or any Node host)

```bash
npm ci
npm run build
npm start
```

- Node 22+.
- Research runs execute via `after()` within the request's max duration; for long runs set the platform's function max duration (e.g. 60–300 s). M3 moves execution to a queue worker.
- PWA: `manifest.webmanifest` and `sw.js` are served from the app root; HTTPS is required for installation.

## 4. Scheduled jobs

`vercel.json` schedules `/api/cron/monitor` (hourly, watchlists) and `/api/cron/daily-brief` (22:43 UTC ≈ 07:43 JST). Set `CRON_SECRET` (≥16 chars) and `SUPABASE_SERVICE_ROLE_KEY` on the server. On other hosts, call the routes with `Authorization: Bearer $CRON_SECRET`.

## 5. Post-deploy checks

- Sign up two users; confirm neither sees the other's runs.
- Settings → Connectors shows credential and compliance status for each connector.
- Run a research with manual data; confirm COMPLETED with ≥3 opportunities.
