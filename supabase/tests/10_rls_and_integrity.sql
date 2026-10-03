-- RLS + integrity tests. Run by scripts/test-db.sh after the shim and migrations.
-- Any failed assertion raises and aborts the psql session (ON_ERROR_STOP).
\set ON_ERROR_STOP on
\set QUIET on

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.expect_error(stmt text, label text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok   - % (rejected: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL - % : statement unexpectedly succeeded', label;
end;
$$;

create function tests.expect_count(stmt text, expected bigint, label text) returns void
language plpgsql as $$
declare n bigint;
begin
  execute stmt into n;
  if n is distinct from expected then
    raise exception 'FAIL - % : expected %, got %', label, expected, n;
  end if;
  raise notice 'ok   - %', label;
end;
$$;
grant execute on all functions in schema tests to anon, authenticated;

create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com');

select tests.expect_count('select count(*) from public.organizations', 3, 'signup bootstraps one organization per user');
select tests.expect_count('select count(*) from public.profiles', 3, 'signup creates profiles');
select tests.expect_count('select count(*) from public.scoring_settings where is_active', 3, 'signup seeds default scoring');

create temp table ids as
select
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a') as org_a,
  (select default_organization_id from public.profiles where id = '00000000-0000-0000-0000-00000000000b') as org_b;
grant select on ids to authenticated, anon;

-- Carol becomes a viewer in Alice's org.
insert into public.organization_members (organization_id, user_id, role)
select org_a, '00000000-0000-0000-0000-00000000000c', 'viewer' from ids;

-- ---------------------------------------------------------------------------
-- Alice writes into her own organization
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');

insert into public.research_directives (id, organization_id, raw_input, objective, created_by)
select '10000000-0000-0000-0000-000000000001', org_a, '旅行市場の不満から新規事業を探す', 'travel pains',
       '00000000-0000-0000-0000-00000000000a' from ids;
insert into public.research_runs (id, organization_id, directive_id, created_by)
select '20000000-0000-0000-0000-000000000001', org_a, '10000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-00000000000a' from ids;
insert into public.source_items (id, organization_id, research_run_id, connector_key, source_type,
  source_name, body, retrieved_at, content_hash, compliance_status)
select '30000000-0000-0000-0000-000000000001', org_a, '20000000-0000-0000-0000-000000000001', 'manual_import',
       'MANUAL', 'Manual', '空港からホテルまでの移動が分かりにくく、毎回タクシーに高いお金を払っている。',
       now(), repeat('a', 64), 'MANUAL_UPLOAD' from ids;
insert into public.evidence (id, organization_id, research_run_id, source_item_id, evidence_text, evidence_type, retrieved_at)
select '40000000-0000-0000-0000-000000000001', org_a, '20000000-0000-0000-0000-000000000001',
       '30000000-0000-0000-0000-000000000001', '空港からホテルまでの移動が分かりにくく', 'QUOTE', now() from ids;

select tests.expect_count('select count(*) from public.research_runs', 1, 'alice sees her run');

-- Evidence must be verbatim
select tests.expect_error($$
  insert into public.evidence (organization_id, research_run_id, source_item_id, evidence_text, evidence_type, retrieved_at)
  select org_a, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
         '存在しない引用文', 'QUOTE', now() from ids
$$, 'fabricated evidence text is rejected');

-- Research run state machine
select tests.expect_error($$
  update public.research_runs set status = 'COMPLETED' where id = '20000000-0000-0000-0000-000000000001'
$$, 'DRAFT -> COMPLETED is illegal');
update public.research_runs set status = 'QUEUED' where id = '20000000-0000-0000-0000-000000000001';
update public.research_runs set status = 'COLLECTING' where id = '20000000-0000-0000-0000-000000000001';
select tests.expect_count($$select count(*) from public.research_runs where started_at is not null$$, 1,
  'COLLECTING stamps started_at');
select tests.expect_error($$
  update public.research_runs set status = 'QUEUED' where id = '20000000-0000-0000-0000-000000000001'
$$, 'backwards transition is illegal');
select tests.expect_error($$
  insert into public.research_runs (organization_id, directive_id, created_by, status)
  select org_a, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'COMPLETED' from ids
$$, 'runs cannot be created in a terminal state');

-- Signals, clusters, opportunities
insert into public.signals (id, organization_id, research_run_id, problem, signal_type, extracted_by)
select '50000000-0000-0000-0000-000000000001', org_a, '20000000-0000-0000-0000-000000000001',
       '空港からの移動手段が分かりにくい', 'INFORMATION_GAP', 'test' from ids;
insert into public.signal_evidence (signal_id, evidence_id, organization_id)
select '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', org_a from ids;
select tests.expect_error($$
  insert into public.signal_evidence (signal_id, evidence_id, organization_id)
  select '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000ff', org_a from ids
$$, 'invented evidence id is rejected');

insert into public.signal_clusters (id, organization_id, research_run_id, name)
select '60000000-0000-0000-0000-000000000001', org_a, '20000000-0000-0000-0000-000000000001', '空港アクセス' from ids;
insert into public.opportunities (id, organization_id, research_run_id, cluster_id, title, pain)
select '70000000-0000-0000-0000-000000000001', org_a, '20000000-0000-0000-0000-000000000001',
       '60000000-0000-0000-0000-000000000001', '空港アクセスナビ', '移動が分かりにくい' from ids;

select tests.expect_error($$
  update public.opportunities set status = 'VALIDATED' where id = '70000000-0000-0000-0000-000000000001'
$$, 'cannot validate an opportunity without evidence');
insert into public.opportunity_evidence (opportunity_id, evidence_id, organization_id)
select '70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', org_a from ids;
update public.opportunities set status = 'VALIDATED' where id = '70000000-0000-0000-0000-000000000001';
update public.opportunities set status = 'EXPERIMENT_PROPOSED' where id = '70000000-0000-0000-0000-000000000001';
select tests.expect_error($$
  update public.opportunities set status = 'EXPERIMENT_APPROVED' where id = '70000000-0000-0000-0000-000000000001'
$$, 'approval gate requires a human decision');
select tests.expect_error($$
  insert into public.decisions (organization_id, opportunity_id, decision, from_status, to_status, decided_by)
  select org_a, '70000000-0000-0000-0000-000000000001', 'APPROVE', 'EXPERIMENT_PROPOSED', 'EXPERIMENT_APPROVED',
         '00000000-0000-0000-0000-00000000000b' from ids
$$, 'decision cannot be attributed to another user');
insert into public.decisions (organization_id, opportunity_id, decision, from_status, to_status, decided_by)
select org_a, '70000000-0000-0000-0000-000000000001', 'APPROVE', 'EXPERIMENT_PROPOSED', 'EXPERIMENT_APPROVED',
       '00000000-0000-0000-0000-00000000000a' from ids;
update public.opportunities set status = 'EXPERIMENT_APPROVED' where id = '70000000-0000-0000-0000-000000000001';
select tests.expect_error($$
  update public.opportunities set status = 'LAUNCHED' where id = '70000000-0000-0000-0000-000000000001'
$$, 'skipping PoC gates is illegal');

-- Market estimates must cite real evidence
select tests.expect_error($$
  insert into public.market_estimates (organization_id, opportunity_id, method, formula, inputs, assumptions, source_evidence_ids, created_by)
  select org_a, '70000000-0000-0000-0000-000000000001', 'BOTTOM_UP', 'a*b', '{}', '[]',
         array['40000000-0000-0000-0000-0000000000ff'::uuid], 'test' from ids
$$, 'market estimate with invented evidence id is rejected');

-- Scoring weights must sum to 100
select tests.expect_error($$
  update public.scoring_settings set weights = weights || '{"painSeverity": 50}'::jsonb
   where organization_id = (select org_a from ids)
$$, 'scoring weights not summing to 100 are rejected');

-- Audit log: no direct writes, RPC works
select tests.expect_error($$
  insert into public.audit_logs (organization_id, actor_id, action, entity_type)
  select org_a, '00000000-0000-0000-0000-00000000000a', 'x.y', 'z' from ids
$$, 'direct audit insert is denied');
select public.record_audit_event((select org_a from ids), 'research.created', 'research_run',
  '20000000-0000-0000-0000-000000000001');
select tests.expect_count('select count(*) from public.audit_logs where action = ''research.created''', 1,
  'record_audit_event appends an entry');

-- Cost ledger is append-only
insert into public.cost_ledger (organization_id, category, provider, amount_usd)
select org_a, 'AI', 'mock', 0.01 from ids;
select tests.expect_count($$select count(*) from public.cost_ledger$$, 1, 'cost ledger insert');
update public.cost_ledger set amount_usd = 0;
select tests.expect_count($$select count(*) from public.cost_ledger where amount_usd = 0$$, 0,
  'cost ledger rows cannot be modified');
delete from public.cost_ledger;
select tests.expect_count($$select count(*) from public.cost_ledger$$, 1, 'cost ledger rows cannot be deleted');

reset role;

-- ---------------------------------------------------------------------------
-- Bob (other organization) cannot read or modify Alice's data
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000b');

select tests.expect_count('select count(*) from public.research_runs', 0, 'bob cannot read alice runs');
select tests.expect_count('select count(*) from public.evidence', 0, 'bob cannot read alice evidence');
select tests.expect_count('select count(*) from public.opportunities', 0, 'bob cannot read alice opportunities');
select tests.expect_count('select count(*) from public.organizations', 1, 'bob sees only his organization');
select tests.expect_count('select count(*) from public.profiles', 1, 'bob sees only his profile');
select tests.expect_count('select count(*) from public.audit_logs where organization_id = (select org_a from ids)', 0,
  'bob cannot read alice audit log');
select tests.expect_count('select count(*) from public.cost_ledger', 0, 'bob cannot read alice costs');

update public.opportunities set title = 'hijacked' where id = '70000000-0000-0000-0000-000000000001';
select tests.expect_error($$
  insert into public.research_directives (organization_id, raw_input, objective, created_by)
  select org_a, 'x', 'x', '00000000-0000-0000-0000-00000000000b' from ids
$$, 'bob cannot insert into alice organization');
select tests.expect_error($$
  insert into public.organization_members (organization_id, user_id, role)
  select org_a, '00000000-0000-0000-0000-00000000000b', 'owner' from ids
$$, 'bob cannot add himself to alice organization');
select tests.expect_error($$
  select public.record_audit_event((select org_a from ids), 'x.y', 'z')
$$, 'bob cannot write alice audit log');
select tests.expect_error($$
  update public.profiles set default_organization_id = (select org_a from ids)
   where id = '00000000-0000-0000-0000-00000000000b'
$$, 'bob cannot point his profile at alice organization');

-- Cross-tenant link: Bob tries to cite Alice's source item from his own org
insert into public.research_directives (id, organization_id, raw_input, objective, created_by)
select '10000000-0000-0000-0000-000000000002', org_b, 'x', 'x', '00000000-0000-0000-0000-00000000000b' from ids;
insert into public.research_runs (id, organization_id, directive_id, created_by)
select '20000000-0000-0000-0000-000000000002', org_b, '10000000-0000-0000-0000-000000000002',
       '00000000-0000-0000-0000-00000000000b' from ids;
select tests.expect_error($$
  insert into public.evidence (organization_id, research_run_id, source_item_id, evidence_text, evidence_type, retrieved_at)
  select org_b, '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001',
         '空港', 'QUOTE', now() from ids
$$, 'cross-tenant evidence link is rejected');

reset role;
select tests.expect_count($$select count(*) from public.opportunities where title = 'hijacked'$$, 0,
  'bob update on alice opportunity affected no rows');

-- ---------------------------------------------------------------------------
-- Carol (viewer in Alice's org): read-only
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000c');
select tests.expect_count('select count(*) from public.research_runs', 1, 'viewer can read org runs');
select tests.expect_error($$
  insert into public.research_directives (organization_id, raw_input, objective, created_by)
  select org_a, 'x', 'x', '00000000-0000-0000-0000-00000000000c' from ids
$$, 'viewer cannot create directives');
select tests.expect_count('select count(*) from public.audit_logs where organization_id = (select org_a from ids)', 0,
  'viewer cannot read org audit logs');
select tests.expect_error($$
  update public.connectors set enabled = true
$$ || ' where false; insert into public.connectors (organization_id, connector_key, display_name) select org_a, ''x_test'', ''x'' from ids',
  'viewer cannot configure connectors');
reset role;

-- ---------------------------------------------------------------------------
-- anon: no access at all
-- ---------------------------------------------------------------------------
set role anon;
select tests.expect_error('select count(*) from public.organizations', 'anon cannot read organizations');
select tests.expect_error('select count(*) from public.evidence', 'anon cannot read evidence');
select tests.expect_error($$select public.create_organization('x')$$, 'anon cannot create organizations');
reset role;

-- ---------------------------------------------------------------------------
-- Owner protection
-- ---------------------------------------------------------------------------
select tests.expect_error($$
  delete from public.organization_members
   where user_id = '00000000-0000-0000-0000-00000000000a'
     and organization_id = (select org_a from ids)
$$, 'last owner cannot be removed');


-- ---------------------------------------------------------------------------
-- M3: experiments state machine + human attribution; analysis rows
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-00000000000a');
insert into public.experiments (id, organization_id, opportunity_id, title, hypothesis, deadline)
select '80000000-0000-0000-0000-000000000001', org_a, '70000000-0000-0000-0000-000000000001', 'LP', 'h', '2026-12-01' from ids;
select tests.expect_error($$
  insert into public.experiments (organization_id, opportunity_id, title, hypothesis, status)
  select org_a, '70000000-0000-0000-0000-000000000001', 'x', 'h', 'RUNNING' from ids
$$, 'experiments must start as PROPOSED');
select tests.expect_error($$
  update public.experiments set status = 'RUNNING' where id = '80000000-0000-0000-0000-000000000001'
$$, 'experiment cannot skip approval');
select tests.expect_error($$
  update public.experiments set status = 'APPROVED', approved_by = '00000000-0000-0000-0000-00000000000b'
   where id = '80000000-0000-0000-0000-000000000001'
$$, 'experiment approval cannot be attributed to someone else');
update public.experiments set status = 'APPROVED', approved_by = '00000000-0000-0000-0000-00000000000a'
 where id = '80000000-0000-0000-0000-000000000001';
update public.experiments set status = 'RUNNING' where id = '80000000-0000-0000-0000-000000000001';
select tests.expect_error($$
  update public.experiments set status = 'COMPLETED' where id = '80000000-0000-0000-0000-000000000001'
$$, 'completed experiment requires a result');
update public.experiments set status = 'COMPLETED', result_summary = 'CVR 6%', decision = 'CONTINUE',
       decided_by = '00000000-0000-0000-0000-00000000000a'
 where id = '80000000-0000-0000-0000-000000000001';
select tests.expect_count($$select count(*) from public.experiments where status = 'COMPLETED' and ended_at is not null$$, 1,
  'experiment completes with result and timestamps');

insert into public.business_models (organization_id, opportunity_id, model_type, is_primary, created_by)
select org_a, '70000000-0000-0000-0000-000000000001', 'SUBSCRIPTION', true, 'test' from ids;
select tests.expect_error($$
  insert into public.business_models (organization_id, opportunity_id, model_type, is_primary, created_by)
  select org_a, '70000000-0000-0000-0000-000000000001', 'SERVICE', true, 'test' from ids
$$, 'only one primary business model per opportunity');
reset role;

-- A member (not admin) may regenerate analysis rows but not delete evidence.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'dave@example.com');
insert into public.organization_members (organization_id, user_id, role)
select org_a, '00000000-0000-0000-0000-00000000000d', 'member' from ids;
select tests.login('00000000-0000-0000-0000-00000000000d');
delete from public.business_models where opportunity_id = '70000000-0000-0000-0000-000000000001';
select tests.expect_count($$select count(*) from public.business_models$$, 0, 'member can replace business model analysis');
delete from public.evidence;
select tests.expect_count($$select count(*) from public.evidence$$, 1, 'member cannot delete evidence');
reset role;

\echo 'ALL DATABASE TESTS PASSED'
