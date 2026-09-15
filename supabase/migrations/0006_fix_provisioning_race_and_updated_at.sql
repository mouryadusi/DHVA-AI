-- Dhva AI — fix provisioning race condition
--
-- FINDING (from a fresh repository audit, not a hypothetical):
-- `provision_starter_business` (0003/0004) does `if exists (...) then raise
-- exception` followed by a separate `insert` — classic check-then-act. Two
-- concurrent invocations (e.g. a double-clicked "Create starter business
-- now" button, or the RPC being retried after an ambiguous timeout) can
-- both pass the existence check before either commits, producing two
-- businesses for one organization. Nothing in the schema prevented this —
-- `businesses.org_id` had no uniqueness constraint at all.
--
-- Fix: make the invariant ("one org, one business" — true for the MVP's
-- single-business-per-org model) a real database constraint, and make the
-- function handle the resulting unique_violation by returning the
-- already-provisioned business id instead of erroring. This turns
-- "check-then-act race" into "insert-and-recover," which is safe under
-- true concurrency in a way an application-level check never can be.

alter table businesses add constraint businesses_org_id_unique unique (org_id);

create or replace function provision_starter_business(target_org_id uuid, acting_user_id uuid default auth.uid())
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
begin
  if acting_user_id is null or not exists (
    select 1 from org_members where org_id = target_org_id and user_id = acting_user_id
  ) then
    raise exception 'not a member of this organization';
  end if;

  insert into businesses (org_id, name, slug, vertical, description, timezone, default_language)
  values (
    target_org_id,
    'Dhva Pizza',
    'dhva-pizza-' || substr(target_org_id::text, 1, 8),
    'food.pizza_restaurant',
    'Neighborhood pizza restaurant offering pickup, delivery, and dine-in. '
      || 'This is starter template data — edit or delete it from the Business page.',
    'America/New_York',
    'en'
  )
  returning id into v_business_id;

  insert into locations (business_id, name, address, is_primary)
  values (v_business_id, 'Dhva Pizza — Main St', '123 Main Street', true);

  insert into business_hours (business_id, day_of_week, open_time, close_time, is_closed) values
    (v_business_id, 0, '11:00', '23:00', false),
    (v_business_id, 1, '11:00', '23:00', false),
    (v_business_id, 2, '11:00', '23:00', false),
    (v_business_id, 3, '11:00', '23:00', false),
    (v_business_id, 4, '11:00', '23:00', false),
    (v_business_id, 5, '11:00', '23:30', false),
    (v_business_id, 6, '11:00', '23:30', false);

  insert into products (business_id, name, description, category, price_cents, sort_order) values
    (v_business_id, 'Margherita', 'Classic tomato, mozzarella, and basil.', 'pizza', 399, 1),
    (v_business_id, 'Pepperoni', 'Tomato, mozzarella, and pepperoni.', 'pizza', 499, 2),
    (v_business_id, 'Vegetarian', 'Bell peppers, onions, mushrooms, olives.', 'pizza', 449, 3),
    (v_business_id, 'Chicken Tikka', 'Tikka-spiced chicken, onions, cilantro.', 'pizza', 549, 4),
    (v_business_id, 'Garlic Bread', 'Fresh baked garlic bread.', 'sides', 199, 5),
    (v_business_id, 'Soft Drink', 'Choice of soda, 12oz can.', 'drinks', 79, 6);

  insert into faqs (business_id, question, answer, sort_order) values
    (v_business_id, 'Do you deliver?', 'Yes, we deliver within about 3 miles of the restaurant.', 1),
    (v_business_id, 'Do you have gluten-free options?', 'We do not currently offer a gluten-free crust.', 2),
    (v_business_id, 'Can I pay with a card on the phone?', 'We currently take payment at pickup or on delivery, not over the phone.', 3);

  insert into business_policies (business_id, policy_type, content) values
    (v_business_id, 'delivery_area', 'Delivery is available within approximately 3 miles of the Main Street location.'),
    (v_business_id, 'payment', 'Payment is collected at pickup or delivery — cash or card. We do not take card numbers over the phone.'),
    (v_business_id, 'cancellation', 'Orders can be cancelled within 5 minutes of placing them by calling back.');

  insert into agents (
    business_id, name, greeting, personality, language,
    llm_provider, llm_model, stt_provider, tts_provider,
    escalation_phone_number, is_active
  ) values (
    v_business_id, 'Dhva', 'Thanks for calling Dhva Pizza! What can I get started for you?',
    'Warm, upbeat, efficient — like a friendly pizza-place employee who knows the menu cold. Keeps responses short since this is a phone call, not a chat.',
    'en', 'anthropic', 'claude-sonnet-5', 'deepgram', 'cartesia', null, true
  );

  insert into audit_logs (org_id, user_id, action, entity_type, entity_id)
  values (target_org_id, acting_user_id, 'starter_business_provisioned', 'business', v_business_id);

  return v_business_id;

exception when unique_violation then
  -- Another concurrent call already provisioned this org's business
  -- (businesses_org_id_unique fired). This is the recovery path, not an
  -- error path: return the business that won the race instead of failing
  -- the caller. Idempotent by construction, not by hoping the check-then-act
  -- window never gets hit.
  select id into v_business_id from businesses where org_id = target_org_id;
  return v_business_id;
end;
$$;

grant execute on function provision_starter_business(uuid, uuid) to authenticated;

-- =========================================================================
-- Secondary finding: mutable Business Brain config tables have no
-- updated_at column at all (only organizations/businesses/agents do).
-- customers/products/services/faqs/business_policies/business_hours are
-- all editable via the dashboard (app/(dashboard)/dashboard/business,
-- .../agent) but a caller/integration has no way to tell "is this data
-- stale" without one. Added where it's actually load-bearing: the tables
-- an org owner edits directly. Not added to append-only event tables
-- (calls, call_messages, tool_executions, audit_logs) — those are
-- immutable by design and don't need it.
-- =========================================================================

alter table products add column updated_at timestamptz not null default now();
alter table services add column updated_at timestamptz not null default now();
alter table faqs add column updated_at timestamptz not null default now();
alter table business_policies add column updated_at timestamptz not null default now();
alter table customers add column updated_at timestamptz not null default now();

create trigger trg_products_updated_at before update on products
  for each row execute function set_updated_at();
create trigger trg_services_updated_at before update on services
  for each row execute function set_updated_at();
create trigger trg_faqs_updated_at before update on faqs
  for each row execute function set_updated_at();
create trigger trg_business_policies_updated_at before update on business_policies
  for each row execute function set_updated_at();
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();
