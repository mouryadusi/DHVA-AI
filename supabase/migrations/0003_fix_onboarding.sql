-- Dhva AI — fix onboarding: missing INSERT policies + atomic business provisioning
--
-- ROOT CAUSE of "No business found for your organization": `organizations`
-- and `org_members` had RLS enabled (0002_rls.sql) but NO INSERT policy.
-- Postgres RLS defaults to deny-all, so the signup flow's
-- `supabase.from("organizations").insert(...)` was rejected before a
-- business could ever exist — this was never just a "seed data isn't
-- linked" problem, it was a genuine RLS gap.
--
-- Fix has two parts:
--   1. Add the missing INSERT policies (narrowly scoped — see below).
--   2. Move business provisioning out of client-side sequential JS calls
--      (fragile: org succeeds, business insert fails on a network blip,
--      user is left with an orphan org) into a single atomic DB trigger
--      that fires the instant an org gets its first owner. This is also
--      what "database-driven, not hardcoded" actually means in practice:
--      the template business lives in a SQL function as data, not as a
--      branch in application code.

-- =========================================================================
-- 1. Missing INSERT policies
-- =========================================================================

create policy "authenticated users can create an organization" on organizations
  for insert with check (auth.uid() is not null);

-- Bootstrap-only self-insert: a user may add themselves as the first
-- ('owner') member of an org, but cannot insert a membership row for an
-- org that already has members (that would be an invite flow — not
-- implemented yet; needs a service-role-backed API route later, not a
-- direct client insert, to avoid letting any user grant themselves access
-- to an arbitrary existing org).
create policy "users can self-bootstrap as org owner" on org_members
  for insert with check (
    user_id = auth.uid()
    and role = 'owner'
    and not exists (select 1 from org_members existing where existing.org_id = org_members.org_id)
  );

-- =========================================================================
-- 2. Atomic starter-business provisioning
-- =========================================================================

-- SECURITY DEFINER is safe here specifically because this function takes
-- no user-supplied content — every value inserted is a static template
-- literal below, not caller input. It still checks org membership
-- explicitly (not just relying on being SECURITY DEFINER) because it's
-- also exposed as a directly-callable RPC (see the dashboard's
-- "create starter business" empty-state action), not only invoked via the
-- trigger.
create or replace function provision_starter_business(target_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
begin
  if not exists (
    select 1 from org_members where org_id = target_org_id and user_id = auth.uid()
  ) then
    raise exception 'not a member of this organization';
  end if;

  if exists (select 1 from businesses where org_id = target_org_id) then
    raise exception 'organization already has a business — provisioning is one-time only';
  end if;

  insert into businesses (org_id, name, slug, vertical, description, timezone, default_language)
  values (
    target_org_id,
    'Dhva Pizza',
    'dhva-pizza-' || substr(target_org_id::text, 1, 8), -- unique per org; slug isn't user-facing yet
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

  -- escalation_phone_number is intentionally left null — this is "Phone 2"
  -- and MUST be a real number the org owner configures themselves
  -- (dashboard AI Agent page) before human transfer can work. Shipping a
  -- placeholder number here would silently "succeed" a transfer to a
  -- number nobody's answering, which is worse than failing loudly.
  insert into agents (
    business_id, name, greeting, personality, language,
    llm_provider, llm_model, stt_provider, tts_provider,
    escalation_phone_number, is_active
  ) values (
    v_business_id,
    'Dhva',
    'Thanks for calling Dhva Pizza! What can I get started for you?',
    'Warm, upbeat, efficient — like a friendly pizza-place employee who knows the menu cold. Keeps responses short since this is a phone call, not a chat.',
    'en',
    'anthropic',
    'claude-sonnet-5',
    'deepgram',
    'cartesia',
    null,
    true
  );

  insert into audit_logs (org_id, user_id, action, entity_type, entity_id)
  values (target_org_id, auth.uid(), 'starter_business_provisioned', 'business', v_business_id);

  return v_business_id;
end;
$$;

grant execute on function provision_starter_business(uuid) to authenticated;

-- Fires once per org: the moment it gets its first ('owner') member, i.e.
-- right after a fresh signup's org_members insert succeeds.
create or replace function trg_auto_provision_starter_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'owner'
     and (select count(*) from org_members where org_id = new.org_id) = 1
  then
    perform provision_starter_business(new.org_id);
  end if;
  return new;
end;
$$;

create trigger trg_org_members_auto_provision
  after insert on org_members
  for each row execute function trg_auto_provision_starter_business();
