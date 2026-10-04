-- Phase 6: worker health (admin-only summary, no member access) and human quality reviews.
\set ON_ERROR_STOP on
\set QUIET on

create temp table ids as
select
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a') as org_a,
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000b') as org_b;
grant select on ids to authenticated, anon, service_role;

-- Worker publishes liveness (service_role).
set role service_role;
insert into public.worker_heartbeats (worker_id, started_at, jobs_processed, jobs_failed, current_job_id, current_job_type, version, app_env, diagnostics)
values ('worker-1', now() - interval '1 hour', 12, 1, '99999999-0000-0000-0000-000000000001', 'SIGNAL_EXTRACTION', 'abc123', 'staging',
        '{"BRAVE_SEARCH_API_KEY": "CONFIGURED"}');
reset role;

-- Members: no direct access, no summary.
select tests.login('00000000-0000-0000-0000-00000000000c'); -- carol: viewer in alice's org
select tests.expect_error($$select count(*) from public.worker_heartbeats$$, 'viewer cannot read worker heartbeats');
select tests.expect_error($$select public.worker_health_summary()$$, 'viewer cannot read worker health');
reset role;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'erin@example.com');
insert into public.organization_members (organization_id, user_id, role)
select org_a, '00000000-0000-0000-0000-00000000000e', 'member' from ids;
select tests.login('00000000-0000-0000-0000-00000000000e');
select tests.expect_error($$select public.worker_health_summary()$$, 'member cannot read worker health');
select tests.expect_error($$insert into public.worker_heartbeats (worker_id, started_at) values ('fake', now())$$, 'members cannot publish worker heartbeats');
reset role;

-- Organization owners are not platform operators (every user owns a personal org).
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_error($$select public.worker_health_summary()$$, 'organization owner without operator role cannot read worker health');
reset role;
insert into private.platform_operators (user_id, note) values ('00000000-0000-0000-0000-00000000000a', 'test operator');

-- Platform operator: aggregated summary, never job ids.
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_count($$select jsonb_array_length(public.worker_health_summary() -> 'workers')::bigint$$, 1, 'platform operator reads worker health summary');
select tests.expect_error($$select count(*) from private.platform_operators$$, 'operators list is not readable by users');
select tests.expect_count($$select count(*) from (select public.worker_health_summary()::text as s) x where s like '%99999999-0000-0000-0000-000000000001%'$$, 0,
  'worker health never exposes job ids');
select tests.expect_count($$select count(*) from (select public.worker_health_summary() -> 'workers' -> 0 ->> 'version' as v) x where v = 'abc123'$$, 1,
  'worker health includes version');

-- ---------------------------------------------------------------------------
-- Quality reviews (human-editable)
-- ---------------------------------------------------------------------------
insert into public.quality_reviews (organization_id, research_run_id, entity_type, entity_id, rating, decision)
select org_a, '20000000-0000-0000-0000-000000000001', 'OPPORTUNITY', '70000000-0000-0000-0000-000000000001', 4, 'DEEP_DIVE' from ids;
select tests.expect_count($$select count(*) from public.quality_reviews where reviewed_by = '00000000-0000-0000-0000-00000000000a'$$, 1, 'member records a review as themselves');
update public.quality_reviews set rating = 5, note = '再確認' where entity_id = '70000000-0000-0000-0000-000000000001';
select tests.expect_count($$select count(*) from public.quality_reviews where rating = 5$$, 1, 'human fields stay editable');
select tests.expect_error($$
  insert into public.quality_reviews (organization_id, research_run_id, entity_type, entity_id, rating, reviewed_by)
  select org_a, '20000000-0000-0000-0000-000000000001', 'SIGNAL', '50000000-0000-0000-0000-000000000001', 3, '00000000-0000-0000-0000-00000000000e' from ids
$$, 'cannot record a review in someone else''s name');
select tests.expect_error($$
  insert into public.quality_reviews (organization_id, research_run_id, entity_type, entity_id, rating)
  select org_a, '20000000-0000-0000-0000-000000000001', 'OPPORTUNITY', '70000000-0000-0000-0000-0000000000ff', 3 from ids
$$, 'review target must exist in the run');
select tests.expect_error($$
  insert into public.quality_reviews (organization_id, research_run_id, entity_type, entity_id, rating)
  select org_a, '20000000-0000-0000-0000-000000000001', 'OPPORTUNITY', '70000000-0000-0000-0000-000000000001', 9 from ids
$$, 'rating must be 1-5');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000e'); -- erin (member) reviews too; cannot edit alice's review
select tests.expect_count($$
  with u as (update public.quality_reviews set rating = 1 where reviewed_by = '00000000-0000-0000-0000-00000000000a' returning 1)
  select count(*) from u$$, 0, 'members cannot edit another reviewer''s review');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.expect_count('select count(*) from public.quality_reviews', 0, 'bob cannot read alice reviews');
select tests.expect_error($$
  insert into public.quality_reviews (organization_id, research_run_id, entity_type, entity_id, rating)
  select org_a, '20000000-0000-0000-0000-000000000001', 'OPPORTUNITY', '70000000-0000-0000-0000-000000000001', 1 from ids
$$, 'bob cannot review alice opportunities');
reset role;
