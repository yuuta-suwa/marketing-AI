-- Local approximation of the Supabase Security/Performance Advisors (splinter-style lints),
-- evaluated against the migrated schema. Read-only. The hosted advisors remain authoritative:
-- run them on the hosted project (Dashboard → Advisors or scripts/supabase-advisors.sh).
\pset footer off
\pset format aligned
with
pub_tables as (
  select c.oid, c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
findings as (
  -- SECURITY ---------------------------------------------------------------
  select 'ERROR' as level, 'SECURITY' as category, 'rls_disabled_in_public' as lint, relname::text as object, 'RLS disabled' as detail
    from pub_tables where not relrowsecurity
  union all
  select 'INFO', 'SECURITY', 'rls_enabled_no_policy', relname::text, 'RLS on, no policies (service-role only by design?)'
    from pub_tables t where relrowsecurity and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname)
  union all
  select 'WARN', 'SECURITY', 'function_search_path_mutable', n.nspname || '.' || p.proname, 'search_path not pinned'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  union all
  select 'ERROR', 'SECURITY', 'security_definer_view', c.relname::text, 'view without security_invoker'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)
  union all
  select 'ERROR', 'SECURITY', 'auth_users_exposed', c.relname::text, 'public view references auth.users'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ilike '%auth.users%'
  union all
  select 'WARN', 'SECURITY', 'extension_in_public', e.extname::text, 'extension installed in public schema'
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname = 'public'
  union all
  select 'WARN', 'SECURITY', 'security_definer_function_executable_by_anon', n.nspname || '.' || p.proname, 'anon can execute a SECURITY DEFINER function'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
  -- PERFORMANCE ------------------------------------------------------------
  union all
  select 'WARN', 'PERFORMANCE', 'auth_rls_initplan', tablename || '.' || policyname, 'auth.uid()/current_setting() re-evaluated per row (wrap in select)'
    from pg_policies
   where schemaname = 'public'
     and ((coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.uid\(\)|current_setting\(')
     and (coalesce(qual, '') || coalesce(with_check, '')) !~ '\(\s*SELECT\s+(auth\.uid|current_setting)'
  union all
  select 'WARN', 'PERFORMANCE', 'multiple_permissive_policies', tablename || ' ' || cmd || ' ' || r::text, count(*)::text || ' permissive policies'
    from pg_policies, unnest(roles) r
   where schemaname = 'public' and permissive = 'PERMISSIVE'
   group by tablename, cmd, r having count(*) > 1
  union all
  -- Stricter variant: not even the FK's leading column is indexed (cascades/joins scan the table).
  select 'WARN', 'PERFORMANCE', 'unindexed_foreign_key_leading_column', cl.relname || '.' || con.conname, 'no index starts with the FK''s first column'
    from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
   where con.contype = 'f' and n.nspname = 'public'
     and not exists (select 1 from pg_index i where i.indrelid = con.conrelid and (i.indkey::int2[])[0] = con.conkey[1])
  union all
  select 'INFO', 'PERFORMANCE', 'unindexed_foreign_keys', cl.relname || '.' || con.conname, 'no index with the FK columns as prefix'
    from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace n on n.oid = cl.relnamespace
   where con.contype = 'f' and n.nspname = 'public'
     and not exists (
       select 1 from pg_index i
        where i.indrelid = con.conrelid
          and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey
          and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] <@ con.conkey)
  union all
  select 'WARN', 'PERFORMANCE', 'duplicate_index', min(ic.relname)::text || ' = ' || max(ic.relname)::text, 'identical index definitions'
    from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class t on t.oid = i.indrelid join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
   group by i.indrelid, i.indkey::text, coalesce(pg_get_expr(i.indexprs, i.indrelid), ''), coalesce(pg_get_expr(i.indpred, i.indrelid), '')
  having count(*) > 1
  union all
  select 'INFO', 'PERFORMANCE', 'no_primary_key', relname::text, 'table without primary key'
    from pub_tables t where not exists (select 1 from pg_constraint c where c.conrelid = t.oid and c.contype = 'p')
)
select level, category, lint, object, detail from findings
 order by case level when 'ERROR' then 0 when 'WARN' then 1 else 2 end, category, lint, object;
