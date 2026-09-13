-- Dhva AI — core schema
-- Multi-tenant: organizations own businesses; businesses own everything else.

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- =========================================================================
-- ORGANIZATIONS & MEMBERSHIP
-- =========================================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auth.users is managed by Supabase Auth. org_members links auth users to orgs.
create table org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index idx_org_members_user on org_members(user_id);

-- =========================================================================
-- BUSINESSES (the tenant boundary for everything below)
-- =========================================================================

create table businesses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  slug text not null unique,
  vertical text not null default 'general', -- e.g. 'food.pizza', 'home_services.plumbing'
  description text,
  timezone text not null default 'UTC',
  default_language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_businesses_org on businesses(org_id);
create unique index idx_businesses_slug on businesses(slug);

create table locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_locations_business on locations(business_id);

-- =========================================================================
-- TELEPHONY
-- =========================================================================

create table phone_numbers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  e164_number text not null unique,
  provider text not null default 'telnyx' check (provider in ('telnyx', 'twilio')),
  livekit_trunk_id text, -- LiveKit inbound trunk ID this number is bound to
  livekit_dispatch_rule_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  created_at timestamptz not null default now()
);

create index idx_phone_numbers_business on phone_numbers(business_id);

-- =========================================================================
-- AI AGENT CONFIG (one active config per business; versioned by row)
-- =========================================================================

create table agents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null default 'Dhva',
  greeting text not null default 'Thanks for calling, how can I help you today?',
  personality text not null default 'Warm, direct, efficient. Sounds like a competent front-desk employee.',
  language text not null default 'en',
  llm_provider text not null default 'anthropic' check (llm_provider in ('anthropic', 'openai')),
  llm_model text not null default 'claude-sonnet-5',
  stt_provider text not null default 'deepgram',
  tts_provider text not null default 'cartesia' check (tts_provider in ('cartesia', 'elevenlabs')),
  tts_voice_id text,
  escalation_phone_number text, -- where human handoff transfers to
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_agents_business on agents(business_id);
create unique index idx_agents_one_active_per_business on agents(business_id) where is_active;

-- =========================================================================
-- BUSINESS BRAIN CONTENT
-- =========================================================================

create table business_hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6), -- 0 = Sunday
  open_time time,
  close_time time,
  is_closed boolean not null default false,
  unique (business_id, day_of_week)
);

create table services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer,
  price_cents integer, -- nullable: "price on request" services
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_services_business on services(business_id);

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  category text, -- e.g. 'pizza', 'sides', 'drinks'
  price_cents integer not null,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_products_business on products(business_id);

create table faqs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_faqs_business on faqs(business_id);

create table business_policies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  policy_type text not null, -- e.g. 'cancellation', 'delivery_area', 'payment'
  content text not null,
  created_at timestamptz not null default now()
);

create index idx_policies_business on business_policies(business_id);

-- =========================================================================
-- CUSTOMERS
-- =========================================================================

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  phone_number text not null,
  name text,
  email text,
  notes text,
  created_at timestamptz not null default now(),
  last_contact_at timestamptz
);

create index idx_customers_business on customers(business_id);
create unique index idx_customers_business_phone on customers(business_id, phone_number);

-- =========================================================================
-- CALLS
-- =========================================================================

create table calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  livekit_room_name text,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  from_number text,
  to_number text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed', 'no_answer')),
  outcome text
    check (outcome in ('booked', 'order_placed', 'message_taken', 'transferred', 'answered_faq', 'abandoned', null)),
  transferred boolean not null default false,
  transfer_reason text,
  recording_consent boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_calls_business on calls(business_id);
create index idx_calls_customer on calls(customer_id);
create index idx_calls_started_at on calls(started_at desc);

create table call_messages (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  sequence integer not null,
  created_at timestamptz not null default now()
);

create index idx_call_messages_call on call_messages(call_id, sequence);

create table call_summaries (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade unique,
  summary_text text not null,
  opportunity_saved boolean not null default false, -- feeds the "Customer Opportunities Saved" metric
  created_at timestamptz not null default now()
);

create table tool_executions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  tool_name text not null,
  input_json jsonb not null default '{}',
  output_json jsonb,
  success boolean not null,
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index idx_tool_executions_call on tool_executions(call_id);

-- =========================================================================
-- INTEGRATIONS & AUDIT
-- =========================================================================

create table integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null, -- 'telnyx', 'deepgram', 'cartesia', 'elevenlabs', 'anthropic', 'openai'
  config_json jsonb not null default '{}', -- non-secret config only; keys live in env/secret manager
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  created_at timestamptz not null default now()
);

create index idx_integrations_business on integrations(business_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index idx_audit_logs_org on audit_logs(org_id, created_at desc);

-- =========================================================================
-- updated_at trigger helper
-- =========================================================================

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_organizations_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger trg_businesses_updated_at before update on businesses
  for each row execute function set_updated_at();
create trigger trg_agents_updated_at before update on agents
  for each row execute function set_updated_at();
