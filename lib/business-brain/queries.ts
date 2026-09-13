import { createClient } from "@/lib/supabase/server";

/**
 * Fetches everything the dashboard's "Business" and "AI Agent" pages need.
 * This is the TypeScript-side read path; the agent worker (Python, in
 * agent/src/business_brain.py) fetches the same data independently via the
 * Supabase service_role key at call time — they're not sharing a process,
 * only a database and a schema.
 */
export async function getBusinessBrain(businessId: string) {
  const supabase = await createClient();

  const [business, hours, services, products, faqs, policies, agent] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).single(),
    supabase.from("business_hours").select("*").eq("business_id", businessId).order("day_of_week"),
    supabase.from("services").select("*").eq("business_id", businessId).eq("is_active", true),
    supabase
      .from("products")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_available", true)
      .order("sort_order"),
    supabase.from("faqs").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("business_policies").select("*").eq("business_id", businessId),
    supabase.from("agents").select("*").eq("business_id", businessId).eq("is_active", true).maybeSingle(),
  ]);

  return {
    business: business.data,
    hours: hours.data ?? [],
    services: services.data ?? [],
    products: products.data ?? [],
    faqs: faqs.data ?? [],
    policies: policies.data ?? [],
    agent: agent.data,
  };
}

/** First business belonging to the current user's org — used for the MVP's single-tenant dashboard. */
export async function getDefaultBusinessId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

/**
 * The org a user belongs to but has no business yet — should only ever be
 * non-null for accounts created before supabase/migrations/0003_fix_onboarding.sql
 * (which auto-provisions a starter business atomically on signup going
 * forward). Used to power the dashboard's one-time recovery action.
 */
export async function getOrphanedOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("org_members").select("org_id");
  if (!memberships || memberships.length === 0) return null;

  for (const m of memberships) {
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("org_id", m.org_id)
      .limit(1)
      .maybeSingle();
    if (!business) return m.org_id;
  }
  return null;
}
