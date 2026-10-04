-- Phase 6: human quality review of research output (Golden Run review table,
-- product KPIs). Humans rate signals/opportunities; nothing here is generated.

create table public.quality_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  entity_type text not null check (entity_type in ('SIGNAL', 'OPPORTUNITY')),
  entity_id uuid not null,
  useful boolean,
  rating smallint check (rating between 1 and 5),
  decision text not null default 'NONE' check (decision in ('NONE', 'DEEP_DIVE', 'EXPERIMENT', 'HOLD', 'REJECT')),
  note text check (char_length(note) <= 2000),
  reviewed_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_type, entity_id, reviewed_by),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create index quality_reviews_run_idx on public.quality_reviews (research_run_id, organization_id);
create trigger set_updated_at before update on public.quality_reviews
  for each row execute function private.set_updated_at();

alter table public.quality_reviews enable row level security;
revoke all on public.quality_reviews from anon;
create policy "quality_reviews_select" on public.quality_reviews for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "quality_reviews_insert" on public.quality_reviews for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')) and reviewed_by = (select auth.uid()));
create policy "quality_reviews_update" on public.quality_reviews for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')) and reviewed_by = (select auth.uid()))
  with check ((select private.has_org_role(organization_id, 'member')) and reviewed_by = (select auth.uid()));
grant all on public.quality_reviews to service_role;

-- The reviewed entity must belong to the same organization and run.
create or replace function private.enforce_quality_review_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_type = 'SIGNAL' and not exists (
    select 1 from public.signals s where s.id = new.entity_id and s.organization_id = new.organization_id and s.research_run_id = new.research_run_id
  ) then
    raise exception 'review target signal not found in this run' using errcode = 'foreign_key_violation';
  end if;
  if new.entity_type = 'OPPORTUNITY' and not exists (
    select 1 from public.opportunities o where o.id = new.entity_id and o.organization_id = new.organization_id and o.research_run_id = new.research_run_id
  ) then
    raise exception 'review target opportunity not found in this run' using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
create trigger enforce_quality_review_target before insert or update on public.quality_reviews
  for each row execute function private.enforce_quality_review_target();
