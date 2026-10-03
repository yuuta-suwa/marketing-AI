-- M2: research engine observability + signal provenance.

-- Per-field epistemic status of extracted signals (FACT / INFERENCE / HYPOTHESIS).
alter table public.signals add column field_provenance jsonb not null default '{}'::jsonb;

-- Connector cost attribution for observability.
alter table public.connector_runs add column cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0);
create index connector_runs_org_time_idx on public.connector_runs (organization_id, started_at desc);
