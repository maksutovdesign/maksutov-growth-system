-- Maksutov Growth CRM — core schema
-- Run in Supabase migrations. Requires pgcrypto (available on Supabase).

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner','admin','operator','viewer');
create type public.company_status as enum ('new','researching','qualified','active','won','lost','archived');
create type public.opportunity_type as enum ('direct_client','studio_partner','job','seo','content','backlink','other');
create type public.opportunity_stage as enum ('discovered','qualified','drafting','approval_pending','approved','contacted','replied','meeting','proposal','won','lost','paused','archived');
create type public.approval_level as enum ('A0','A1','A2','A3');
create type public.approval_status as enum ('pending','approved','rejected','expired','invalidated');
create type public.draft_type as enum ('cold_email','follow_up','job_application','dm','contact_form','seo_patch','content','other');
create type public.draft_status as enum ('draft','ready_for_approval','approved','rejected','sent','superseded');
create type public.touch_channel as enum ('email','linkedin','contact_form','job_portal','call','meeting','other');
create type public.touch_direction as enum ('outbound','inbound','internal');
create type public.task_status as enum ('todo','in_progress','blocked','done','cancelled');
create type public.run_status as enum ('queued','running','succeeded','failed','cancelled');
create type public.suppression_scope as enum ('email','person','company','domain');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  domain text,
  website_url text,
  country text,
  city text,
  industry text,
  company_size text,
  funding_stage text,
  source_url text,
  design_trigger text,
  trigger_date date,
  fit_score numeric(5,2) check (fit_score between 0 and 100),
  status public.company_status not null default 'new',
  owner_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index companies_workspace_domain_uq
  on public.companies (workspace_id, lower(domain))
  where domain is not null and btrim(domain) <> '';

create table public.people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text not null,
  title text,
  role_type text,
  email text,
  email_source text,
  email_confidence numeric(4,3) check (email_confidence between 0 and 1),
  linkedin_url text,
  other_profile_url text,
  preferred_language text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index people_workspace_email_uq
  on public.people (workspace_id, lower(email))
  where email is not null and btrim(email) <> '';
create unique index people_workspace_linkedin_uq
  on public.people (workspace_id, lower(linkedin_url))
  where linkedin_url is not null and btrim(linkedin_url) <> '';

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  type public.opportunity_type not null,
  title text not null,
  source_url text,
  trigger text,
  score numeric(5,2) check (score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) check (confidence between 0 and 1),
  value_band text,
  stage public.opportunity_stage not null default 'discovered',
  next_action text,
  next_action_at timestamptz,
  approval_level public.approval_level not null default 'A1',
  owner_user_id uuid references auth.users(id) on delete set null,
  lost_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index opportunities_workspace_stage_next_idx
  on public.opportunities (workspace_id, stage, next_action_at);
create index opportunities_workspace_score_idx
  on public.opportunities (workspace_id, score desc nulls last);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  person_id uuid references public.people(id) on delete cascade,
  evidence_type text not null,
  source_url text,
  source_ref text,
  fact text not null,
  inference text,
  confidence numeric(4,3) not null default 0.5 check (confidence between 0 and 1),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint evidence_has_parent check (
    opportunity_id is not null or company_id is not null or person_id is not null
  )
);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  type public.draft_type not null,
  channel public.touch_channel,
  subject text,
  body text not null,
  personalization_basis jsonb not null default '[]'::jsonb,
  claims_used jsonb not null default '[]'::jsonb,
  status public.draft_status not null default 'draft',
  version integer not null default 1 check (version > 0),
  payload_hash text,
  created_by_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  draft_id uuid references public.drafts(id) on delete set null,
  level public.approval_level not null,
  action_type text not null,
  target text not null,
  payload_hash text not null,
  payload_snapshot jsonb not null,
  status public.approval_status not null default 'pending',
  requested_by text,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index approvals_workspace_status_idx
  on public.approvals (workspace_id, status, requested_at desc);

create table public.touchpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  approval_id uuid references public.approvals(id) on delete set null,
  channel public.touch_channel not null,
  direction public.touch_direction not null,
  touch_type text,
  subject text,
  body text,
  occurred_at timestamptz not null default now(),
  outcome text,
  external_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index touchpoints_workspace_person_idx
  on public.touchpoints (workspace_id, person_id, occurred_at desc);

create table public.suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope public.suppression_scope not null,
  normalized_value text not null,
  reason text not null,
  source text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (workspace_id, scope, normalized_value)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  task_type text not null,
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  priority numeric(8,3),
  impact numeric(3,1),
  effort numeric(3,1),
  confidence numeric(4,3) check (confidence between 0 and 1),
  acceptance_criteria jsonb not null default '[]'::jsonb,
  assigned_agent text,
  owner_user_id uuid references auth.users(id) on delete set null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_workspace_status_due_idx
  on public.tasks (workspace_id, status, due_at);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_name text not null,
  task_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.run_status not null default 'running',
  input_summary text,
  output_summary text,
  sources_count integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  approvals_created integer not null default 0,
  external_actions integer not null default 0,
  error_category text,
  error_safe text,
  trace_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index agent_runs_workspace_started_idx
  on public.agent_runs (workspace_id, started_at desc);

create table public.events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  actor_type text not null,
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index events_workspace_created_idx
  on public.events (workspace_id, created_at desc);
create index events_entity_idx
  on public.events (workspace_id, entity_type, entity_id, created_at desc);
