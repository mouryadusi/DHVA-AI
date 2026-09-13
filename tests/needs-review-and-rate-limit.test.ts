import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const sql = readFileSync(
  path.join(__dirname, "../supabase/migrations/0005_review_and_rate_limit.sql"),
  "utf-8"
);

describe("needs_review flagging + token rate limiting migration", () => {
  it("adds needs_review and review_reason columns to calls", () => {
    expect(sql).toMatch(/alter table calls add column needs_review boolean/);
    expect(sql).toMatch(/alter table calls add column review_reason text/);
  });

  it("creates the rate-limit table with RLS enabled and no client policies", () => {
    expect(sql).toMatch(/create table token_mint_events/);
    expect(sql).toMatch(/alter table token_mint_events enable row level security/);
    // Deliberately no "create policy ... on token_mint_events" anywhere —
    // access is only through the SECURITY DEFINER function below.
    expect(sql).not.toMatch(/create policy .* on token_mint_events/);
  });

  it("the rate-limit function is SECURITY DEFINER and checks auth.uid()", () => {
    expect(sql).toMatch(/create or replace function check_and_record_token_mint/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/v_user_id uuid := auth\.uid\(\)/);
  });
});
