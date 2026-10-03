-- MARKET RADAR OS — integrity rules enforced in the database.
-- These mirror the domain rules in src/domain (defense in depth). Keep the two in sync;
-- tests in supabase/tests and tests/unit cover both sides.

-- ===========================================================================
-- Research run state machine
-- ===========================================================================
create or replace function private.research_run_transition_allowed(from_status text, to_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when from_status = to_status then true
    when from_status in ('COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED') then false
    when to_status in ('FAILED', 'CANCELLED') then true
    when from_status = 'DRAFT' then to_status = 'QUEUED'
    when from_status = 'QUEUED' then to_status = 'COLLECTING'
    when from_status = 'COLLECTING' then to_status in ('NORMALIZING', 'PARTIAL_SUCCESS')
    when from_status = 'NORMALIZING' then to_status in ('EXTRACTING', 'PARTIAL_SUCCESS')
    when from_status = 'EXTRACTING' then to_status in ('CLUSTERING', 'PARTIAL_SUCCESS')
    when from_status = 'CLUSTERING' then to_status in ('ANALYZING', 'PARTIAL_SUCCESS')
    when from_status = 'ANALYZING' then to_status in ('VALIDATING', 'COMPLETED', 'PARTIAL_SUCCESS')
    when from_status = 'VALIDATING' then to_status in ('COMPLETED', 'PARTIAL_SUCCESS')
    else false
  end;
$$;

create or replace function private.enforce_research_run_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('DRAFT', 'QUEUED') then
      raise exception 'research_runs must be created in DRAFT or QUEUED (got %)', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if not private.research_run_transition_allowed(old.status, new.status) then
    raise exception 'illegal research run transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'COLLECTING' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status in ('COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED')
     and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end;
$$;

create trigger enforce_research_run_transition
  before insert or update of status on public.research_runs
  for each row execute function private.enforce_research_run_transition();

-- ===========================================================================
-- Evidence integrity: evidence_text must be a verbatim excerpt of its source.
-- ===========================================================================
create or replace function private.enforce_evidence_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  src record;
begin
  select s.body, s.research_run_id, s.source_url
    into src
    from public.source_items s
   where s.id = new.source_item_id
     and s.organization_id = new.organization_id;

  if not found then
    raise exception 'evidence references unknown source item %', new.source_item_id
      using errcode = 'foreign_key_violation';
  end if;

  if position(new.evidence_text in src.body) = 0 then
    raise exception 'evidence_text is not a verbatim excerpt of source item %', new.source_item_id
      using errcode = 'check_violation';
  end if;

  if new.research_run_id <> src.research_run_id then
    raise exception 'evidence research_run_id must match its source item'
      using errcode = 'check_violation';
  end if;

  if new.source_url is null then
    new.source_url := src.source_url;
  end if;
  return new;
end;
$$;

create trigger enforce_evidence_integrity
  before insert or update of evidence_text, source_item_id on public.evidence
  for each row execute function private.enforce_evidence_integrity();

-- Evidence id arrays (columns that cannot carry a real FK) must reference
-- evidence rows of the same organization.
create or replace function private.enforce_evidence_id_array()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  missing int;
begin
  if new.source_evidence_ids is null or cardinality(new.source_evidence_ids) = 0 then
    return new;
  end if;
  select count(*) into missing
    from unnest(new.source_evidence_ids) as ids(id)
   where not exists (
     select 1 from public.evidence e
      where e.id = ids.id and e.organization_id = new.organization_id
   );
  if missing > 0 then
    raise exception '% referenced evidence id(s) do not exist in this organization', missing
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_evidence_ids before insert or update of source_evidence_ids
  on public.market_estimates for each row execute function private.enforce_evidence_id_array();
create trigger enforce_evidence_ids before insert or update of source_evidence_ids
  on public.competitors for each row execute function private.enforce_evidence_id_array();

-- ===========================================================================
-- Opportunity decision gates
-- ===========================================================================
create or replace function private.opportunity_transition_allowed(from_status text, to_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when from_status = to_status then true
    when from_status = 'DISCOVERED' then to_status in ('RESEARCHING', 'VALIDATED', 'ON_HOLD', 'REJECTED')
    when from_status = 'RESEARCHING' then to_status in ('DISCOVERED', 'VALIDATED', 'ON_HOLD', 'REJECTED')
    when from_status = 'VALIDATED' then to_status in ('RESEARCHING', 'EXPERIMENT_PROPOSED', 'ON_HOLD', 'REJECTED')
    when from_status = 'EXPERIMENT_PROPOSED' then to_status in ('VALIDATED', 'EXPERIMENT_APPROVED', 'ON_HOLD', 'REJECTED')
    when from_status = 'EXPERIMENT_APPROVED' then to_status in ('POC_PROPOSED', 'ON_HOLD', 'REJECTED')
    when from_status = 'POC_PROPOSED' then to_status in ('EXPERIMENT_APPROVED', 'POC_APPROVED', 'ON_HOLD', 'REJECTED')
    when from_status = 'POC_APPROVED' then to_status in ('LAUNCHED', 'ON_HOLD', 'REJECTED')
    when from_status = 'ON_HOLD' then to_status in ('DISCOVERED', 'RESEARCHING', 'VALIDATED', 'REJECTED')
    when from_status = 'REJECTED' then to_status in ('DISCOVERED')
    when from_status = 'LAUNCHED' then to_status in ('ON_HOLD')
    else false
  end;
$$;

create or replace function private.enforce_opportunity_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DISCOVERED' then
      raise exception 'opportunities must be created as DISCOVERED'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not private.opportunity_transition_allowed(old.status, new.status) then
    raise exception 'illegal opportunity transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Nothing past DISCOVERED/RESEARCHING may be confirmed without evidence.
  if new.status in ('VALIDATED', 'EXPERIMENT_PROPOSED', 'EXPERIMENT_APPROVED',
                    'POC_PROPOSED', 'POC_APPROVED', 'LAUNCHED')
     and not exists (select 1 from public.opportunity_evidence oe where oe.opportunity_id = new.id) then
    raise exception 'opportunity % has no linked evidence', new.id
      using errcode = 'check_violation';
  end if;

  -- Human approval gates: a matching human decision must already be recorded.
  if new.status in ('EXPERIMENT_APPROVED', 'POC_APPROVED', 'LAUNCHED', 'REJECTED') then
    if not exists (
      select 1 from public.decisions d
       where d.opportunity_id = new.id
         and d.to_status = new.status
         and d.from_status = old.status
         and d.created_at >= now() - interval '1 hour'
    ) then
      raise exception 'transition to % requires a recorded human decision', new.status
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_opportunity_gate
  before insert or update of status on public.opportunities
  for each row execute function private.enforce_opportunity_gate();

-- ===========================================================================
-- Scoring weights: known criteria, non-negative integers, sum = 100.
-- ===========================================================================
create or replace function private.enforce_scoring_weights()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[] := array[
    'painSeverity', 'frequency', 'willingnessToPay', 'marketSize', 'trendMomentum',
    'existingSolutionGap', 'distributionAdvantage', 'monetizationQuality', 'buildability',
    'defensibility', 'regulatoryFeasibility', 'timeToRevenue', 'strategicFit', 'socialValue'
  ];
  k text;
  v jsonb;
  total numeric := 0;
begin
  if jsonb_typeof(new.weights) <> 'object' then
    raise exception 'weights must be a JSON object' using errcode = 'check_violation';
  end if;
  for k, v in select * from jsonb_each(new.weights) loop
    if not (k = any(allowed)) then
      raise exception 'unknown scoring criterion %', k using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0 then
      raise exception 'weight % must be a non-negative number', k using errcode = 'check_violation';
    end if;
    total := total + (v::text)::numeric;
  end loop;
  if total <> 100 then
    raise exception 'scoring weights must sum to 100 (got %)', total using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_scoring_weights
  before insert or update of weights on public.scoring_settings
  for each row execute function private.enforce_scoring_weights();

-- ===========================================================================
-- Membership safety: an organization always keeps at least one owner.
-- ===========================================================================
create or replace function private.protect_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.organization_members m
        where m.organization_id = old.organization_id
          and m.role = 'owner'
          and m.id <> old.id
     )
     -- allow cascade when the organization itself is being deleted
     and exists (select 1 from public.organizations o where o.id = old.organization_id) then
    raise exception 'an organization must keep at least one owner'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger protect_last_owner
  before update of role or delete on public.organization_members
  for each row execute function private.protect_last_owner();
