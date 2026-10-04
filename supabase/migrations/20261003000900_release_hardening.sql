-- Release hardening: rate limiting, integrity report, batch embeddings, indexes.

-- ---------------------------------------------------------------------------
-- Per-user rate limiting for expensive actions (sliding window, atomic).
-- ---------------------------------------------------------------------------
create table private.rate_limit_events (
  user_id uuid not null,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_idx on private.rate_limit_events (user_id, bucket, created_at desc);

create or replace function public.consume_rate_limit(bucket text, max_events int, window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  used int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if bucket !~ '^[a-z_.]{2,64}$' or max_events < 1 or window_seconds < 1 or window_seconds > 86400 then
    raise exception 'invalid rate limit parameters' using errcode = 'check_violation';
  end if;
  -- Serialize per user+bucket so concurrent requests cannot both pass.
  perform pg_advisory_xact_lock(hashtext(uid::text || ':' || bucket));
  delete from private.rate_limit_events e
   where e.user_id = uid and e.bucket = consume_rate_limit.bucket
     and e.created_at < now() - make_interval(secs => window_seconds * 2);
  select count(*) into used from private.rate_limit_events e
   where e.user_id = uid and e.bucket = consume_rate_limit.bucket
     and e.created_at >= now() - make_interval(secs => window_seconds);
  if used >= max_events then
    return false;
  end if;
  insert into private.rate_limit_events (user_id, bucket) values (uid, consume_rate_limit.bucket);
  return true;
end;
$$;
revoke all on function public.consume_rate_limit(text, int, int) from public, anon;
grant execute on function public.consume_rate_limit(text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Data integrity report (RLS applies: invoker). All counts should be 0.
-- ---------------------------------------------------------------------------
create or replace function public.integrity_report()
returns table (check_name text, violations bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'signals_without_evidence', count(*) from public.signals s
   where not exists (select 1 from public.signal_evidence se where se.signal_id = s.id)
  union all
  select 'opportunities_without_evidence', count(*) from public.opportunities o
   where not exists (select 1 from public.opportunity_evidence oe where oe.opportunity_id = o.id)
  union all
  select 'evidence_not_verbatim', count(*) from public.evidence e
   join public.source_items si on si.id = e.source_item_id
   where position(e.evidence_text in si.body) = 0
  union all
  select 'clusters_without_signals', count(*) from public.signal_clusters c
   where not exists (select 1 from public.cluster_signals cs where cs.cluster_id = c.id)
  union all
  select 'duplicate_source_items', count(*) from (
    select research_run_id, content_hash from public.source_items group by 1, 2 having count(*) > 1
  ) d;
$$;
revoke all on function public.integrity_report() from public, anon;
grant execute on function public.integrity_report() to authenticated;

-- ---------------------------------------------------------------------------
-- Batch embedding update (one round trip instead of N). Invoker → RLS applies.
-- ---------------------------------------------------------------------------
create or replace function public.set_signal_embeddings(org uuid, rows jsonb)
returns int
language sql
security invoker
set search_path = ''
as $$
  with input as (
    select (r ->> 'id')::uuid as id, (r ->> 'embedding')::extensions.vector as embedding, r ->> 'model' as model
      from jsonb_array_elements(rows) as r
  ), updated as (
    update public.signals s set embedding = i.embedding, embedding_model = i.model
      from input i where s.id = i.id and s.organization_id = org
    returning 1
  )
  select count(*)::int from updated;
$$;
revoke all on function public.set_signal_embeddings(uuid, jsonb) from public, anon;
grant execute on function public.set_signal_embeddings(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Indexes for hot read paths.
-- ---------------------------------------------------------------------------
create index if not exists signals_org_created_idx on public.signals (organization_id, created_at desc);
create index if not exists advisor_sessions_opp_idx on public.advisor_sessions (opportunity_id, created_at desc);
create index if not exists watchlists_active_idx on public.watchlists (active) where active;
create index if not exists agent_runs_org_started_idx on public.agent_runs (organization_id, started_at desc);
create index if not exists evidence_org_idx on public.evidence (organization_id, created_at desc);
create index if not exists opportunity_scores_org_idx on public.opportunity_scores (organization_id, created_at desc);
