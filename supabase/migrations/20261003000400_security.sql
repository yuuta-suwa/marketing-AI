-- MARKET RADAR OS — Row Level Security, grants and security-definer entry points.
--
-- Authorization model
--   * Tenancy is the organization. Membership lives in organization_members.
--   * Roles: viewer < member < admin < owner.
--       viewer : read
--       member : read + create/update research artefacts
--       admin  : + delete, connector/scoring settings, membership management, audit read
--       owner  : + grant owner, delete organization
--   * Authorization NEVER reads auth.jwt() -> user_metadata (user-editable).
--   * `anon` has no table access at all. `service_role` bypasses RLS and is
--     only used server-side for system jobs (never shipped to the browser).

-- ===========================================================================
-- Authorization helpers (security definer, private schema, fixed search_path)
-- ===========================================================================
create or replace function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = org
       and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_org_role(org uuid, min_role public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
     where m.organization_id = org
       and m.user_id = (select auth.uid())
       and private.org_role_rank(m.role) >= private.org_role_rank(min_role)
  );
$$;

revoke all on function private.is_org_member(uuid) from public;
revoke all on function private.has_org_role(uuid, public.org_role) from public;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.has_org_role(uuid, public.org_role) to authenticated, service_role;
grant execute on function private.org_role_rank(public.org_role) to authenticated, service_role;

-- ===========================================================================
-- Grants: deny-by-default for anon, explicit for authenticated.
-- ===========================================================================
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ===========================================================================
-- Enable RLS on every table in public.
-- ===========================================================================
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end;
$$;

-- ===========================================================================
-- Standard tenant policies
--   full    : select member-of-org (viewer+), insert/update member+, delete admin+
--   append  : select viewer+, insert member+, no update/delete (immutable log)
-- ===========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'research_directives', 'research_runs', 'source_items', 'evidence', 'signals',
    'signal_evidence', 'signal_clusters', 'cluster_signals', 'opportunities',
    'opportunity_evidence', 'competitors', 'market_estimates', 'business_models',
    'experiments', 'advisor_sessions', 'reports'
  ]
  loop
    execute format($f$
      create policy "%1$s_select" on public.%1$I for select to authenticated
        using ((select private.is_org_member(organization_id)));
      create policy "%1$s_insert" on public.%1$I for insert to authenticated
        with check ((select private.has_org_role(organization_id, 'member')));
      create policy "%1$s_update" on public.%1$I for update to authenticated
        using ((select private.has_org_role(organization_id, 'member')))
        with check ((select private.has_org_role(organization_id, 'member')));
      create policy "%1$s_delete" on public.%1$I for delete to authenticated
        using ((select private.has_org_role(organization_id, 'admin')));
    $f$, t);
  end loop;

  foreach t in array array[
    'connector_runs', 'opportunity_scores', 'red_team_reviews', 'agent_runs', 'cost_ledger'
  ]
  loop
    execute format($f$
      create policy "%1$s_select" on public.%1$I for select to authenticated
        using ((select private.is_org_member(organization_id)));
      create policy "%1$s_insert" on public.%1$I for insert to authenticated
        with check ((select private.has_org_role(organization_id, 'member')));
    $f$, t);
  end loop;
end;
$$;

-- agent_runs need a single completion update (RUNNING -> SUCCEEDED/FAILED).
create policy "agent_runs_update" on public.agent_runs for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')) and status = 'RUNNING')
  with check ((select private.has_org_role(organization_id, 'member')));

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create policy "organizations_select" on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));
create policy "organizations_update" on public.organizations for update to authenticated
  using ((select private.has_org_role(id, 'admin')))
  with check ((select private.has_org_role(id, 'admin')));
create policy "organizations_delete" on public.organizations for delete to authenticated
  using ((select private.has_org_role(id, 'owner')));
-- INSERT only through public.create_organization() (adds the caller as owner atomically).

-- ---------------------------------------------------------------------------
-- profiles: a user sees and edits only their own profile.
-- ---------------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (default_organization_id is null or (select private.is_org_member(default_organization_id)))
  );

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------
create policy "members_select" on public.organization_members for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "members_insert" on public.organization_members for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, 'admin'))
    and (role <> 'owner' or (select private.has_org_role(organization_id, 'owner')))
  );
create policy "members_update" on public.organization_members for update to authenticated
  using ((select private.has_org_role(organization_id, 'admin')))
  with check (
    (select private.has_org_role(organization_id, 'admin'))
    and (role <> 'owner' or (select private.has_org_role(organization_id, 'owner')))
  );
create policy "members_delete" on public.organization_members for delete to authenticated
  using (
    (select private.has_org_role(organization_id, 'admin'))
    or user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Admin-managed configuration
-- ---------------------------------------------------------------------------
create policy "connectors_select" on public.connectors for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "connectors_insert" on public.connectors for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'admin')));
create policy "connectors_update" on public.connectors for update to authenticated
  using ((select private.has_org_role(organization_id, 'admin')))
  with check ((select private.has_org_role(organization_id, 'admin')));
create policy "connectors_delete" on public.connectors for delete to authenticated
  using ((select private.has_org_role(organization_id, 'admin')));

create policy "scoring_settings_select" on public.scoring_settings for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "scoring_settings_insert" on public.scoring_settings for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'admin')));
create policy "scoring_settings_update" on public.scoring_settings for update to authenticated
  using ((select private.has_org_role(organization_id, 'admin')))
  with check ((select private.has_org_role(organization_id, 'admin')));

create policy "compliance_checks_select" on public.compliance_checks for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "compliance_checks_insert" on public.compliance_checks for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, 'admin'))
    and checked_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Human decisions: always attributed to the caller.
-- ---------------------------------------------------------------------------
create policy "decisions_select" on public.decisions for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "decisions_insert" on public.decisions for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, 'member'))
    and decided_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Per-user rows
-- ---------------------------------------------------------------------------
create policy "watchlists_select" on public.watchlists for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy "watchlists_insert" on public.watchlists for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')) and user_id = (select auth.uid()));
create policy "watchlists_update" on public.watchlists for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)))
  with check (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));
create policy "watchlists_delete" on public.watchlists for delete to authenticated
  using (user_id = (select auth.uid()) or (select private.has_org_role(organization_id, 'admin')));

create policy "notifications_select" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_org_member(organization_id)));
create policy "notifications_update" on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- notifications are inserted by server jobs (service_role) only.

-- ---------------------------------------------------------------------------
-- Audit logs: admins read; writes only via public.record_audit_event().
-- ---------------------------------------------------------------------------
create policy "audit_logs_select" on public.audit_logs for select to authenticated
  using (organization_id is not null and (select private.has_org_role(organization_id, 'admin')));

-- ---------------------------------------------------------------------------
-- System settings: read-only for signed-in users, written by service_role.
-- ---------------------------------------------------------------------------
create policy "system_settings_select" on public.system_settings for select to authenticated
  using (true);

-- ===========================================================================
-- Security-definer entry points (validated; never trust caller-supplied actor)
-- ===========================================================================
create or replace function private.default_scoring_weights()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'painSeverity', 15, 'frequency', 10, 'willingnessToPay', 10, 'marketSize', 10,
    'trendMomentum', 8, 'existingSolutionGap', 8, 'distributionAdvantage', 7,
    'monetizationQuality', 7, 'buildability', 6, 'defensibility', 5,
    'regulatoryFeasibility', 5, 'timeToRevenue', 4, 'strategicFit', 2, 'socialValue', 3
  );
$$;

create or replace function private.bootstrap_organization(org_name text, owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org uuid;
  base_slug text;
begin
  base_slug := lower(regexp_replace(coalesce(nullif(org_name, ''), 'workspace'), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from left(base_slug, 40));
  if char_length(base_slug) < 2 then
    base_slug := 'workspace';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (org_name, base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), owner_id)
  returning id into new_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org, owner_id, 'owner');

  insert into public.scoring_settings (organization_id, name, weights, created_by)
  values (new_org, 'Default', private.default_scoring_weights(), owner_id);

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
  values (new_org, owner_id, 'organization.created', 'organization', new_org);

  return new_org;
end;
$$;
revoke all on function private.bootstrap_organization(text, uuid) from public;

-- Called by the app: create an organization owned by the caller.
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if org_name is null or char_length(trim(org_name)) = 0 or char_length(org_name) > 200 then
    raise exception 'invalid organization name' using errcode = 'check_violation';
  end if;
  return private.bootstrap_organization(trim(org_name), uid);
end;
$$;
revoke all on function public.create_organization(text) from public, anon;
grant execute on function public.create_organization(text) to authenticated;

-- Called by the app: append an audit event as the caller.
create or replace function public.record_audit_event(
  org uuid,
  event_action text,
  event_entity_type text,
  event_entity_id uuid default null,
  event_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_org_member(org) then
    raise exception 'not a member of organization' using errcode = '42501';
  end if;
  if event_action !~ '^[a-z_]+(\.[a-z_]+)+$' then
    raise exception 'invalid audit action' using errcode = 'check_violation';
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
  values (org, uid, event_action, event_entity_type, event_entity_id, coalesce(event_metadata, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.record_audit_event(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_audit_event(uuid, text, text, uuid, jsonb) to authenticated;

-- Spend aggregation used by budget enforcement (respects RLS: invoker).
create or replace function public.org_spend_usd(org uuid, since timestamptz)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(amount_usd), 0)
    from public.cost_ledger
   where organization_id = org
     and occurred_at >= since;
$$;
revoke all on function public.org_spend_usd(uuid, timestamptz) from public, anon;
grant execute on function public.org_spend_usd(uuid, timestamptz) to authenticated, service_role;

-- New auth user -> profile + personal workspace.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
  label text;
begin
  -- raw_user_meta_data is only used as a cosmetic display name, never for authorization.
  label := coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'user'), '@', 1));
  org := private.bootstrap_organization(left(label, 150) || ' workspace', new.id);
  insert into public.profiles (id, display_name, default_organization_id)
  values (new.id, left(label, 120), org);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ===========================================================================
-- System defaults
-- ===========================================================================
insert into public.system_settings (key, value, description) values
  ('budget.default_per_run_usd', '1.0', 'Default per-run budget for new research runs'),
  ('retention.source_items_days', '180', 'Raw third-party content retention window'),
  ('research.max_items_hard_limit', '500', 'Upper bound on items collected per run')
on conflict (key) do nothing;
