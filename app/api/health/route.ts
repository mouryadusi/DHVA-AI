import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/health — for the dashboard's own diagnostics and for uptime
 * monitoring once deployed. Deliberately does NOT report the LiveKit
 * project's health or the agent worker's status — this route runs inside
 * the Next.js app's request/response lifecycle and has no visibility into
 * a separate long-lived process. Agent worker health is observed via its
 * own process logs / platform health checks (Railway/Fly/Render), not here.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  checks.env_supabase_url = {
    ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  };
  checks.env_supabase_anon_key = {
    ok: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
  checks.env_livekit = {
    ok: Boolean(
      process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.NEXT_PUBLIC_LIVEKIT_URL
    ),
  };

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("organizations").select("id").limit(1);
    checks.supabase_query = { ok: !error, detail: error?.message };
  } catch (err) {
    checks.supabase_query = { ok: false, detail: err instanceof Error ? err.message : "unknown error" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json({ ok: allOk, checks, timestamp: new Date().toISOString() }, { status: allOk ? 200 : 503 });
}
