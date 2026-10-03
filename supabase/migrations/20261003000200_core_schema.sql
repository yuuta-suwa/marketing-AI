-- MARKET RADAR OS — core schema.
--
-- Conventions
--   * UUID primary keys (gen_random_uuid()).
--   * timestamptz everywhere; created_at / updated_at on mutable tables.
--   * Every tenant-owned row carries organization_id.
--   * Parent tables expose UNIQUE (id, organization_id) so children reference
--     them with COMPOSITE foreign keys. This makes cross-tenant links
--     impossible at the database level (an evidence row can never point at a
--     source item of another organization, etc.).
--   * Flexible external payloads are jsonb.
--   * Epistemic status (FACT / INFERENCE / HYPOTHESIS / ASSUMPTION / CALCULATION)
--     is stored explicitly wherever AI output is persisted.

-- ===========================================================================
-- Identity & tenancy
-- ===========================================================================
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan text not null default 'free',
  per_run_budget_usd numeric(12, 4) not null default 1.00 check (per_run_budget_usd >= 0),
  daily_budget_usd numeric(12, 4) not null default 5.00 check (daily_budget_usd >= 0),
  monthly_budget_usd numeric(12, 4) not null default 50.00 check (monthly_budget_usd >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  avatar_url text,
  locale text not null default 'ja',
  timezone text not null default 'Asia/Tokyo',
  default_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- ===========================================================================
-- Research
-- ===========================================================================
create table public.research_directives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  raw_input text not null check (char_length(raw_input) between 1 and 4000),
  objective text not null,
  countries text[] not null default '{}',
  languages text[] not null default '{}',
  personas text[] not null default '{}',
  categories text[] not null default '{}',
  keywords text[] not null default '{}',
  negative_keywords text[] not null default '{}',
  time_range jsonb not null default '{}'::jsonb,
  source_preferences text[] not null default '{}',
  max_items int not null default 50 check (max_items between 1 and 1000),
  budget_limit_usd numeric(12, 4) not null default 0.50 check (budget_limit_usd >= 0),
  deep_research boolean not null default false,
  parser text not null default 'rule' check (parser in ('rule', 'ai')),
  parse_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index research_directives_org_idx on public.research_directives (organization_id, created_at desc);

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  directive_id uuid not null,
  parent_run_id uuid,
  opportunity_id uuid,
  run_type text not null default 'PRIMARY' check (run_type in (
    'PRIMARY', 'ADDITIONAL', 'OVERSEAS_COMPARISON', 'COMPETITOR', 'WILLINGNESS_TO_PAY',
    'MARKET_SIZE', 'REGULATION', 'PRICING', 'DISTRIBUTION', 'RED_TEAM'
  )),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'QUEUED', 'COLLECTING', 'NORMALIZING', 'EXTRACTING', 'CLUSTERING',
    'ANALYZING', 'VALIDATING', 'COMPLETED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'
  )),
  status_reason text,
  degraded boolean not null default false,
  stats jsonb not null default '{}'::jsonb,
  budget_limit_usd numeric(12, 4) not null default 0.50 check (budget_limit_usd >= 0),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (directive_id, organization_id)
    references public.research_directives (id, organization_id) on delete cascade,
  foreign key (parent_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete set null (parent_run_id)
);
create index research_runs_org_idx on public.research_runs (organization_id, created_at desc);
create index research_runs_status_idx on public.research_runs (organization_id, status);

-- ===========================================================================
-- Connectors
-- ===========================================================================
create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connector_key text not null check (connector_key ~ '^[a-z0-9_]{2,64}$'),
  display_name text not null,
  enabled boolean not null default false,
  compliance_status text not null default 'PENDING_REVIEW' check (compliance_status in (
    'APPROVED', 'PENDING_REVIEW', 'DISABLED_PENDING_COMPLIANCE', 'BLOCKED'
  )),
  -- Credentials are NEVER stored here. Only whether the server sees them.
  credential_status text not null default 'MISSING' check (credential_status in (
    'CONFIGURED', 'MISSING', 'NOT_REQUIRED'
  )),
  settings jsonb not null default '{}'::jsonb,
  last_health jsonb,
  last_health_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, connector_key)
);

create table public.connector_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  connector_key text not null,
  status text not null check (status in ('SUCCESS', 'FAILED', 'SKIPPED', 'PARTIAL')),
  result_count int not null default 0,
  duplicate_count int not null default 0,
  duration_ms int not null default 0,
  retry_count int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create index connector_runs_run_idx on public.connector_runs (research_run_id);

-- ===========================================================================
-- Evidence lake
-- ===========================================================================
create table public.source_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  connector_key text not null,
  source_type text not null,
  source_name text not null,
  source_url text,
  canonical_url text,
  external_id text,
  title text,
  body text not null check (char_length(body) between 1 and 100000),
  language text,
  country text,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  engagement jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  compliance_status text not null check (compliance_status in ('APPROVED', 'MANUAL_UPLOAD')),
  -- Deletion policy: raw third-party content expires; derived evidence keeps a quote.
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (research_run_id, content_hash),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create unique index source_items_external_uidx
  on public.source_items (research_run_id, connector_key, external_id)
  where external_id is not null;
create index source_items_canonical_idx on public.source_items (organization_id, canonical_url)
  where canonical_url is not null;
create index source_items_hash_idx on public.source_items (organization_id, content_hash);
create index source_items_run_idx on public.source_items (research_run_id);
create index source_items_retention_idx on public.source_items (retention_until)
  where retention_until is not null;

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  source_item_id uuid not null,
  source_url text,
  -- evidence_text MUST be a verbatim excerpt of source_items.body (trigger-enforced).
  evidence_text text not null check (char_length(evidence_text) between 1 and 4000),
  -- evidence_summary may be AI-written; it is an INFERENCE, never a FACT.
  evidence_summary text,
  evidence_type text not null check (evidence_type in (
    'QUOTE', 'REVIEW', 'POST', 'ARTICLE', 'STATISTIC', 'OFFICIAL_RECORD', 'MANUAL_NOTE'
  )),
  retrieved_at timestamptz not null,
  confidence text not null default 'MEDIUM' check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  language text,
  country text,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (source_item_id, organization_id)
    references public.source_items (id, organization_id) on delete cascade,
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create index evidence_source_idx on public.evidence (source_item_id);
create index evidence_run_idx on public.evidence (research_run_id);

-- ===========================================================================
-- Signals & clusters
-- ===========================================================================
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  persona text,
  situation text,
  problem text not null check (char_length(problem) between 1 and 2000),
  desired_outcome text,
  current_alternative text,
  alternative_failure text,
  urgency_score smallint not null default 0 check (urgency_score between 0 and 100),
  frequency_signal smallint not null default 0 check (frequency_signal between 0 and 100),
  willingness_to_pay_score smallint not null default 0 check (willingness_to_pay_score between 0 and 100),
  switching_intent_score smallint not null default 0 check (switching_intent_score between 0 and 100),
  trust_issue boolean not null default false,
  price_issue boolean not null default false,
  access_issue boolean not null default false,
  category text,
  location text,
  signal_type text not null check (signal_type in (
    'PAIN', 'ANXIETY', 'REQUEST', 'SHORTAGE', 'WORKAROUND', 'SWITCHING', 'PAY_SIGNAL',
    'PRICE_GAP', 'ACCESS_GAP', 'TRUST_GAP', 'INFORMATION_GAP', 'DISTRIBUTION_GAP',
    'CAPACITY_GAP', 'REGULATION_GAP'
  )),
  confidence text not null default 'LOW' check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  epistemic_status text not null default 'INFERENCE' check (epistemic_status in ('FACT', 'INFERENCE')),
  language text,
  country text,
  embedding extensions.vector(1536),
  embedding_model text,
  extracted_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create index signals_run_idx on public.signals (research_run_id);
create index signals_org_type_idx on public.signals (organization_id, signal_type, created_at desc);
create index signals_embedding_hnsw on public.signals
  using hnsw (embedding extensions.vector_cosine_ops);

-- Join table: a signal is only as good as the evidence it cites.
create table public.signal_evidence (
  signal_id uuid not null,
  evidence_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (signal_id, evidence_id),
  foreign key (signal_id, organization_id)
    references public.signals (id, organization_id) on delete cascade,
  foreign key (evidence_id, organization_id)
    references public.evidence (id, organization_id) on delete cascade
);
create index signal_evidence_evidence_idx on public.signal_evidence (evidence_id);

create table public.signal_clusters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  name text not null,
  summary text,
  signal_count int not null default 0 check (signal_count >= 0),
  source_count int not null default 0 check (source_count >= 0),
  countries text[] not null default '{}',
  languages text[] not null default '{}',
  first_seen timestamptz,
  last_seen timestamptz,
  momentum numeric(6, 2) not null default 0,
  pain_score smallint not null default 0 check (pain_score between 0 and 100),
  pay_signal_score smallint not null default 0 check (pay_signal_score between 0 and 100),
  confidence text not null default 'LOW' check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  centroid extensions.vector(1536),
  naming_method text not null default 'rule' check (naming_method in ('rule', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create index signal_clusters_run_idx on public.signal_clusters (research_run_id);
create index signal_clusters_org_idx on public.signal_clusters (organization_id, created_at desc);

create table public.cluster_signals (
  cluster_id uuid not null,
  signal_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  similarity numeric(5, 4),
  created_at timestamptz not null default now(),
  primary key (cluster_id, signal_id),
  foreign key (cluster_id, organization_id)
    references public.signal_clusters (id, organization_id) on delete cascade,
  foreign key (signal_id, organization_id)
    references public.signals (id, organization_id) on delete cascade
);
create index cluster_signals_signal_idx on public.cluster_signals (signal_id);

-- ===========================================================================
-- Opportunities
-- ===========================================================================
create table public.scoring_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null default 'Default',
  weights jsonb not null,
  is_active boolean not null default true,
  version int not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create unique index scoring_settings_active_uidx
  on public.scoring_settings (organization_id) where is_active;

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid not null,
  -- Opportunities are only ever generated from an evidence-backed cluster.
  cluster_id uuid not null,
  title text not null check (char_length(title) between 1 and 300),
  customer text,
  trigger text,
  situation text,
  pain text not null,
  desired_outcome text,
  current_alternatives text,
  market_gap text,
  pay_signal text,
  market_size_summary text,
  competitors_summary text,
  revenue_model text,
  distribution_strategy text,
  moat text,
  ai_necessity text,
  regulatory_risk text,
  main_risk text,
  next_experiment text,
  kill_criteria text,
  -- Map of field name -> FACT | INFERENCE | HYPOTHESIS | ASSUMPTION | CALCULATION
  field_provenance jsonb not null default '{}'::jsonb,
  status text not null default 'DISCOVERED' check (status in (
    'DISCOVERED', 'RESEARCHING', 'VALIDATED', 'EXPERIMENT_PROPOSED', 'EXPERIMENT_APPROVED',
    'POC_PROPOSED', 'POC_APPROVED', 'ON_HOLD', 'REJECTED', 'LAUNCHED'
  )),
  confidence text not null default 'LOW' check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  score_total numeric(5, 2) check (score_total between 0 and 100),
  momentum numeric(6, 2) not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade,
  foreign key (cluster_id, organization_id)
    references public.signal_clusters (id, organization_id) on delete restrict
);
create index opportunities_org_idx on public.opportunities (organization_id, created_at desc);
create index opportunities_score_idx on public.opportunities (organization_id, score_total desc nulls last);
create index opportunities_status_idx on public.opportunities (organization_id, status);

-- research_runs.opportunity_id (additional research launched from an opportunity)
alter table public.research_runs
  add constraint research_runs_opportunity_fk
  foreign key (opportunity_id, organization_id)
  references public.opportunities (id, organization_id) on delete set null (opportunity_id);
create index research_runs_opportunity_idx on public.research_runs (opportunity_id)
  where opportunity_id is not null;

create table public.opportunity_evidence (
  opportunity_id uuid not null,
  evidence_id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  relevance text,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, evidence_id),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade,
  foreign key (evidence_id, organization_id)
    references public.evidence (id, organization_id) on delete cascade
);
create index opportunity_evidence_evidence_idx on public.opportunity_evidence (evidence_id);

create table public.opportunity_scores (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  scoring_settings_id uuid,
  weights jsonb not null,
  components jsonb not null,
  total numeric(5, 2) not null check (total between 0 and 100),
  -- Score and confidence are deliberately separate dimensions.
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  confidence_breakdown jsonb not null default '{}'::jsonb,
  scored_by text not null,
  created_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade,
  foreign key (scoring_settings_id, organization_id)
    references public.scoring_settings (id, organization_id) on delete set null (scoring_settings_id)
);
create index opportunity_scores_opp_idx on public.opportunity_scores (opportunity_id, created_at desc);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  name text not null,
  competitor_type text not null check (competitor_type in ('DIRECT', 'INDIRECT', 'ALTERNATIVE')),
  url text,
  pricing text,
  positioning text,
  customer_complaints text,
  strengths text,
  weaknesses text,
  market_gap text,
  epistemic_status text not null default 'INFERENCE' check (epistemic_status in (
    'FACT', 'INFERENCE', 'HYPOTHESIS', 'ASSUMPTION'
  )),
  source_evidence_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade
);
create index competitors_opp_idx on public.competitors (opportunity_id);

create table public.market_estimates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  method text not null check (method in ('TOP_DOWN', 'BOTTOM_UP', 'VALUE_THEORY')),
  formula text not null,
  inputs jsonb not null,
  assumptions jsonb not null,
  result_value numeric,
  result_unit text,
  currency text,
  source_evidence_ids uuid[] not null default '{}',
  confidence text not null default 'LOW' check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  epistemic_status text not null default 'CALCULATION' check (epistemic_status = 'CALCULATION'),
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade
);
create index market_estimates_opp_idx on public.market_estimates (opportunity_id);

create table public.business_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  model_type text not null check (model_type in (
    'SUBSCRIPTION', 'TRANSACTION_FEE', 'MARKETPLACE_COMMISSION', 'LEAD_GENERATION',
    'ADVERTISING', 'LICENSING', 'DATA_PRODUCT', 'SERVICE', 'B2B_SAAS', 'CONSUMER_APP', 'HYBRID'
  )),
  description text,
  fit_score smallint check (fit_score between 0 and 100),
  pricing jsonb not null default '{}'::jsonb,
  -- CFO analysis: metric -> { value, unit, epistemic: FACT|ASSUMPTION|CALCULATION, formula? }
  unit_economics jsonb not null default '{}'::jsonb,
  risks text,
  is_primary boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade
);
create index business_models_opp_idx on public.business_models (opportunity_id);

create table public.red_team_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  research_run_id uuid,
  -- [{ key, question, answer, severity, epistemic }]
  findings jsonb not null,
  biggest_assumption text,
  worst_case text,
  kill_criteria text,
  verdict text not null check (verdict in ('PROCEED', 'PROCEED_WITH_CAUTION', 'NEEDS_EVIDENCE', 'STOP')),
  created_by text not null,
  created_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade,
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete set null (research_run_id)
);
create index red_team_reviews_opp_idx on public.red_team_reviews (opportunity_id, created_at desc);

create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  title text not null,
  hypothesis text not null,
  method text,
  metric text,
  success_criteria text,
  kill_criteria text,
  budget_usd numeric(12, 2),
  status text not null default 'PROPOSED' check (status in (
    'PROPOSED', 'APPROVED', 'RUNNING', 'COMPLETED', 'CANCELLED'
  )),
  results jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade
);
create index experiments_opp_idx on public.experiments (opportunity_id);

-- ===========================================================================
-- Executive layer
-- ===========================================================================
create table public.advisor_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  -- [{ perspective, opinion, concerns[], epistemic }]
  perspectives jsonb not null default '[]'::jsonb,
  consensus text,
  disagreements jsonb not null default '[]'::jsonb,
  unanswered_questions jsonb not null default '[]'::jsonb,
  critical_assumptions jsonb not null default '[]'::jsonb,
  required_evidence jsonb not null default '[]'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'COMPLETED', 'FAILED')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  opportunity_id uuid not null,
  decision text not null check (decision in ('APPROVE', 'REJECT', 'HOLD', 'WATCH', 'REQUEST_RESEARCH')),
  from_status text,
  to_status text,
  rationale text,
  advisor_session_id uuid,
  -- Always a human. Enforced by RLS (decided_by = auth.uid()).
  decided_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade,
  foreign key (advisor_session_id, organization_id)
    references public.advisor_sessions (id, organization_id) on delete set null (advisor_session_id)
);
create index decisions_opp_idx on public.decisions (opportunity_id, created_at desc);

create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in (
    'OPPORTUNITY', 'COMPETITOR', 'INDUSTRY', 'PROBLEM', 'PERSONA', 'COUNTRY',
    'KEYWORD', 'TECHNOLOGY', 'REGULATION'
  )),
  target_id uuid,
  query text,
  schedule_cron text,
  active boolean not null default true,
  last_checked_at timestamptz,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_id is not null or query is not null)
);
create index watchlists_org_idx on public.watchlists (organization_id, active);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  report_type text not null check (report_type in (
    'DAILY_BRIEF', 'RESEARCH_SUMMARY', 'OPPORTUNITY', 'POC_SPEC', 'CLAUDE_CODE_PROMPT'
  )),
  title text not null,
  content_md text not null default '',
  content_json jsonb not null default '{}'::jsonb,
  opportunity_id uuid,
  research_run_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade,
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade
);
create index reports_org_idx on public.reports (organization_id, report_type, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- ===========================================================================
-- Operations: agents, compliance, cost, audit, settings
-- ===========================================================================
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid,
  opportunity_id uuid,
  agent_name text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  provider text not null,
  model text not null,
  token_usage jsonb not null default '{}'::jsonb,
  estimated_cost numeric(14, 6) not null default 0 check (estimated_cost >= 0),
  status text not null check (status in ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED_BUDGET')),
  error text,
  retry_count int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms int,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete cascade,
  foreign key (opportunity_id, organization_id)
    references public.opportunities (id, organization_id) on delete cascade
);
create index agent_runs_run_idx on public.agent_runs (research_run_id);
create index agent_runs_org_idx on public.agent_runs (organization_id, created_at desc);

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connector_key text not null,
  status text not null check (status in (
    'APPROVED', 'PENDING_REVIEW', 'DISABLED_PENDING_COMPLIANCE', 'BLOCKED'
  )),
  terms_url text,
  api_terms_reviewed boolean not null default false,
  robots_reviewed boolean not null default false,
  reviewer_notes text,
  valid_until timestamptz,
  checked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index compliance_checks_connector_idx on public.compliance_checks (organization_id, connector_key, created_at desc);

create table public.cost_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  research_run_id uuid,
  agent_run_id uuid,
  category text not null check (category in ('AI', 'EMBEDDING', 'SEARCH_API', 'EXTERNAL_API', 'CONNECTOR')),
  provider text not null,
  model text,
  connector_key text,
  agent_name text,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  units numeric not null default 0,
  amount_usd numeric(14, 6) not null check (amount_usd >= 0),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (research_run_id, organization_id)
    references public.research_runs (id, organization_id) on delete set null (research_run_id),
  foreign key (agent_run_id, organization_id)
    references public.agent_runs (id, organization_id) on delete set null (agent_run_id)
);
create index cost_ledger_org_time_idx on public.cost_ledger (organization_id, occurred_at desc);
create index cost_ledger_run_idx on public.cost_ledger (research_run_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_.]{2,100}$'),
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- updated_at triggers
-- ===========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'organization_members', 'research_directives', 'research_runs',
    'connectors', 'source_items', 'signals', 'signal_clusters', 'scoring_settings',
    'opportunities', 'competitors', 'market_estimates', 'business_models', 'experiments',
    'advisor_sessions', 'watchlists', 'reports', 'system_settings'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function private.set_updated_at()', t);
  end loop;
end;
$$;
