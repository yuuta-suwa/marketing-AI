-- Phase 6: worker health. Workers (service_role) upsert one row each; members
-- have no access. Platform operators (an explicit allow-list — NOT organization
-- owners, since every user owns a personal organization) read an aggregated
-- summary through worker_health_summary(), which never exposes job ids.

-- Platform operators: managed by the service role only (private schema, not exposed by the API).
create table private.platform_operators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
revoke all on private.platform_operators from public, anon, authenticated;
grant all on private.platform_operators to service_role;

create table public.worker_heartbeats (
  worker_id text primary key check (char_length(worker_id) between 1 and 200),
  started_at timestamptz not null,
  last_heartbeat_at timestamptz not null default now(),
  jobs_processed bigint not null default 0 check (jobs_processed >= 0),
  jobs_failed bigint not null default 0 check (jobs_failed >= 0),
  current_job_id uuid,
  current_job_type text,
  version text check (char_length(version) <= 64),
  app_env text check (app_env in ('local', 'staging', 'production')),
  -- Credential statuses only (CONFIGURED/MISSING/INVALID/EXPIRED/RATE_LIMITED/READY). Never values.
  diagnostics jsonb not null default '{}'::jsonb check (octet_length(diagnostics::text) <= 8192)
);
create index worker_heartbeats_recent_idx on public.worker_heartbeats (last_heartbeat_at desc);

alter table public.worker_heartbeats enable row level security;
revoke all on public.worker_heartbeats from public, anon, authenticated;
grant all on public.worker_heartbeats to service_role;

create or replace function public.worker_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  -- Platform operators only. Queue numbers are limited to organizations the caller administers.
  if uid is null or not exists (select 1 from private.platform_operators o where o.user_id = uid) then
    raise exception 'platform operator required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'workers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workerId', w.worker_id, 'startedAt', w.started_at, 'lastHeartbeatAt', w.last_heartbeat_at,
        'jobsProcessed', w.jobs_processed, 'jobsFailed', w.jobs_failed,
        'busy', w.current_job_id is not null, 'currentJobType', w.current_job_type,
        'version', w.version, 'appEnv', w.app_env, 'diagnostics', w.diagnostics
      ) order by w.last_heartbeat_at desc)
      from public.worker_heartbeats w
      where w.last_heartbeat_at > now() - interval '1 day'
    ), '[]'::jsonb),
    'oldestQueuedSeconds', (
      select extract(epoch from now() - min(j.available_at))::bigint
        from public.jobs j
       where j.status in ('QUEUED', 'RETRYING') and j.available_at <= now()
         and private.has_org_role(j.organization_id, 'admin')
    ),
    'now', now()
  );
end;
$$;
revoke all on function public.worker_health_summary() from public, anon;
grant execute on function public.worker_health_summary() to authenticated;
