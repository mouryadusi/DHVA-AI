import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId } from "@/lib/business-brain/queries";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-emerald-950 text-emerald-300 border-emerald-800",
    in_progress: "bg-amber-950 text-amber-300 border-amber-800",
    failed: "bg-red-950 text-red-300 border-red-800",
    no_answer: "bg-ink-800 text-ink-400 border-ink-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${colors[status] ?? colors.no_answer}`}>
      {status.replace("_", " ")}
    </span>
  );
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const businessId = await getDefaultBusinessId();
  if (!businessId) return <h1 className="text-xl font-semibold">Calls</h1>;

  const { filter } = await searchParams;
  const reviewOnly = filter === "needs_review";

  const supabase = await createClient();
  let query = supabase
    .from("calls")
    .select("*, customers(name, phone_number)")
    .eq("business_id", businessId)
    .order("started_at", { ascending: false })
    .limit(50);

  if (reviewOnly) query = query.eq("needs_review", true);

  const { data: calls } = await query;

  const { count: reviewCount } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("needs_review", true);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calls</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href="/dashboard/calls"
            className={`rounded-md px-3 py-1.5 ${!reviewOnly ? "bg-ink-800 text-white" : "text-ink-400 hover:text-white"}`}
          >
            All
          </Link>
          <Link
            href="/dashboard/calls?filter=needs_review"
            className={`rounded-md px-3 py-1.5 ${reviewOnly ? "bg-amber-900 text-amber-100" : "text-ink-400 hover:text-white"}`}
          >
            Needs review{reviewCount ? ` (${reviewCount})` : ""}
          </Link>
        </div>
      </div>

      {!reviewOnly && !!reviewCount && (
        <p className="mb-4 text-sm text-amber-300">
          {reviewCount} call{reviewCount === 1 ? "" : "s"} flagged for review — the agent hit a
          question it couldn't confidently answer, a failed action, or an escalation.{" "}
          <Link href="/dashboard/calls?filter=needs_review" className="underline hover:text-amber-200">
            View them
          </Link>
          .
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-ink-800">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-800 bg-ink-900 text-left text-xs uppercase text-ink-400">
            <tr>
              <th className="px-4 py-3">Caller</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Outcome</th>
              <th className="px-4 py-3">Transfer</th>
              <th className="px-4 py-3">Review</th>
            </tr>
          </thead>
          <tbody>
            {(calls ?? []).map((call) => (
              <tr key={call.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-900">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/calls/${call.id}`} className="hover:text-accent-500">
                    {(call as any).customers?.name || call.from_number || "Unknown"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-400">
                  {new Date(call.started_at).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-ink-400">
                  {call.duration_seconds ? `${call.duration_seconds}s` : "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={call.status} />
                </td>
                <td className="px-4 py-3 text-ink-400">{call.outcome ?? "—"}</td>
                <td className="px-4 py-3 text-ink-400">{call.transferred ? "Yes" : "No"}</td>
                <td className="px-4 py-3">
                  {call.needs_review ? (
                    <span
                      className="rounded-full border border-amber-800 bg-amber-950 px-2 py-0.5 text-xs text-amber-300"
                      title={call.review_reason ?? undefined}
                    >
                      Needs review
                    </span>
                  ) : (
                    <span className="text-ink-600">—</span>
                  )}
                </td>
              </tr>
            ))}
            {(calls ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-400">
                  {reviewOnly ? "No calls currently need review." : "No calls yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
