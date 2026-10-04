-- Phase 6: members cannot modify worker-controlled data; cancellation goes through the approved RPC.
\set ON_ERROR_STOP on
\set QUIET on

create temp table ids as
select
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a') as org_a,
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000b') as org_b;
grant select on ids to authenticated, anon, service_role;

-- Fixture: a QUEUED run created by alice (the normal user path) …
select tests.login('00000000-0000-0000-0000-00000000000a');
insert into public.research_runs (id, organization_id, directive_id, created_by, status)
select '20000000-0000-0000-0000-0000000000b1', org_a, '10000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-00000000000a', 'QUEUED' from ids;
select tests.expect_count($$select count(*) from (select public.enqueue_job((select org_a from ids), 'RESEARCH_COLLECTION',
  'research:b1:COLLECTION', '{}'::jsonb, '20000000-0000-0000-0000-0000000000b1')) x$$, 1, 'member enqueues research');

-- ---------------------------------------------------------------------------
-- Run fields are worker-controlled
-- ---------------------------------------------------------------------------
select tests.expect_error($$update public.research_runs set status = 'COMPLETED' where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot mark a run COMPLETED');
select tests.expect_error($$update public.research_runs set status = 'CANCELLED' where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot set run status directly (cancellation uses the RPC)');
select tests.expect_error($$update public.research_runs set cost_usd = 0 where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot change run cost');
select tests.expect_error($$update public.research_runs set organization_id = (select org_b from ids) where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot change run organization');
select tests.expect_error($$update public.research_runs set progress_percent = 100, current_action = 'done' where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot overwrite worker progress');
select tests.expect_error($$update public.research_runs set stats = '{"opportunities": 99}' where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot rewrite run stats');
select tests.expect_error($$update public.research_runs set status_reason = 'all good' where id = '20000000-0000-0000-0000-0000000000b1'$$,
  'member cannot rewrite internal error information');
select tests.expect_error($$
  insert into public.research_runs (organization_id, directive_id, created_by, status, cost_usd)
  select org_a, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'QUEUED', 5 from ids
$$, 'member cannot create a run with pre-filled cost');
select tests.expect_error($$
  insert into public.research_runs (organization_id, directive_id, created_by, status, progress_percent)
  select org_a, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'QUEUED', 100 from ids
$$, 'member cannot create a run with pre-filled progress');
select tests.expect_error($$
  insert into public.research_runs (organization_id, directive_id, created_by, status)
  select org_a, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'QUEUED' from ids
$$, 'member cannot create a run attributed to someone else');

-- ---------------------------------------------------------------------------
-- Pipeline output, scores and executions are worker-controlled
-- ---------------------------------------------------------------------------
select tests.expect_error($$update public.opportunities set score_total = 99 where id = '70000000-0000-0000-0000-000000000001'$$,
  'member cannot overwrite the system score');
select tests.expect_error($$update public.opportunities set confidence = 'HIGH' where id = '70000000-0000-0000-0000-000000000001'$$,
  'member cannot overwrite evidence confidence');
select tests.expect_error($$update public.opportunities set organization_id = (select org_b from ids) where id = '70000000-0000-0000-0000-000000000001'$$,
  'member cannot move an opportunity to another organization');
select tests.expect_error($$
  insert into public.opportunity_scores (organization_id, opportunity_id, weights, total, components, confidence, confidence_breakdown, scored_by)
  select org_a, '70000000-0000-0000-0000-000000000001', '{}', 99, '{}', 'HIGH', '{}', 'me' from ids
$$, 'member cannot insert opportunity scores');
select tests.expect_error($$
  insert into public.connector_runs (organization_id, research_run_id, connector_key, status)
  select org_a, '20000000-0000-0000-0000-0000000000b1', 'web_search', 'SUCCESS' from ids
$$, 'member cannot fabricate connector executions');
select tests.expect_error($$
  insert into public.opportunity_evidence (opportunity_id, evidence_id, organization_id)
  select '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', org_a from ids
$$, 'member cannot link evidence to opportunities directly');
select tests.expect_count($$
  with u as (update public.opportunities set competitors_summary = '人手で確認済み' where id = '70000000-0000-0000-0000-000000000001' returning 1)
  select count(*) from u$$, 1, 'member can still write the summary of an analysis they ran');
reset role;

-- Pipeline agent runs belong to the worker.
set role service_role;
insert into public.agent_runs (id, organization_id, agent_name, provider, model, research_run_id, status)
select '90000000-0000-0000-0000-000000000001', org_a, 'PainMinerAgent', 'anthropic', 'm', '20000000-0000-0000-0000-0000000000b1', 'RUNNING' from ids;
reset role;
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_count($$
  with u as (update public.agent_runs set status = 'SUCCEEDED' where id = '90000000-0000-0000-0000-000000000001' returning 1)
  select count(*) from u$$, 0, 'member cannot alter a pipeline agent execution');
reset role;

-- ---------------------------------------------------------------------------
-- Cancellation through the approved interface
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000c'); -- carol: viewer
select tests.expect_error($$select public.request_research_cancellation('20000000-0000-0000-0000-0000000000b1')$$, 'viewer cannot cancel');
reset role;
select tests.login('00000000-0000-0000-0000-00000000000b'); -- bob: other org
select tests.expect_error($$select public.request_research_cancellation('20000000-0000-0000-0000-0000000000b1')$$, 'other organization cannot cancel');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_count($$select count(*) from (select public.request_research_cancellation('20000000-0000-0000-0000-0000000000b1') as s) x where s = 'CANCELLED'$$, 1,
  'member cancels a queued run through the RPC');
select tests.expect_count($$select count(*) from public.research_runs where id = '20000000-0000-0000-0000-0000000000b1' and status = 'CANCELLED' and progress_percent = 100$$, 1,
  'run is CANCELLED');
select tests.expect_count($$select count(*) from public.jobs where research_run_id = '20000000-0000-0000-0000-0000000000b1' and status = 'CANCELLED'$$, 1,
  'its queued job is CANCELLED');
select tests.expect_count($$select count(*) from public.audit_logs where action = 'research.cancel_requested' and entity_id = '20000000-0000-0000-0000-0000000000b1'$$, 1,
  'cancellation is audited');
select tests.expect_count($$select count(*) from (select public.request_research_cancellation('20000000-0000-0000-0000-0000000000b1') as s) x where s = 'CANCELLED'$$, 1,
  'cancelling a finished run is a no-op');

-- A run whose job is being processed: the worker is asked to stop.
insert into public.research_runs (id, organization_id, directive_id, created_by, status)
select '20000000-0000-0000-0000-0000000000b2', org_a, '10000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-00000000000a', 'QUEUED' from ids;
select tests.expect_count($$select count(*) from (select public.enqueue_job((select org_a from ids), 'RESEARCH_COLLECTION',
  'research:b2:COLLECTION', '{}'::jsonb, '20000000-0000-0000-0000-0000000000b2')) x$$, 1, 'enqueue second run');
reset role;
set role service_role;
select tests.expect_count($$select count(*) from public.claim_jobs('worker-Z', 1, 60, array['RESEARCH_COLLECTION'])$$, 1, 'worker claims it');
reset role;
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_count($$select count(*) from (select public.request_research_cancellation('20000000-0000-0000-0000-0000000000b2') as s) x where s = 'CANCELLING'$$, 1,
  'cancelling a processing run asks the worker to stop');
reset role;
set role service_role;
select tests.expect_count($$select count(*) from public.jobs where research_run_id = '20000000-0000-0000-0000-0000000000b2' and cancel_requested$$, 1,
  'processing job is flagged cancel_requested');
select tests.expect_count($$select count(*) from (select 1 where public.heartbeat_job(
  (select id from public.jobs where research_run_id = '20000000-0000-0000-0000-0000000000b2'), 'worker-Z', 60)) x$$, 0,
  'the worker heartbeat reports the cancellation');
reset role;
