-- Dhva AI — Row Level Security
--
-- Tenant boundary: a user can only see data for businesses belonging to
-- organizations they're a member of (org_members). The agent worker (the
-- Python LiveKit process) bypasses RLS entirely via the service_role key —
-- it is a trusted backend service, not a browser client, and needs to read/
-- write across tenants by design (it serves every business's calls).
--
-- Every dashboard-facing table gets RLS. The service_role key must NEVER be
-- exposed to the browser or committed to source control (see .env.example).

alter table organizations enable row level security;
alter table org_members enable row level security;
alter table businesses enable row level security;
alter table locations enable row level security;
alter table phone_numbers enable row level security;
alter table agents enable row level security;
alter table business_hours enable row level security;
alter table services enable row level security;
alter table products enable row level security;
alter table faqs enable row level security;
alter table business_policies enable row level security;
alter table customers enable row level security;
alter table calls enable row level security;
alter table call_messages enable row level security;
alter table call_summaries enable row level security;
alter table tool_executions enable row level security;
alter table integrations enable row level security;
alter table audit_logs enable row level security;

-- Helper: is the current authenticated user a member of this org?
create or replace function is_org_member(check_org_id uuid)
returns boolean as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$ language sql security definer stable;

-- Helper: is the current authenticated user a member of the org that owns this business?
create or replace function is_business_member(check_business_id uuid)
returns boolean as $$
  select exists (
    select 1 from businesses b
    join org_members om on om.org_id = b.org_id
    where b.id = check_business_id and om.user_id = auth.uid()
  );
$$ language sql security definer stable;

-- organizations: members can read; only owners can update
create policy "org members can view their org" on organizations
  for select using (is_org_member(id));

create policy "org owners can update their org" on organizations
  for update using (
    exists (select 1 from org_members where org_id = id and user_id = auth.uid() and role = 'owner')
  );

-- org_members: members can see the roster of their own org
create policy "org members can view roster" on org_members
  for select using (is_org_member(org_id));

-- businesses
create policy "members can view their businesses" on businesses
  for select using (is_org_member(org_id));

create policy "admins can manage their businesses" on businesses
  for all using (
    exists (
      select 1 from org_members
      where org_id = businesses.org_id and user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- generic pattern for all business-scoped child tables
create policy "members can view locations" on locations
  for select using (is_business_member(business_id));
create policy "admins can manage locations" on locations
  for all using (is_business_member(business_id));

create policy "members can view phone numbers" on phone_numbers
  for select using (is_business_member(business_id));
create policy "admins can manage phone numbers" on phone_numbers
  for all using (is_business_member(business_id));

create policy "members can view agents" on agents
  for select using (is_business_member(business_id));
create policy "admins can manage agents" on agents
  for all using (is_business_member(business_id));

create policy "members can view business_hours" on business_hours
  for select using (is_business_member(business_id));
create policy "admins can manage business_hours" on business_hours
  for all using (is_business_member(business_id));

create policy "members can view services" on services
  for select using (is_business_member(business_id));
create policy "admins can manage services" on services
  for all using (is_business_member(business_id));

create policy "members can view products" on products
  for select using (is_business_member(business_id));
create policy "admins can manage products" on products
  for all using (is_business_member(business_id));

create policy "members can view faqs" on faqs
  for select using (is_business_member(business_id));
create policy "admins can manage faqs" on faqs
  for all using (is_business_member(business_id));

create policy "members can view policies" on business_policies
  for select using (is_business_member(business_id));
create policy "admins can manage policies" on business_policies
  for all using (is_business_member(business_id));

create policy "members can view customers" on customers
  for select using (is_business_member(business_id));
create policy "admins can manage customers" on customers
  for all using (is_business_member(business_id));

create policy "members can view calls" on calls
  for select using (is_business_member(business_id));
-- Calls are written exclusively by the agent worker via service_role;
-- dashboard users are read-only here on purpose (no policy for insert/update/delete).

create policy "members can view call_messages" on call_messages
  for select using (
    exists (select 1 from calls c where c.id = call_id and is_business_member(c.business_id))
  );

create policy "members can view call_summaries" on call_summaries
  for select using (
    exists (select 1 from calls c where c.id = call_id and is_business_member(c.business_id))
  );

create policy "members can view tool_executions" on tool_executions
  for select using (
    exists (select 1 from calls c where c.id = call_id and is_business_member(c.business_id))
  );

create policy "members can view integrations" on integrations
  for select using (is_business_member(business_id));
create policy "admins can manage integrations" on integrations
  for all using (is_business_member(business_id));

create policy "members can view audit_logs" on audit_logs
  for select using (is_org_member(org_id));
