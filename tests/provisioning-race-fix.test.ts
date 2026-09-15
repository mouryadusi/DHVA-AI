import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const sql = readFileSync(
  path.join(__dirname, "../supabase/migrations/0006_fix_provisioning_race_and_updated_at.sql"),
  "utf-8"
);

// Static regression test for a real concurrency bug: provision_starter_business
// used to be check-then-insert (SELECT EXISTS, then INSERT), which two
// concurrent calls (double-clicked "Create starter business now", or an
// RPC retried after an ambiguous timeout) could both pass before either
// commits — producing two businesses for one organization. Can't spin up
// true concurrent transactions in this offline test, so this confirms the
// actual fix mechanism (a real DB constraint + recovery, not just app-level
// caution) is present and hasn't been silently reverted.
describe("provisioning race-condition fix", () => {
  it("makes 'one org, one business' a real database constraint, not just an app-level check", () => {
    expect(sql).toMatch(/alter table businesses add constraint businesses_org_id_unique unique \(org_id\)/);
  });

  it("recovers from the constraint firing instead of erroring the caller", () => {
    expect(sql).toMatch(/exception when unique_violation then/);
    // The recovery path must return the winning row's id, not just swallow the error.
    expect(sql).toMatch(/select id into v_business_id from businesses where org_id = target_org_id/);
  });

  it("no longer relies on a check-then-insert pattern for the business row", () => {
    // The old (0003/0004) version had `if exists (select 1 from businesses...) then raise exception`
    // immediately before the insert. Confirm that check-then-act shape is gone from 0006's
    // definition of the function, not just that a constraint was added alongside it.
    expect(sql).not.toMatch(/if exists \(select 1 from businesses where org_id = target_org_id\) then/);
  });
});

describe("updated_at coverage on mutable Business Brain tables", () => {
  const mutableTables = ["products", "services", "faqs", "business_policies", "customers"];

  it.each(mutableTables)("table '%s' gained an updated_at column", (table: string) => {
    expect(sql).toMatch(new RegExp(`alter table ${table} add column updated_at timestamptz`));
  });

  it.each(mutableTables)("table '%s' has an updated_at trigger wired to set_updated_at()", (table: string) => {
    expect(sql).toMatch(new RegExp(`create trigger trg_${table}_updated_at before update on ${table}`));
  });
});
