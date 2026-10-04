-- Phase 5: job queue, worker leasing, idempotency guards. Runs after 10_rls_and_integrity.sql
-- (reuses its helpers and fixtures: alice = org_a owner, bob = org_b owner, carol = viewer in org_a).
\set ON_ERROR_STOP on
\set QUIET on

create temp table ids as
select
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a') as org_a,
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000b') as org_b;
grant select on ids to authenticated, anon, service_role;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;

-- Fresh run for queue tests (alice).
select tests.login('00000000-0000-0000-0000-00000000000a');
insert into public.research_runs (id, organization_id, directive_id, created_by, status)
select '20000000-0000-0000-0000-0000000000a1', org_a, '10000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-00000000000a', 'QUEUED' from ids;

-- ---------------------------------------------------------------------------
-- Enqueue (user path): idempotent, membership + org checked, no direct writes
-- ---------------------------------------------------------------------------
create temp table q as
select (public.enqueue_job((select org_a from ids), 'RESEARCH_COLLECTION', 'research:a1:COLLECTION',
        '{"manualUrls":[]}'::jsonb, '20000000-0000-0000-0000-0000000000a1')) as r;
grant select on q to authenticated, anon, service_role;
select tests.expect_count($$select count(*) from q where (r ->> 'created')::boolean and r -> 'job' ->> 'status' = 'QUEUED'$$, 1,
  'member enqueues a job (QUEUED, created=true)');
select tests.expect_count($$select count(*) from q where not (r -> 'job') ? 'payload'$$, 1, 'enqueue does not echo the payload');
select tests.expect_count($$select count(*) from (select public.enqueue_job((select org_a from ids), 'RESEARCH_COLLECTION',
  'research:a1:COLLECTION', '{}'::jsonb, '20000000-0000-0000-0000-0000000000a1') as r) d
  where not (r ->> 'created')::boolean and r -> 'job' ->> 'id' = (select r -> 'job' ->> 'id' from q)$$, 1,
  'duplicate idempotency key returns the existing job');
select tests.expect_count('select count(*) from public.jobs', 1, 'exactly one job exists after duplicate enqueue');
select tests.expect_error($$insert into public.jobs (organization_id, job_type, idempotency_key) select org_a, 'RED_TEAM', 'x' from ids$$,
  'users cannot insert jobs directly');
select tests.expect_error($$update public.jobs set status = 'COMPLETED'$$, 'users cannot update jobs directly');
select tests.expect_error($$select * from public.claim_jobs('evil-worker', 1, 60, null)$$, 'users cannot claim jobs (service role only)');
select tests.expect_error($$select public.complete_job((select (r -> 'job' ->> 'id')::uuid from q), 'w', null)$$, 'users cannot complete jobs');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.expect_count('select count(*) from public.jobs', 0, 'bob cannot see alice jobs');
select tests.expect_error($$select public.enqueue_job((select org_a from ids), 'RED_TEAM', 'bob-x')$$, 'bob cannot enqueue into alice org');
select tests.expect_error($$select public.enqueue_job((select org_b from ids), 'RESEARCH_COLLECTION', 'bob-y', '{}'::jsonb,
  '20000000-0000-0000-0000-0000000000a1')$$, 'bob cannot reference alice run from his org (BOLA)');
select tests.expect_error($$select public.cancel_job((select (r -> 'job' ->> 'id')::uuid from q))$$, 'bob cannot cancel alice job');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_count('select count(*) from public.jobs', 1, 'viewer can see org jobs');
select tests.expect_error($$select public.enqueue_job((select org_a from ids), 'RED_TEAM', 'carol-x')$$, 'viewer cannot enqueue');
reset role;

-- ---------------------------------------------------------------------------
-- Worker path (service_role): leasing, heartbeat, retry, dead letter
-- ---------------------------------------------------------------------------
set role service_role;
select tests.expect_count($$select count(*) from public.claim_jobs('worker-A', 5, 60, null)$$, 1, 'worker A claims the job');
select tests.expect_count($$select count(*) from public.claim_jobs('worker-B', 5, 60, null)$$, 0, 'worker B cannot claim a leased job');
select tests.expect_count($$select count(*) from public.jobs where status = 'PROCESSING' and locked_by = 'worker-A' and attempt_count = 1$$, 1,
  'claim sets PROCESSING, owner and attempt 1');
select tests.expect_count($$select count(*) from (select 1 where public.heartbeat_job((select (r -> 'job' ->> 'id')::uuid from q), 'worker-B', 60)) x$$, 0,
  'heartbeat by a non-owner is refused');
select tests.expect_count($$select count(*) from (select 1 where public.heartbeat_job((select (r -> 'job' ->> 'id')::uuid from q), 'worker-A', 60)) x$$, 1,
  'owner heartbeat extends the lease');

-- Worker A dies: lease expires, worker B re-claims (attempt 2), A can no longer complete.
update public.jobs set lease_expires_at = now() - interval '1 second';
select tests.expect_count($$select count(*) from public.claim_jobs('worker-B', 5, 60, null) where attempt_count = 2$$, 1,
  'expired lease is re-claimed by another worker (attempt 2)');
select tests.expect_count($$select count(*) from (select 1 where public.complete_job((select (r -> 'job' ->> 'id')::uuid from q), 'worker-A', null)) x$$, 0,
  'the lost worker cannot complete the job');

-- Retryable failure → RETRYING with backoff, not claimable before available_at.
select tests.expect_count($$select count(*) from public.fail_job((select (r -> 'job' ->> 'id')::uuid from q), 'worker-B', 'ECONNRESET', true, 30)
  where status = 'RETRYING' and available_at > now() + interval '25 seconds'$$, 1, 'retryable failure is rescheduled with backoff');
select tests.expect_count($$select count(*) from public.claim_jobs('worker-C', 5, 60, null)$$, 0, 'job is not claimable during backoff');

-- Exhaust attempts → dead letter.
update public.jobs set available_at = now(), max_attempts = 3;
select tests.expect_count($$select count(*) from public.claim_jobs('worker-C', 5, 60, null)$$, 1, 'job is claimable after its backoff');
select tests.expect_count($$select count(*) from public.fail_job((select (r -> 'job' ->> 'id')::uuid from q), 'worker-C', 'still down', true, 30)
  where status = 'FAILED' and dead_lettered and failed_at is not null$$, 1, 'final attempt failure is dead-lettered');
select tests.expect_error($$update public.jobs set status = 'COMPLETED'$$, 'FAILED -> COMPLETED is an illegal job transition');
select tests.expect_count($$select count(*) from public.job_queue_stats() where status = 'FAILED'$$, 1, 'queue stats are available to the worker');
reset role;

-- Dead-letter re-queue: admins only.
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_error($$select public.requeue_dead_letter((select (r -> 'job' ->> 'id')::uuid from q))$$, 'viewer cannot re-queue a dead letter');
reset role;
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_count($$select count(*) from public.requeue_dead_letter((select (r -> 'job' ->> 'id')::uuid from q))
  where status = 'QUEUED' and attempt_count = 0 and not dead_lettered$$, 1, 'owner re-queues a dead letter with fresh attempts');

-- Cancel a queued research job → job and run CANCELLED.
select tests.expect_count($$select count(*) from public.cancel_job((select (r -> 'job' ->> 'id')::uuid from q)) where status = 'CANCELLED'$$, 1,
  'cancel_job cancels a queued job');
select tests.expect_count($$select count(*) from public.research_runs where id = '20000000-0000-0000-0000-0000000000a1' and status = 'CANCELLED'$$, 1,
  'cancelling a research stage job cancels its run');
reset role;

-- A worker that dies on the final attempt: the next claim dead-letters it and fails the run.
select tests.login('00000000-0000-0000-0000-00000000000a');
insert into public.research_runs (id, organization_id, directive_id, created_by, status)
select '20000000-0000-0000-0000-0000000000a2', org_a, '10000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-00000000000a', 'QUEUED' from ids;
select tests.expect_count($$select count(*) from (select public.enqueue_job((select org_a from ids), 'RESEARCH_COLLECTION', 'research:a2:COLLECTION',
  '{}'::jsonb, '20000000-0000-0000-0000-0000000000a2', null, 100, 1)) x$$, 1, 'enqueue a single-attempt job');
reset role;
set role service_role;
select tests.expect_count($$select count(*) from public.claim_jobs('worker-D', 5, 60, array['RESEARCH_COLLECTION'])$$, 1, 'claim filtered by job type');
update public.jobs set lease_expires_at = now() - interval '1 second' where research_run_id = '20000000-0000-0000-0000-0000000000a2';
select tests.expect_count($$select count(*) from public.claim_jobs('worker-E', 5, 60, null)$$, 0, 'exhausted crashed job is not re-claimed');
select tests.expect_count($$select count(*) from public.jobs where research_run_id = '20000000-0000-0000-0000-0000000000a2' and dead_lettered$$, 1,
  'exhausted crashed job is dead-lettered');
select tests.expect_count($$select count(*) from public.research_runs where id = '20000000-0000-0000-0000-0000000000a2' and status = 'FAILED'$$, 1,
  'its research run is failed, not left in progress');
reset role;

-- ---------------------------------------------------------------------------
-- Idempotency guards for business data
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
select tests.expect_error($$
  insert into public.evidence (organization_id, research_run_id, source_item_id, evidence_text, evidence_type, retrieved_at)
  select org_a, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '空港からホテルまでの移動が分かりにくく', 'QUOTE', now() from ids
$$, 'duplicate evidence excerpt of the same source is rejected');
select tests.expect_count($$
  with ins as (
    insert into public.evidence (organization_id, research_run_id, source_item_id, evidence_text, evidence_type, retrieved_at)
    select org_a, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '空港からホテルまでの移動が分かりにくく', 'QUOTE', now() from ids
    on conflict (source_item_id, text_hash) do nothing returning 1)
  select count(*) from ins$$, 0, 'evidence upsert on (source_item_id, text_hash) is a no-op for duplicates');
select tests.expect_error($$
  insert into public.opportunities (organization_id, research_run_id, cluster_id, title, pain)
  select org_a, '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'dup', 'dup' from ids
$$, 'a second opportunity for the same cluster is rejected');
select tests.expect_error($$
  select public.create_opportunity_with_evidence((select org_a from ids),
    jsonb_build_object('research_run_id', '20000000-0000-0000-0000-000000000001', 'cluster_id', '60000000-0000-0000-0000-000000000001', 'title', 't', 'pain', 'p'),
    array[]::uuid[])
$$, 'create_opportunity_with_evidence requires evidence');
select tests.expect_error($$
  select public.insert_signals_with_evidence((select org_a from ids), jsonb_build_array(
    jsonb_build_object('research_run_id', '20000000-0000-0000-0000-000000000001', 'problem', 'ok', 'signal_type', 'PAIN', 'extracted_by', 't',
      'urgency_score', 1, 'frequency_signal', 1, 'willingness_to_pay_score', 1, 'switching_intent_score', 1,
      'trust_issue', false, 'price_issue', false, 'access_issue', false, 'confidence', 'LOW',
      'evidence_ids', jsonb_build_array('40000000-0000-0000-0000-000000000001')),
    jsonb_build_object('research_run_id', '20000000-0000-0000-0000-000000000001', 'problem', 'bad', 'signal_type', 'PAIN', 'extracted_by', 't',
      'urgency_score', 1, 'frequency_signal', 1, 'willingness_to_pay_score', 1, 'switching_intent_score', 1,
      'trust_issue', false, 'price_issue', false, 'access_issue', false, 'confidence', 'LOW',
      'evidence_ids', jsonb_build_array('40000000-0000-0000-0000-0000000000ff'))))
$$, 'signal batch with an invented evidence id fails as a whole');
select tests.expect_count($$select count(*) from public.signals where problem in ('ok', 'bad')$$, 0, 'no partial signal batch is persisted');
select tests.expect_count($$select count(*) from public.insert_signals_with_evidence((select org_a from ids), jsonb_build_array(
    jsonb_build_object('research_run_id', '20000000-0000-0000-0000-000000000001', 'problem', 'atomic', 'signal_type', 'PAIN', 'extracted_by', 't',
      'urgency_score', 1, 'frequency_signal', 1, 'willingness_to_pay_score', 1, 'switching_intent_score', 1,
      'trust_issue', false, 'price_issue', false, 'access_issue', false, 'confidence', 'LOW',
      'evidence_ids', jsonb_build_array('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'))))$$, 1,
  'signal + evidence links are inserted together (duplicate ids collapsed)');
select tests.expect_count($$select count(*) from public.signal_evidence se join public.signals s on s.id = se.signal_id where s.problem = 'atomic'$$, 1,
  'atomic signal has its evidence link');
reset role;

select tests.login('00000000-0000-0000-0000-00000000000b');
select tests.expect_error($$
  select public.insert_signals_with_evidence((select org_b from ids), jsonb_build_array(
    jsonb_build_object('research_run_id', '20000000-0000-0000-0000-000000000001', 'problem', 'x', 'signal_type', 'PAIN', 'extracted_by', 't',
      'urgency_score', 1, 'frequency_signal', 1, 'willingness_to_pay_score', 1, 'switching_intent_score', 1,
      'trust_issue', false, 'price_issue', false, 'access_issue', false, 'confidence', 'LOW',
      'evidence_ids', jsonb_build_array('40000000-0000-0000-0000-000000000001'))))
$$, 'bob cannot attach signals to alice run/evidence');
reset role;

select tests.expect_count($$select count(*) from public.research_runs where progress_percent between 0 and 100$$,
  (select count(*) from public.research_runs), 'research runs expose progress_percent');
