-- Dhva AI — fix "No organization found for your account"
--
-- ROOT CAUSE: the client-side signup flow (app/signup/page.tsx) inserted
-- into `organizations` immediately after calling supabase.auth.signUp().
-- If the Supabase project requires email confirmation (Supabase's own
-- default for new projects), signUp() returns a user but NO active
-- session — auth.uid() is null in that state. The organizations INSERT
-- policy (0003_fix_onboarding.sql) correctly requires auth.uid() is not
-- null, so the insert was silently rejected. The user then confirms their
-- email, logs in with a real session, and lands on a dashboard for an
-- account that was never actually given an organization at all — hence
-- "No organization found for your account."
--
-- FIX: move provisioning into a trigger on `auth.users` itself. This runs
-- as SECURITY DEFINER at the moment Postgres creates the user row, which
-- happens regardless of email-confirmation status and regardless of
-- whether the client has an active session. This is the standard,
-- officially-recommended Supabase pattern for "do something automatically
-- when a user signs up" (Supabase's own docs use this exact trigger shape
-- for auto-creating profile rows).

-- provision_starter_business needs to be callable with an explicit acting
-- user id (not just auth.uid()), because when invoked from the auth.users
-- trigger below, there is no request-scoped JWT and auth.uid() is null.
-- Drop and recreate with the new signature — CREATE OR REPLACE cannot
-- change a function's argument list.
drop function if exists provision_starter_business(uuid);

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

  if exists (select 1 from businesses where org_id = target_org_id) then
    raise exception 'organization already has a business — provisioning is one-time only';
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
    v_business_id,
    'Dhva',
    'Thanks for calling Dhva Pizza! What can I get started for you?',
    'Warm, upbeat, efficient — like a friendly pizza-place employee who knows the menu cold. Keeps responses short since this is a phone call, not a chat.',
    'en',
    'anthropic',
    'claude-sonnet-5',
    'deepgram',
    'cartesia',
    null, -- "Phone 2" must be configured explicitly by the org owner
    true
  );

  insert into audit_logs (org_id, user_id, action, entity_type, entity_id)
  values (target_org_id, acting_user_id, 'starter_business_provisioned', 'business', v_business_id);

  return v_business_id;
end;
$$;

grant execute on function provision_starter_business(uuid, uuid) to authenticated;

-- Update the org_members trigger to pass the explicit user id through
-- (rather than relying on auth.uid(), which won't be set when this fires
-- as a side effect of the auth.users trigger below).
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
    perform provision_starter_business(new.org_id, new.user_id);
  end if;
  return new;
end;
$$;
-- trigger trg_org_members_auto_provision already points at this function
-- name from 0003 — CREATE OR REPLACE above is sufficient, no need to
-- recreate the trigger itself.

-- =========================================================================
-- The actual fix: provision on auth.users insert, not on client-side
-- organizations insert.
-- =========================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_name text;
begin
  v_org_name := coalesce(
    nullif(new.raw_user_meta_data->>'org_name', ''),
    split_part(new.email, '@', 1) || '''s Organization'
  );

  insert into organizations (name) values (v_org_name) returning id into v_org_id;
  insert into org_members (org_id, user_id, role) values (v_org_id, new.id, 'owner');
  -- The insert above fires trg_org_members_auto_provision automatically,
  -- which provisions the starter business — one signup, one DB
  -- transaction, atomic, no client-side follow-up calls required.

  return new;
exception when others then
  -- Onboarding provisioning must NEVER block user creation itself — a
  -- user account that failed to sign up at all is a worse outcome than
  -- one that signed up but needs the dashboard's "Create starter business
  -- now" recovery action. Logged as a Postgres warning for investigation.
  raise warning 'handle_new_user failed for user %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- =========================================================================
-- One-time backfill for accounts created before this migration
-- =========================================================================

do $$
declare
  u record;
  v_org_id uuid;
  v_org_name text;
begin
  for u in
    select au.id, au.email
    from auth.users au
    left join org_members om on om.user_id = au.id
    where om.user_id is null
  loop
    v_org_name := split_part(u.email, '@', 1) || '''s Organization';
    insert into organizations (name) values (v_org_name) returning id into v_org_id;
    insert into org_members (org_id, user_id, role) values (v_org_id, u.id, 'owner');
    -- fires trg_org_members_auto_provision same as the trigger path above
    raise notice 'Backfilled organization % for existing user %', v_org_id, u.email;
  end loop;
end $$;
