-- Phase 5: asynchronous execution.
--   * public.jobs — Postgres-backed job queue (leases, heartbeats, retries, dead letters)
--   * research run progress (percent + current action) for Realtime / polling UIs
--   * idempotency guards so a re-delivered job can never duplicate business data
--
-- Users (authenticated) can only READ their organization's jobs and enqueue /
-- cancel through SECURITY DEFINER functions that check membership and role.
-- Claiming, heartbeats, completion and failure are service_role only (worker).

-- ===========================================================================
-- Jobs
-- ===========================================================================
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  research_run_id uuid,
  opportunity_id uuid,
  job_type text not null check (job_type in (
    'RESEARCH_COLLECTION', 'SIGNAL_EXTRACTION', 'CLUSTER_GENERATION', 'OPPORTUNITY_GENERATION',
    'DEEP_RESEARCH', 'COMPETITOR_RESEARCH', 'MARKET_SIZE_RESEARCH', 'RED_TEAM',
    'DAILY_BRIEF', 'WATCHLIST_REFRESH'
  )),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) <= 4194304),
  status text not null default 'QUEUED' check (status in (
    'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED'
  )),
  priority int not null default 100 check (priority between 0 and 1000),
  attempt_count int not null default 0 check (attempt_count >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text check (char_length(last_error) <= 2000),
  -- One logical unit of work per key and organization (duplicate enqueue = no-op).
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  -- Lease: the worker that owns the job and until when.
  locked_by text check (char_length(locked_by) <= 200),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean not null default false,
  -- Permanently failed (attempts exhausted or non-retryable) = dead letter.
  dead_lettered boolean not null default false,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint jobs_idempotency_uq unique (organization_id, idempotency_key),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade,
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade,
  check (status <> 'PROCESSING' or (locked_by is not null and lease_expires_at is not null)),
  check (not dead_lettered or status = 'FAILED')
);
create index jobs_ready_idx on public.jobs (priority, available_at) where status in ('QUEUED', 'RETRYING');
create index jobs_lease_idx on public.jobs (lease_expires_at) where status = 'PROCESSING';
create index jobs_org_idx on public.jobs (organization_id, created_at desc);
create index jobs_run_idx on public.jobs (research_run_id) where research_run_id is not null;
create index jobs_dead_letter_idx on public.jobs (organization_id, failed_at desc) where dead_lettered;

create trigger set_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();

-- Job state machine (mirrors src/domain/jobs/job.ts canTransitionJob()).
create or replace function private.job_transition_allowed(from_status text, to_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when from_status = to_status then from_status in ('PROCESSING', 'QUEUED', 'RETRYING')
    when from_status = 'QUEUED' then to_status in ('PROCESSING', 'CANCELLED')
    when from_status = 'RETRYING' then to_status in ('PROCESSING', 'CANCELLED')
    when from_status = 'PROCESSING' then to_status in ('COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED')
    -- Dead letters may be re-queued explicitly by an admin.
    when from_status = 'FAILED' then to_status = 'QUEUED'
    else false
  end;
$$;

create or replace function private.enforce_job_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'QUEUED' or new.attempt_count <> 0 or new.locked_by is not null then
      raise exception 'jobs must be created QUEUED, unclaimed, with no attempts' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if not private.job_transition_allowed(old.status, new.status) then
    raise exception 'illegal job transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  if new.organization_id <> old.organization_id or new.job_type <> old.job_type
     or new.idempotency_key <> old.idempotency_key then
    raise exception 'job identity is immutable' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger enforce_job_transition
  before insert or update on public.jobs
  for each row execute function private.enforce_job_transition();

alter table public.jobs enable row level security;
-- Users never write jobs directly (only via the functions below).
revoke insert, update, delete, truncate on public.jobs from authenticated, anon;
revoke all on public.jobs from anon;
grant select on public.jobs to authenticated;
grant all on public.jobs to service_role;
create policy "jobs_select" on public.jobs for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- ---------------------------------------------------------------------------
-- enqueue_job — user-facing. Idempotent: returns the existing job for the key.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_job(
  org uuid,
  job_type text,
  idempotency_key text,
  payload jsonb default '{}'::jsonb,
  research_run_id uuid default null,
  opportunity_id uuid default null,
  priority int default 100,
  max_attempts int default 5,
  available_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  j public.jobs;
  created boolean := true;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.has_org_role(org, 'member') then
    raise exception 'not allowed to enqueue jobs for this organization' using errcode = '42501';
  end if;
  -- Referenced entities must belong to the same organization (no BOLA via ids).
  if enqueue_job.research_run_id is not null and not exists (
    select 1 from public.research_runs r where r.id = enqueue_job.research_run_id and r.organization_id = org
  ) then
    raise exception 'research run not found' using errcode = '42501';
  end if;
  if enqueue_job.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = enqueue_job.opportunity_id and o.organization_id = org
  ) then
    raise exception 'opportunity not found' using errcode = '42501';
  end if;

  insert into public.jobs (organization_id, user_id, research_run_id, opportunity_id, job_type, payload,
                           priority, max_attempts, available_at, idempotency_key)
  values (org, uid, enqueue_job.research_run_id, enqueue_job.opportunity_id, enqueue_job.job_type,
          coalesce(enqueue_job.payload, '{}'::jsonb),
          least(greatest(coalesce(enqueue_job.priority, 100), 0), 1000),
          least(greatest(coalesce(enqueue_job.max_attempts, 5), 1), 20),
          coalesce(enqueue_job.available_at, now()), enqueue_job.idempotency_key)
  on conflict on constraint jobs_idempotency_uq do nothing
  returning * into j;

  if j.id is null then
    created := false;
    select * into j from public.jobs x where x.organization_id = org and x.idempotency_key = enqueue_job.idempotency_key;
  end if;
  -- The payload is not echoed back (it may contain user-pasted text).
  return jsonb_build_object('job', to_jsonb(j) - 'payload', 'created', created);
end;
$$;
revoke all on function public.enqueue_job(uuid, text, text, jsonb, uuid, uuid, int, int, timestamptz) from public, anon;
grant execute on function public.enqueue_job(uuid, text, text, jsonb, uuid, uuid, int, int, timestamptz) to authenticated;

-- cancel_job — user-facing. Queued jobs are cancelled now; a processing job is
-- flagged and the worker stops it at its next heartbeat.
create or replace function public.cancel_job(job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = job_id for update;
  if j.id is null or not private.has_org_role(j.organization_id, 'member') then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if j.status in ('QUEUED', 'RETRYING') then
    update public.jobs set status = 'CANCELLED', completed_at = now(), available_at = now()
     where id = job_id returning * into j;
    if j.research_run_id is not null and j.job_type in
       ('RESEARCH_COLLECTION', 'SIGNAL_EXTRACTION', 'CLUSTER_GENERATION', 'OPPORTUNITY_GENERATION') then
      update public.research_runs set status = 'CANCELLED', status_reason = 'ユーザーがキャンセルしました'
       where id = j.research_run_id and organization_id = j.organization_id
         and status not in ('COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED');
    end if;
  elsif j.status = 'PROCESSING' then
    update public.jobs set cancel_requested = true where id = job_id returning * into j;
  end if;
  return j;
end;
$$;
revoke all on function public.cancel_job(uuid) from public, anon;
grant execute on function public.cancel_job(uuid) to authenticated;

-- requeue_dead_letter — admins only: give a permanently failed job a fresh set of attempts.
create or replace function public.requeue_dead_letter(job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = job_id for update;
  if j.id is null or not private.has_org_role(j.organization_id, 'admin') then
    raise exception 'job not found' using errcode = '42501';
  end if;
  if j.status <> 'FAILED' then
    raise exception 'only failed jobs can be re-queued' using errcode = 'check_violation';
  end if;
  update public.jobs
     set status = 'QUEUED', attempt_count = 0, dead_lettered = false, failed_at = null,
         available_at = now(), locked_by = null, lease_expires_at = null, cancel_requested = false
   where id = job_id returning * into j;
  return j;
end;
$$;
revoke all on function public.requeue_dead_letter(uuid) from public, anon;
grant execute on function public.requeue_dead_letter(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker API — service_role only.
-- ---------------------------------------------------------------------------

-- Claims up to max_jobs ready jobs (or jobs whose lease expired: the previous
-- worker died). FOR UPDATE SKIP LOCKED guarantees one owner per job.
create or replace function public.claim_jobs(worker_id text, max_jobs int default 1, lease_seconds int default 120, job_types text[] default null)
returns setof public.jobs
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if worker_id is null or char_length(worker_id) not between 1 and 200 then
    raise exception 'invalid worker id' using errcode = 'check_violation';
  end if;
  -- Expired leases that already used every attempt go to the dead-letter state,
  -- and the research run they were driving is failed (never left "in progress").
  with dead as (
    update public.jobs
       set status = 'FAILED', dead_lettered = true, failed_at = now(), locked_by = null,
           lease_expires_at = null,
           last_error = left(coalesce(last_error || ' | ', '') || 'lease expired after final attempt (worker lost)', 2000)
     where status = 'PROCESSING' and lease_expires_at < now() and attempt_count >= max_attempts
    returning research_run_id, organization_id
  )
  update public.research_runs r
     set status = 'FAILED', status_reason = 'バックグラウンド処理が応答しなくなったため停止しました（再試行上限）'
    from dead d
   where r.id = d.research_run_id and r.organization_id = d.organization_id
     and r.status not in ('COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED');

  return query
  with candidates as (
    select j.id from public.jobs j
     where ((j.status in ('QUEUED', 'RETRYING') and j.available_at <= now())
         or (j.status = 'PROCESSING' and j.lease_expires_at < now()))
       and (job_types is null or j.job_type = any (job_types))
     order by j.priority, j.available_at, j.created_at
     limit least(greatest(coalesce(max_jobs, 1), 1), 50)
     for update skip locked
  )
  update public.jobs j
     set status = 'PROCESSING',
         locked_by = worker_id,
         attempt_count = j.attempt_count + 1,
         started_at = coalesce(j.started_at, now()),
         heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => least(greatest(lease_seconds, 10), 3600))
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

-- Extends the lease. False = the worker no longer owns the job (stop work) or a
-- cancellation was requested.
create or replace function public.heartbeat_job(job_id uuid, worker_id text, lease_seconds int default 120)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ok boolean;
begin
  update public.jobs
     set heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => least(greatest(lease_seconds, 10), 3600))
   where id = job_id and status = 'PROCESSING' and locked_by = worker_id and not cancel_requested
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

create or replace function public.complete_job(job_id uuid, worker_id text, job_result jsonb default null)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ok boolean;
begin
  update public.jobs
     set status = 'COMPLETED', completed_at = now(), result = job_result,
         locked_by = null, lease_expires_at = null, last_error = null
   where id = job_id and status = 'PROCESSING' and locked_by = worker_id
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

-- Records a failed attempt. Retryable failures with attempts left are
-- re-scheduled (exponential backoff computed by the worker); everything else
-- becomes a dead letter. A cancellation request ends the job as CANCELLED.
create or replace function public.fail_job(job_id uuid, worker_id text, error text, retryable boolean, retry_delay_seconds int default 30)
returns public.jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = job_id and status = 'PROCESSING' and locked_by = worker_id for update;
  if j.id is null then
    return null;
  end if;
  if j.cancel_requested then
    update public.jobs set status = 'CANCELLED', completed_at = now(), locked_by = null, lease_expires_at = null,
           last_error = left(error, 2000)
     where id = job_id returning * into j;
  elsif retryable and j.attempt_count < j.max_attempts then
    update public.jobs
       set status = 'RETRYING', locked_by = null, lease_expires_at = null, last_error = left(error, 2000),
           available_at = now() + make_interval(secs => least(greatest(coalesce(retry_delay_seconds, 30), 1), 3600))
     where id = job_id returning * into j;
  else
    update public.jobs
       set status = 'FAILED', dead_lettered = true, failed_at = now(), locked_by = null,
           lease_expires_at = null, last_error = left(error, 2000)
     where id = job_id returning * into j;
  end if;
  return j;
end;
$$;

-- Graceful shutdown: hand unfinished jobs back immediately (no attempt consumed).
create or replace function public.release_job(job_id uuid, worker_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ok boolean;
begin
  update public.jobs
     set status = 'RETRYING', locked_by = null, lease_expires_at = null, available_at = now(),
         attempt_count = greatest(attempt_count - 1, 0)
   where id = job_id and status = 'PROCESSING' and locked_by = worker_id
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

-- Queue health for the worker's health endpoint / ops dashboards.
create or replace function public.job_queue_stats()
returns table (status text, job_count bigint, oldest timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select j.status, count(*), min(j.created_at) from public.jobs j group by j.status;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_jobs(text, int, int, text[])',
    'public.heartbeat_job(uuid, text, int)',
    'public.complete_job(uuid, text, jsonb)',
    'public.fail_job(uuid, text, text, boolean, int)',
    'public.release_job(uuid, text)',
    'public.job_queue_stats()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- ===========================================================================
-- Research progress (written by the worker, read via Realtime or polling)
-- ===========================================================================
alter table public.research_runs
  add column progress_percent int not null default 0 check (progress_percent between 0 and 100),
  add column current_action text check (char_length(current_action) <= 200);

-- ===========================================================================
-- Idempotency guards: a re-delivered stage can never duplicate business data.
-- ===========================================================================
-- Evidence: one row per (source item, excerpt).
alter table public.evidence
  add column text_hash text generated always as (md5(evidence_text)) stored;
create unique index evidence_source_text_uidx on public.evidence (source_item_id, text_hash);

-- Opportunities: one per evidence-backed cluster.
create unique index opportunities_cluster_uidx on public.opportunities (cluster_id);

-- Opportunity + its evidence links in ONE transaction (no evidence-less rows
-- even if the worker dies mid-way). Invoker: RLS applies to user callers.
create or replace function public.create_opportunity_with_evidence(org uuid, opp jsonb, evidence_ids uuid[])
returns public.opportunities
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.opportunities;
  created public.opportunities;
begin
  if coalesce(cardinality(evidence_ids), 0) = 0 then
    raise exception 'an opportunity requires at least one evidence id' using errcode = 'check_violation';
  end if;
  r := jsonb_populate_record(null::public.opportunities, opp);
  insert into public.opportunities (
    organization_id, research_run_id, cluster_id, title, customer, trigger, situation, pain,
    desired_outcome, current_alternatives, market_gap, pay_signal, market_size_summary,
    competitors_summary, revenue_model, distribution_strategy, moat, ai_necessity,
    regulatory_risk, main_risk, next_experiment, kill_criteria, field_provenance,
    confidence, score_total, momentum, created_by
  ) values (
    org, r.research_run_id, r.cluster_id, r.title, r.customer, r.trigger, r.situation, r.pain,
    r.desired_outcome, r.current_alternatives, r.market_gap, r.pay_signal, r.market_size_summary,
    r.competitors_summary, r.revenue_model, r.distribution_strategy, r.moat, r.ai_necessity,
    r.regulatory_risk, r.main_risk, r.next_experiment, r.kill_criteria,
    coalesce(r.field_provenance, '{}'::jsonb), coalesce(r.confidence, 'LOW'), r.score_total,
    coalesce(r.momentum, 0), r.created_by
  )
  returning * into created;

  insert into public.opportunity_evidence (opportunity_id, evidence_id, organization_id)
  select created.id, e, org from (select distinct unnest(evidence_ids) as e) d;
  return created;
end;
$$;
revoke all on function public.create_opportunity_with_evidence(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.create_opportunity_with_evidence(uuid, jsonb, uuid[]) to authenticated, service_role;

-- Signals + their evidence links in one transaction (same reasoning).
create or replace function public.insert_signals_with_evidence(org uuid, rows jsonb)
returns setof uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
  s public.signals;
  sid uuid;
begin
  for item in select * from jsonb_array_elements(rows)
  loop
    if coalesce(jsonb_array_length(item -> 'evidence_ids'), 0) = 0 then
      raise exception 'a signal requires at least one evidence id' using errcode = 'check_violation';
    end if;
    s := jsonb_populate_record(null::public.signals, item - 'evidence_ids');
    insert into public.signals (
      organization_id, research_run_id, persona, situation, problem, desired_outcome,
      current_alternative, alternative_failure, urgency_score, frequency_signal,
      willingness_to_pay_score, switching_intent_score, trust_issue, price_issue, access_issue,
      category, location, signal_type, confidence, language, country, extracted_by, field_provenance
    ) values (
      org, s.research_run_id, s.persona, s.situation, s.problem, s.desired_outcome,
      s.current_alternative, s.alternative_failure, s.urgency_score, s.frequency_signal,
      s.willingness_to_pay_score, s.switching_intent_score, s.trust_issue, s.price_issue, s.access_issue,
      s.category, s.location, s.signal_type, s.confidence, s.language, s.country, s.extracted_by,
      coalesce(s.field_provenance, '{}'::jsonb)
    ) returning id into sid;
    insert into public.signal_evidence (signal_id, evidence_id, organization_id)
    select sid, (e #>> '{}')::uuid, org
      from (select distinct e from jsonb_array_elements(item -> 'evidence_ids') e) d;
    return next sid;
  end loop;
end;
$$;
revoke all on function public.insert_signals_with_evidence(uuid, jsonb) from public, anon;
grant execute on function public.insert_signals_with_evidence(uuid, jsonb) to authenticated, service_role;

-- ===========================================================================
-- Realtime: research progress and job status (RLS applies to subscribers).
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.research_runs, public.jobs;
  end if;
end;
$$;
