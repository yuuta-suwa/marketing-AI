-- MARKET RADAR OS — deployed schema verification (read-only).
-- Run against hosted Supabase after `supabase db push`:   npm run verify:hosted-db
-- Also run by scripts/test-db.sh against the local migration cluster.
-- Any failed check raises an exception (ON_ERROR_STOP aborts the run).
\set ON_ERROR_STOP on
\set QUIET on

do $verify$
declare
  missing text[];
  n bigint;
  expected_tables text[] := array[
    'advisor_sessions','agent_runs','audit_logs','business_models','cluster_signals','competitors','compliance_checks',
    'connector_runs','connectors','cost_ledger','decisions','evidence','experiments','feedback_events','jobs',
    'market_estimates','notifications','opportunities','opportunity_evidence','opportunity_scores','organization_members',
    'organizations','profiles','quality_reviews','red_team_reviews','reports','research_directives','research_runs',
    'scoring_settings','signal_clusters','signal_evidence','signals','source_items','system_settings','watchlists','worker_heartbeats'];
  expected_functions text[] := array[
    'cancel_job','claim_jobs','complete_job','consume_rate_limit','create_opportunity_with_evidence','create_organization',
    'enqueue_job','fail_job','heartbeat_job','insert_signals_with_evidence','integrity_report','job_queue_stats','org_spend_usd',
    'record_audit_event','release_job','request_research_cancellation','requeue_dead_letter','set_signal_embeddings','worker_health_summary'];
  expected_triggers text[] := array[
    'enforce_evidence_integrity','enforce_experiment_actor','enforce_experiment_transition','enforce_job_transition',
    'enforce_opportunity_gate','enforce_quality_review_target','enforce_research_run_transition','enforce_scoring_weights',
    'enforce_watchlist_target','protect_last_owner','set_updated_at'];
  expected_indexes text[] := array[
    'jobs_ready_idx','jobs_lease_idx','evidence_source_text_uidx','opportunities_cluster_uidx','signals_embedding_hnsw',
    'research_runs_org_idx','worker_heartbeats_recent_idx','quality_reviews_run_idx'];
  service_only text[] := array['claim_jobs','heartbeat_job','complete_job','fail_job','release_job','job_queue_stats',
    'set_signal_embeddings','create_opportunity_with_evidence','insert_signals_with_evidence'];
begin
  -- Extensions
  select array_agg(e) into missing from unnest(array['vector','pgcrypto']) e
   where not exists (select 1 from pg_extension x where x.extname = e);
  if missing is not null then raise exception 'FAIL extensions missing: %', missing; end if;
  raise notice 'ok   - extensions vector, pgcrypto';

  -- Tables
  select array_agg(t) into missing from unnest(expected_tables) t
   where to_regclass('public.' || t) is null;
  if missing is not null then raise exception 'FAIL tables missing: %', missing; end if;
  raise notice 'ok   - % expected tables exist', cardinality(expected_tables);

  -- RLS on every public table
  select array_agg(c.relname) into missing from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if missing is not null then raise exception 'FAIL RLS disabled on: %', missing; end if;
  raise notice 'ok   - RLS enabled on every public table';

  -- Policies: every table has at least one, except service-role-only tables
  select array_agg(c.relname) into missing from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname <> 'worker_heartbeats'
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  if missing is not null then raise exception 'FAIL tables without policies: %', missing; end if;
  select count(*) into n from pg_policies where schemaname = 'public';
  raise notice 'ok   - policies present (% total)', n;

  -- Functions
  select array_agg(f) into missing from unnest(expected_functions) f
   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = f);
  if missing is not null then raise exception 'FAIL functions missing: %', missing; end if;
  raise notice 'ok   - % expected functions exist', cardinality(expected_functions);

  -- SECURITY DEFINER functions must pin search_path
  select array_agg(p.proname) into missing from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if missing is not null then raise exception 'FAIL security definer without search_path: %', missing; end if;
  raise notice 'ok   - every SECURITY DEFINER function pins search_path';

  -- Triggers
  select array_agg(t) into missing from unnest(expected_triggers) t
   where not exists (select 1 from pg_trigger g where g.tgname = t and not g.tgisinternal);
  if missing is not null then raise exception 'FAIL triggers missing: %', missing; end if;
  raise notice 'ok   - % expected triggers exist', cardinality(expected_triggers);

  -- Indexes
  select array_agg(i) into missing from unnest(expected_indexes) i where to_regclass('public.' || i) is null;
  if missing is not null then raise exception 'FAIL indexes missing: %', missing; end if;
  raise notice 'ok   - % key indexes exist', cardinality(expected_indexes);

  -- Grants: worker-controlled data
  if has_table_privilege('authenticated', 'public.research_runs', 'UPDATE') then raise exception 'FAIL authenticated can UPDATE research_runs'; end if;
  if has_table_privilege('authenticated', 'public.evidence', 'INSERT') then raise exception 'FAIL authenticated can INSERT evidence'; end if;
  if has_column_privilege('authenticated', 'public.opportunities', 'score_total', 'UPDATE') then raise exception 'FAIL authenticated can UPDATE opportunities.score_total'; end if;
  if has_table_privilege('authenticated', 'public.jobs', 'INSERT') or has_table_privilege('authenticated', 'public.jobs', 'UPDATE') then raise exception 'FAIL authenticated can write jobs'; end if;
  if has_table_privilege('authenticated', 'public.worker_heartbeats', 'SELECT') then raise exception 'FAIL authenticated can read worker_heartbeats'; end if;
  select array_agg(f) into missing from unnest(service_only) f
   where exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                  where s.nspname = 'public' and p.proname = f and has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if missing is not null then raise exception 'FAIL authenticated can execute worker functions: %', missing; end if;
  if exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public') then
    raise exception 'FAIL anon has table grants in public';
  end if;
  raise notice 'ok   - grants: worker-controlled data, worker RPCs and anon are locked down';

  -- Realtime (hosted Supabase only)
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    select array_agg(t) into missing from unnest(array['research_runs','jobs']) t
     where not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t);
    if missing is not null then raise exception 'FAIL realtime publication missing: %', missing; end if;
    raise notice 'ok   - realtime publication includes research_runs, jobs';
  else
    raise notice 'skip - no supabase_realtime publication (not a hosted Supabase database)';
  end if;

  -- Migration history (hosted Supabase CLI only)
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*) from supabase_migrations.schema_migrations' into n;
    if n < 14 then raise exception 'FAIL only % migrations recorded (expected 14)', n; end if;
    raise notice 'ok   - % migrations recorded', n;
  else
    raise notice 'skip - no supabase_migrations.schema_migrations (local cluster)';
  end if;
end;
$verify$;

\echo 'SCHEMA VERIFICATION PASSED'
