-- Dhva AI — seed data: "Dhva Pizza" demo tenant
--
-- SUPERSEDED FOR THE NORMAL SIGNUP FLOW: as of
-- supabase/migrations/0003_fix_onboarding.sql, every new signup gets this
-- exact same starter business auto-provisioned atomically via a DB
-- trigger the moment their org gets its first owner. You do NOT need to
-- run this file after signing up through the app — see README "Database
-- setup" for the current (simpler) flow.
--
-- This file remains useful for: CI/test fixtures, resetting demo data
-- without going through signup, or seeding a business into an org created
-- some other way. It is deliberately just data, not code — the
-- application itself has zero knowledge of "Dhva Pizza."
--
-- Run: supabase db execute -f supabase/seed.sql  (or `npm run db:seed`).
--
-- NOTE: this creates a brand-new orphan organization with no members —
-- you must add yourself to it manually afterward (insert into org_members)
-- or use the dashboard's "Create starter business now" recovery action
-- instead, which provisions into an org you already belong to.

do $$
declare
  v_org_id uuid;
  v_business_id uuid;
begin
  insert into organizations (name) values ('Dhva Demo Org')
  returning id into v_org_id;

  insert into businesses (org_id, name, slug, vertical, description, timezone, default_language)
  values (
    v_org_id,
    'Dhva Pizza',
    'dhva-pizza',
    'food.pizza_restaurant',
    'Neighborhood pizza restaurant offering pickup, delivery, and dine-in.',
    'America/New_York',
    'en'
  )
  returning id into v_business_id;

  insert into locations (business_id, name, address, is_primary)
  values (v_business_id, 'Dhva Pizza — Main St', '123 Main Street', true);

  -- Business hours: Mon-Thu/Sun 11:00-23:00, Fri-Sat 11:00-23:30
  insert into business_hours (business_id, day_of_week, open_time, close_time, is_closed) values
    (v_business_id, 0, '11:00', '23:00', false), -- Sunday
    (v_business_id, 1, '11:00', '23:00', false), -- Monday
    (v_business_id, 2, '11:00', '23:00', false), -- Tuesday
    (v_business_id, 3, '11:00', '23:00', false), -- Wednesday
    (v_business_id, 4, '11:00', '23:00', false), -- Thursday
    (v_business_id, 5, '11:00', '23:30', false), -- Friday
    (v_business_id, 6, '11:00', '23:30', false); -- Saturday

  -- Menu (products). Prices in cents.
  insert into products (business_id, name, description, category, price_cents, sort_order) values
    (v_business_id, 'Margherita', 'Classic tomato, mozzarella, and basil.', 'pizza', 399, 1),
    (v_business_id, 'Pepperoni', 'Tomato, mozzarella, and pepperoni.', 'pizza', 499, 2),
    (v_business_id, 'Vegetarian', 'Bell peppers, onions, mushrooms, olives.', 'pizza', 449, 3),
    (v_business_id, 'Chicken Tikka', 'Tikka-spiced chicken, onions, cilantro.', 'pizza', 549, 4),
    (v_business_id, 'Garlic Bread', 'Fresh baked garlic bread.', 'sides', 199, 5),
    (v_business_id, 'Soft Drink', 'Choice of soda, 12oz can.', 'drinks', 79, 6);

  -- FAQs
  insert into faqs (business_id, question, answer, sort_order) values
    (v_business_id, 'Do you deliver?', 'Yes, we deliver within about 3 miles of the restaurant.', 1),
    (v_business_id, 'Do you have gluten-free options?', 'We do not currently offer a gluten-free crust.', 2),
    (v_business_id, 'Can I pay with a card on the phone?', 'We currently take payment at pickup or on delivery, not over the phone.', 3);

  -- Policies
  insert into business_policies (business_id, policy_type, content) values
    (v_business_id, 'delivery_area', 'Delivery is available within approximately 3 miles of the Main Street location.'),
    (v_business_id, 'payment', 'Payment is collected at pickup or delivery — cash or card. We do not take card numbers over the phone.'),
    (v_business_id, 'cancellation', 'Orders can be cancelled within 5 minutes of placing them by calling back.');

  -- AI agent config
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
    '+15555550123', -- placeholder human transfer number — replace with a real number before testing handoff
    true
  );

  raise notice 'Seeded org % / business % (Dhva Pizza)', v_org_id, v_business_id;
end $$;
