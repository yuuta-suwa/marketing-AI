-- M3: opportunity engine — experiments, evidence relevance, analysis bookkeeping.

-- Experiments: Hypothesis / Test / Metric / Target / Cost / Deadline / Result / Decision
alter table public.experiments add column target text;
alter table public.experiments add column deadline date;
alter table public.experiments add column result_summary text;
alter table public.experiments add column decision text
  check (decision is null or decision in ('CONTINUE', 'PIVOT', 'STOP', 'SCALE'));
alter table public.experiments add column decided_by uuid references auth.users (id) on delete set null;

-- A completed experiment must carry a result; a decision must be attributable.
alter table public.experiments add constraint experiments_completed_has_result
  check (status <> 'COMPLETED' or result_summary is not null);
alter table public.experiments add constraint experiments_decision_attributed
  check (decision is null or decided_by is not null);

-- Experiment status machine (PROPOSED → APPROVED → RUNNING → COMPLETED, any → CANCELLED)
create or replace function private.enforce_experiment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'PROPOSED' then
      raise exception 'experiments must be created as PROPOSED' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'PROPOSED' and new.status in ('APPROVED', 'CANCELLED')) or
    (old.status = 'APPROVED' and new.status in ('RUNNING', 'CANCELLED')) or
    (old.status = 'RUNNING' and new.status in ('COMPLETED', 'CANCELLED'))
  ) then
    raise exception 'illegal experiment transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  if new.status = 'APPROVED' and new.approved_by is null then
    raise exception 'experiment approval must record the approving user' using errcode = 'check_violation';
  end if;
  if new.status = 'RUNNING' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('COMPLETED', 'CANCELLED') and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;

create trigger enforce_experiment_transition
  before insert or update of status on public.experiments
  for each row execute function private.enforce_experiment_transition();

-- Approvals and decisions are always the signed-in human.
create or replace function private.enforce_experiment_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if new.approved_by is distinct from (case when tg_op = 'UPDATE' then old.approved_by else null end)
       and new.approved_by is distinct from auth.uid() then
      raise exception 'approved_by must be the current user' using errcode = '42501';
    end if;
    if new.decided_by is distinct from (case when tg_op = 'UPDATE' then old.decided_by else null end)
       and new.decided_by is distinct from auth.uid() then
      raise exception 'decided_by must be the current user' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_experiment_actor
  before insert or update on public.experiments
  for each row execute function private.enforce_experiment_actor();

-- Where linked evidence came from (initial generation vs. additional research).
alter table public.opportunity_evidence add column source_run_id uuid;
alter table public.opportunity_evidence add constraint opportunity_evidence_source_run_fk
  foreign key (source_run_id, organization_id) references public.research_runs (id, organization_id) on delete set null (source_run_id);

-- Business model comparison rationale; market estimate inputs are already jsonb.
alter table public.business_models add column rationale text;
alter table public.business_models add column epistemic_status text not null default 'HYPOTHESIS'
  check (epistemic_status in ('FACT', 'INFERENCE', 'HYPOTHESIS', 'ASSUMPTION', 'CALCULATION'));

-- At most one primary business model per opportunity.
create unique index business_models_primary_uidx on public.business_models (opportunity_id) where is_primary;

create index experiments_org_idx on public.experiments (organization_id, status, created_at desc);
create index competitors_org_idx on public.competitors (organization_id, created_at desc);
create index market_estimates_org_idx on public.market_estimates (organization_id, created_at desc);

-- Analyst outputs (competitor lists, business model comparisons) are derived,
-- regenerable data: members may replace them. Everything else keeps admin-only delete.
drop policy "competitors_delete" on public.competitors;
create policy "competitors_delete" on public.competitors for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));
drop policy "business_models_delete" on public.business_models;
create policy "business_models_delete" on public.business_models for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));
