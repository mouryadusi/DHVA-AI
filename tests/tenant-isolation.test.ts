import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// This can't spin up a real Postgres instance in CI without network/db access,
// so it's a static safety net instead: every table created in the init
// migration that isn't a pure system table must both (a) have RLS enabled
// and (b) have at least one policy defined in the RLS migration. This catches
// "I added a table and forgot to secure it" before it ships.

const initSql = readFileSync(path.join(__dirname, "../supabase/migrations/0001_init.sql"), "utf-8");
const rlsSql = readFileSync(path.join(__dirname, "../supabase/migrations/0002_rls.sql"), "utf-8");

function extractTableNames(sql: string): string[] {
  const matches = [...sql.matchAll(/create table (\w+) \(/g)];
  return matches.map((m) => m[1]);
}

describe("tenant isolation coverage", () => {
  const tables = extractTableNames(initSql);

  it("found the expected set of tenant tables in the schema", () => {
    expect(tables).toEqual(
      expect.arrayContaining([
        "organizations",
        "businesses",
        "calls",
        "customers",
        "products",
        "services",
      ])
    );
  });

  it.each(tables)("table '%s' has row level security enabled", (table: string) => {
    expect(rlsSql).toMatch(new RegExp(`alter table ${table} enable row level security`));
  });

  it.each(tables)("table '%s' has at least one RLS policy defined", (table: string) => {
    expect(rlsSql).toMatch(new RegExp(`on ${table}\\b`));
  });
});
