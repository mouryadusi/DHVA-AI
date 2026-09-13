import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

// Can't spin up real Postgres/auth here, so this is a static safety net:
// confirms the specific pieces that fix "No organization found for your
// account" (docs/TROUBLESHOOTING.md) are actually present in the migration
// files, so a future edit can't silently regress the fix. Actually
// exercising the trigger requires a real Supabase project — see
// docs/PHONE_TEST.md's prerequisites and CLAUDE.md's VERIFIED framework.

const migrationsDir = path.join(__dirname, "../supabase/migrations");
const allMigrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationsDir, f), "utf-8"))
  .join("\n");

describe("signup provisioning chain", () => {
  it("has a trigger on auth.users that runs regardless of session state", () => {
    expect(allMigrations).toMatch(/after insert on auth\.users/);
    expect(allMigrations).toMatch(/create trigger on_auth_user_created/);
  });

  it("handle_new_user creates both an organization and an org_members row", () => {
    expect(allMigrations).toMatch(/insert into organizations/);
    expect(allMigrations).toMatch(/insert into org_members \(org_id, user_id, role\)/);
  });

  it("handle_new_user never blocks user creation on provisioning failure", () => {
    expect(allMigrations).toMatch(/exception when others then/);
  });

  it("org_members insert triggers starter business provisioning", () => {
    expect(allMigrations).toMatch(/after insert on org_members/);
    expect(allMigrations).toMatch(/perform provision_starter_business/);
  });

  it("provision_starter_business accepts an explicit acting user (not just auth.uid())", () => {
    // This is the specific fix that makes provisioning work when invoked
    // from a trigger context where auth.uid() is null — see
    // 0004_fix_signup_trigger.sql's header comment.
    expect(allMigrations).toMatch(/acting_user_id uuid default auth\.uid\(\)/);
  });

  it("includes a one-time backfill for pre-existing orphaned accounts", () => {
    expect(allMigrations).toMatch(/left join org_members om on om\.user_id = au\.id/);
  });

  it("organizations and org_members have INSERT policies (the original root cause)", () => {
    expect(allMigrations).toMatch(/create policy "authenticated users can create an organization" on organizations\s+for insert/);
    expect(allMigrations).toMatch(/create policy "users can self-bootstrap as org owner" on org_members\s+for insert/);
  });
});
