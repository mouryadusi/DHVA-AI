import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const sql = readFileSync(path.join(__dirname, "../supabase/migrations/0007_orders.sql"), "utf-8");

describe("orders migration", () => {
  it("creates orders and order_items with RLS enabled", () => {
    expect(sql).toMatch(/create table orders/);
    expect(sql).toMatch(/create table order_items/);
    expect(sql).toMatch(/alter table orders enable row level security/);
    expect(sql).toMatch(/alter table order_items enable row level security/);
  });

  it("scopes both tables to tenant membership, not just business_id equality", () => {
    // order_items has no business_id column directly — its policy must
    // join through orders to is_business_member(), not trust a client-
    // supplied business_id.
    expect(sql).toMatch(/create policy "members can view orders" on orders\s+for select using \(is_business_member\(business_id\)\)/);
    expect(sql).toMatch(/exists \(select 1 from orders o where o\.id = order_id and is_business_member\(o\.business_id\)\)/);
  });

  it("snapshots product name/price on the line item rather than trusting live product data", () => {
    // Deliberately NOT a foreign-key-only reference — see the migration's
    // own comment on why historical orders must survive a later price change.
    expect(sql).toMatch(/product_name text not null/);
    expect(sql).toMatch(/unit_price_cents integer not null/);
  });

  it("business owners can update order status (unlike calls, which are read-only from the dashboard)", () => {
    expect(sql).toMatch(/create policy "admins can manage orders" on orders\s+for all using \(is_business_member\(business_id\)\)/);
  });

  it("has an updated_at trigger so status changes are timestamped", () => {
    expect(sql).toMatch(/create trigger trg_orders_updated_at before update on orders/);
  });
});
