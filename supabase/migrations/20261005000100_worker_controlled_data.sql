-- Phase 6: worker-controlled data is written only by trusted paths.
--
-- Normal members (authenticated) CAN:
--   * create directives and runs (only in a clean DRAFT/QUEUED state),
--   * read everything of their organization,
--   * request cancellation (request_research_cancellation / cancel_job),
--   * request additional research and analyses (enqueue_job),
--   * record human decisions / opportunity status (gated by triggers),
--   * write the outputs of the analyses they run themselves (competitors,
--     market estimates, business models, red team reviews, experiments).
-- Members CANNOT directly modify: run status/progress/cost/stats/errors, job or
-- worker state, connector executions, source items, evidence, signals,
-- clusters, opportunity–evidence links, system scores (score_total,
-- confidence, momentum, opportunity_scores) or organization ownership.
-- Those are written by the worker (service_role, every query scoped to the
-- job's organization) or by narrowly scoped SECURITY DEFINER functions.

-- ===========================================================================
-- research_runs: insert-only for members, in a clean initial state
-- ===========================================================================
drop policy if exists "research_runs_update" on public.research_runs;
drop policy if exists "research_runs_insert" on public.research_runs;
create policy "research_runs_insert" on public.research_runs for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, 'member'))
    and created_by = (select auth.uid())
    and status in ('DRAFT', 'QUEUED')
    and cost_usd = 0
    and progress_percent = 0
    and current_action is null
    and stats = '{}'::jsonb
    and not degraded
    and status_reason is null
    and started_at is null
    and completed_at is null
  );
revoke update on public.research_runs from authenticated;

-- ===========================================================================
-- Pipeline output: worker only (admins keep the existing delete policies)
-- ===========================================================================
revoke insert, update on public.source_items, public.evidence, public.signals, public.signal_evidence,
  public.signal_clusters, public.cluster_signals, public.connector_runs, public.opportunity_evidence,
  public.opportunity_scores
  from authenticated;

-- Opportunities: created by the worker; members may only change the human-
-- controlled status and the summaries of analyses they run (column grants).
revoke insert, update on public.opportunities from authenticated;
grant update (status, competitors_summary, market_size_summary, revenue_model, field_provenance)
  on public.opportunities to authenticated;

-- Worker-only RPCs (they write pipeline output).
revoke execute on function public.set_signal_embeddings(uuid, jsonb) from authenticated;
revoke execute on function public.create_opportunity_with_evidence(uuid, jsonb, uuid[]) from authenticated;
revoke execute on function public.insert_signals_with_evidence(uuid, jsonb) from authenticated;
grant execute on function public.set_signal_embeddings(uuid, jsonb) to service_role;
grant execute on function public.create_opportunity_with_evidence(uuid, jsonb, uuid[]) to service_role;
grant execute on function public.insert_signals_with_evidence(uuid, jsonb) to service_role;

-- Agent executions of pipeline runs belong to the worker: members may only
-- finish the agent runs started by analyses in their own requests.
drop policy if exists "agent_runs_update" on public.agent_runs;
create policy "agent_runs_update" on public.agent_runs for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')) and status = 'RUNNING' and research_run_id is null)
  with check ((select private.has_org_role(organization_id, 'member')) and research_run_id is null);

-- ===========================================================================
-- Reassessment runs in the worker (system scores are never user-written)
-- ===========================================================================
alter table public.jobs drop constraint if exists jobs_job_type_check;
alter table public.jobs add constraint jobs_job_type_check check (job_type in (
  'RESEARCH_COLLECTION', 'SIGNAL_EXTRACTION', 'CLUSTER_GENERATION', 'OPPORTUNITY_GENERATION',
  'DEEP_RESEARCH', 'COMPETITOR_RESEARCH', 'MARKET_SIZE_RESEARCH', 'RED_TEAM',
  'DAILY_BRIEF', 'WATCHLIST_REFRESH', 'OPPORTUNITY_REASSESSMENT'
));

-- ===========================================================================
-- Cancellation: the one approved way for a member to stop a run.
-- SECURITY DEFINER is required because members have no UPDATE on runs/jobs;
-- it is limited to: membership check, non-terminal run, → CANCELLED only.
-- ===========================================================================
create or replace function public.request_research_cancellation(run_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.research_runs;
  uid uuid := (select auth.uid());
  running int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into r from public.research_runs where id = run_id for update;
  if r.id is null or not private.has_org_role(r.organization_id, 'member') then
    raise exception 'research run not found' using errcode = '42501';
  end if;
  if r.status in ('COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED') then
    return r.status;
  end if;

  update public.jobs set status = 'CANCELLED', completed_at = now()
   where research_run_id = r.id and organization_id = r.organization_id and status in ('QUEUED', 'RETRYING');
  update public.jobs set cancel_requested = true
   where research_run_id = r.id and organization_id = r.organization_id and status = 'PROCESSING';
  get diagnostics running = row_count;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (r.organization_id, uid, 'research.cancel_requested', 'research_run', r.id,
          jsonb_build_object('processing_jobs', running));

  if running > 0 then
    -- The worker stops at its next checkpoint and marks the run CANCELLED.
    return 'CANCELLING';
  end if;
  update public.research_runs
     set status = 'CANCELLED', status_reason = 'ユーザーがキャンセルしました',
         progress_percent = 100, current_action = '調査はキャンセルされました'
   where id = r.id;
  return 'CANCELLED';
end;
$$;
revoke all on function public.request_research_cancellation(uuid) from public, anon;
grant execute on function public.request_research_cancellation(uuid) to authenticated;
