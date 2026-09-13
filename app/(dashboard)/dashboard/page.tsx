import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId } from "@/lib/business-brain/queries";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-5">
      <p className="text-xs uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export default async function OverviewPage() {
  const businessId = await getDefaultBusinessId();

  if (!businessId) {
    return <h1 className="text-xl font-semibold">Overview</h1>;
  }

  const supabase = await createClient();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { data: todaysCalls } = await supabase
    .from("calls")
    .select("*")
    .eq("business_id", businessId)
    .gte("started_at", startOfToday.toISOString());

  const calls = todaysCalls ?? [];
  const callsToday = calls.length;
  const callsAnswered = calls.filter((c) => c.status === "completed").length;
  const callsTransferred = calls.filter((c) => c.transferred).length;
  const messagesTaken = calls.filter((c) => c.outcome === "message_taken").length;

  const { data: summaries } = await supabase
    .from("call_summaries")
    .select("opportunity_saved, call_id, calls!inner(business_id, started_at)")
    .eq("calls.business_id", businessId)
    .gte("calls.started_at", startOfToday.toISOString());

  const opportunitiesSaved = (summaries ?? []).filter((s) => s.opportunity_saved).length;

  const { count: needsReviewCount } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("needs_review", true);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Overview</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Calls today" value={callsToday} />
        <StatCard label="Answered" value={callsAnswered} />
        <StatCard label="Transferred" value={callsTransferred} />
        <StatCard label="Messages taken" value={messagesTaken} />
        <StatCard label="Opportunities saved" value={opportunitiesSaved} />
        <StatCard label="Needs review" value={needsReviewCount ?? 0} />
      </div>

      {!!needsReviewCount && (
        <p className="mt-4 text-sm text-amber-300">
          <Link href="/dashboard/calls?filter=needs_review" className="underline hover:text-amber-200">
            {needsReviewCount} call{needsReviewCount === 1 ? "" : "s"} flagged for review
          </Link>{" "}
          — the agent hit something it wasn't confident about.
        </p>
      )}

      {callsToday === 0 && (
        <p className="mt-8 text-sm text-ink-400">
          No calls yet today. Once your agent worker is running and a call comes in — via the browser
          test page or a real phone call — it'll show up here.
        </p>
      )}
    </div>
  );
}
