-- M4: FRIDAY / Executive OS — decision memory, CEO approval, watchlists,
-- notifications and the feedback loop.

-- ---------------------------------------------------------------------------
-- Decision memory: only decisions are persisted from FRIDAY conversations.
-- ---------------------------------------------------------------------------
alter table public.decisions add column subject text;
alter table public.decisions add column source text not null default 'UI' check (source in ('UI', 'FRIDAY', 'SYSTEM'));

-- ---------------------------------------------------------------------------
-- CEO approval: PoC approval and launch require an admin/owner decision.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_opportunity_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'DISCOVERED' then
      raise exception 'opportunities must be created as DISCOVERED' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = old.status then
    return new;
  end if;
  if not private.opportunity_transition_allowed(old.status, new.status) then
    raise exception 'illegal opportunity transition % -> %', old.status, new.status using errcode = 'check_violation';
  end if;
  if new.status in ('VALIDATED', 'EXPERIMENT_PROPOSED', 'EXPERIMENT_APPROVED', 'POC_PROPOSED', 'POC_APPROVED', 'LAUNCHED')
     and not exists (select 1 from public.opportunity_evidence oe where oe.opportunity_id = new.id) then
    raise exception 'opportunity % has no linked evidence', new.id using errcode = 'check_violation';
  end if;
  if new.status in ('EXPERIMENT_APPROVED', 'POC_APPROVED', 'LAUNCHED', 'REJECTED') then
    if not exists (
      select 1 from public.decisions d
       where d.opportunity_id = new.id
         and d.to_status = new.status
         and d.from_status = old.status
         and d.created_at >= now() - interval '1 hour'
         and (
           new.status not in ('POC_APPROVED', 'LAUNCHED')
           or exists (
             select 1 from public.organization_members m
              where m.organization_id = new.organization_id
                and m.user_id = d.decided_by
                and private.org_role_rank(m.role) >= private.org_role_rank('admin')
           )
         )
    ) then
      raise exception 'transition to % requires a recorded human decision%', new.status,
        case when new.status in ('POC_APPROVED', 'LAUNCHED') then ' by an admin/owner (CEO approval)' else '' end
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Watchlists: MARKET target; opportunity targets must belong to the same org.
-- ---------------------------------------------------------------------------
alter table public.watchlists drop constraint watchlists_target_type_check;
alter table public.watchlists add constraint watchlists_target_type_check check (target_type in (
  'OPPORTUNITY', 'COMPETITOR', 'INDUSTRY', 'PROBLEM', 'PERSONA', 'COUNTRY',
  'KEYWORD', 'TECHNOLOGY', 'REGULATION', 'MARKET'
));
alter table public.watchlists add column label text;

create or replace function private.enforce_watchlist_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target_type = 'OPPORTUNITY' then
    if new.target_id is null or not exists (
      select 1 from public.opportunities o where o.id = new.target_id and o.organization_id = new.organization_id
    ) then
      raise exception 'watchlist target must be an opportunity of the same organization' using errcode = 'foreign_key_violation';
    end if;
  elsif new.target_id is not null then
    raise exception 'only OPPORTUNITY watchlists may reference a target id' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_watchlist_target
  before insert or update of target_type, target_id, organization_id on public.watchlists
  for each row execute function private.enforce_watchlist_target();

create unique index watchlists_dedupe_uidx on public.watchlists
  (organization_id, user_id, target_type, coalesce(target_id::text, lower(query))) where active;

-- ---------------------------------------------------------------------------
-- Notifications: users may create their own; dedupe key prevents repeats.
-- ---------------------------------------------------------------------------
alter table public.notifications add column dedupe_key text;
alter table public.notifications add column severity text not null default 'INFO' check (severity in ('INFO', 'IMPORTANT', 'CRITICAL'));
alter table public.notifications add column watchlist_id uuid references public.watchlists (id) on delete set null;
create unique index notifications_dedupe_uidx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

create policy "notifications_insert_own" on public.notifications for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));

-- ---------------------------------------------------------------------------
-- Feedback loop: real-world outcomes flow back to the opportunity.
-- ---------------------------------------------------------------------------
create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  experiment_id uuid,
  metric text not null check (metric in (
    'CUSTOMER_RESPONSE', 'CONVERSION', 'REVENUE', 'RETENTION', 'CHURN', 'FEEDBACK', 'LAUNCH_RESULT', 'CUSTOMER_INTERVIEW'
  )),
  value numeric,
  unit text,
  note text check (char_length(note) <= 4000),
  occurred_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id) references public.opportunities (id, organization_id) on delete cascade,
  foreign key (experiment_id, organization_id) references public.experiments (id, organization_id) on delete set null (experiment_id),
  check (value is not null or note is not null)
);
create index feedback_events_opp_idx on public.feedback_events (opportunity_id, occurred_at desc);
create index feedback_events_org_idx on public.feedback_events (organization_id, metric, occurred_at desc);

alter table public.feedback_events enable row level security;
alter table public.feedback_events force row level security;
grant select, insert on public.feedback_events to authenticated;
grant all on public.feedback_events to service_role;
create policy "feedback_events_select" on public.feedback_events for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "feedback_events_insert" on public.feedback_events for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')) and recorded_by = (select auth.uid()));

-- Learning dataset: Signal → Opportunity → Experiment → Revenue (RLS via invoker).
create view public.opportunity_lineage with (security_invoker = true) as
select
  o.organization_id,
  o.id as opportunity_id,
  o.title,
  o.status,
  o.score_total,
  o.confidence,
  (select count(*) from public.cluster_signals cs where cs.cluster_id = o.cluster_id) as signal_count,
  (select count(*) from public.opportunity_evidence oe where oe.opportunity_id = o.id) as evidence_count,
  (select count(*) from public.experiments e where e.opportunity_id = o.id) as experiment_count,
  (select count(*) from public.experiments e where e.opportunity_id = o.id and e.decision in ('CONTINUE', 'SCALE')) as experiments_positive,
  (select coalesce(sum(f.value), 0) from public.feedback_events f where f.opportunity_id = o.id and f.metric = 'REVENUE') as revenue_total,
  (select count(*) from public.feedback_events f where f.opportunity_id = o.id) as feedback_count
from public.opportunities o;
grant select on public.opportunity_lineage to authenticated;
