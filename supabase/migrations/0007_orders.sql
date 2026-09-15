-- Dhva AI — persisted orders
--
-- FINDING (fresh repository audit): `calculate_order` (agent/src/tools/order.py)
-- only ever computed a total and returned it to the LLM — nothing was ever
-- written to the database representing the order itself. A call could be
-- classified outcome='order_placed' (agent/src/outcome.py) while the
-- business had zero durable record of what was actually ordered. This
-- directly contradicts the product's own standard: "never claim an action
-- succeeded unless the tool confirms it" — there was no real confirmation
-- to check, and no way for a business owner to act on the order afterward.
--
-- Fix: a real `orders`/`order_items` pair, written by a new `place_order`
-- tool that's distinct from `calculate_order` (kept as a pure preview —
-- no side effects, still used for quoting a price before commitment).
-- `place_order` re-validates against current menu prices server-side
-- rather than trusting a total the LLM claims to have already confirmed.

create table orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  call_id uuid references calls(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  fulfillment_type text not null default 'pickup' check (fulfillment_type in ('pickup', 'delivery')),
  status text not null default 'received'
    check (status in ('received', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled')),
  total_cents integer not null check (total_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  -- Snapshot the name/price at order time deliberately — if the business
  -- later renames or reprices the product, historical orders must still
  -- show what the customer actually agreed to, not today's catalog.
  product_name text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  line_total_cents integer not null check (line_total_cents >= 0)
);

create index idx_orders_business on orders(business_id);
create index idx_orders_call on orders(call_id);
create index idx_orders_customer on orders(customer_id);
create index idx_order_items_order on order_items(order_id);

alter table orders enable row level security;
alter table order_items enable row level security;

create policy "members can view orders" on orders
  for select using (is_business_member(business_id));
create policy "admins can manage orders" on orders
  for all using (is_business_member(business_id));
-- Orders are written by the agent worker via service_role (same pattern
-- as calls/tool_executions) — dashboard users get update access too,
-- unlike calls, because a business owner marking an order "preparing" /
-- "completed" is a real, expected workflow action, not a data-integrity risk.

create policy "members can view order_items" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_id and is_business_member(o.business_id))
  );
create policy "admins can manage order_items" on order_items
  for all using (
    exists (select 1 from orders o where o.id = order_id and is_business_member(o.business_id))
  );

create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();
