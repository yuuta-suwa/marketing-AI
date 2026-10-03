-- MARKET RADAR OS — foundation: extensions, schemas, shared helpers.
-- All business tables live in `public` (exposed through the Data API, protected by RLS).
-- Security-definer helpers live in `private`, which is NOT exposed through the Data API.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enumerations (kept as CHECK-constrained text in tables where the list is
-- expected to evolve; true enums only for the security-critical role list).
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('viewer', 'member', 'admin', 'owner');

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Role ordering used by authorization helpers.
create or replace function private.org_role_rank(r public.org_role)
returns int
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'viewer' then 1
    when 'member' then 2
    when 'admin' then 3
    when 'owner' then 4
  end;
$$;
