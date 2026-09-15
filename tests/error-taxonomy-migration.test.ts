import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const sql = readFileSync(
  path.join(__dirname, "../supabase/migrations/0007_error_taxonomy.sql"),
  "utf-8"
);

describe("error taxonomy migration", () => {
  it("adds a constrained error_category column matching the 14-value taxonomy", () => {
    expect(sql).toMatch(/alter table tool_executions add column error_category text/);
    const categories = [
      "AUTH_ERROR", "AUTHORIZATION_ERROR", "TENANT_ACCESS_DENIED", "ONBOARDING_ERROR",
      "DATABASE_ERROR", "VALIDATION_ERROR", "LLM_TIMEOUT", "LLM_PROVIDER_ERROR",
      "TOOL_ERROR", "STT_ERROR", "TTS_ERROR", "TELEPHONY_ERROR", "LIVEKIT_ERROR",
      "INTEGRATION_ERROR",
    ];
    for (const category of categories) {
      expect(sql).toContain(`'${category}'`);
    }
  });

  it("adds the consistency constraint as NOT VALID so it can't break on existing data", () => {
    // This is the specific production-safety property: a naive
    // `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` validates every
    // existing row and fails the whole migration if any violate it. NOT
    // VALID is what makes this migration safe to run against a table that
    // may already have failed tool_executions rows without a category.
    expect(sql).toMatch(/add constraint tool_executions_error_category_only_on_failure[\s\S]*not valid/);
  });

  it("indexes error_category for real failure-rate queries", () => {
    expect(sql).toMatch(/create index idx_tool_executions_error_category on tool_executions\(error_category\)/);
  });
});
