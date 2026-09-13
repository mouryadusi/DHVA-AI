import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId } from "@/lib/business-brain/queries";

export default async function PhonePage() {
  const businessId = await getDefaultBusinessId();
  if (!businessId) return <h1 className="text-xl font-semibold">Phone</h1>;

  const supabase = await createClient();
  const { data: numbers } = await supabase
    .from("phone_numbers")
    .select("*")
    .eq("business_id", businessId);

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Phone</h1>
      <p className="mb-6 text-sm text-ink-400">
        Phone numbers are provisioned in Telnyx and connected via a LiveKit SIP trunk + dispatch
        rule — see docs/TELNYX_SETUP.md for the exact configuration. This page reflects what's
        connected; it doesn't provision numbers itself in the MVP.
      </p>

      <div className="space-y-3">
        {(numbers ?? []).map((n) => (
          <div
            key={n.id}
            className="flex items-center justify-between rounded-lg border border-ink-800 bg-ink-900 px-4 py-3"
          >
            <div>
              <p className="font-mono text-sm">{n.e164_number}</p>
              <p className="text-xs text-ink-400">via {n.provider}</p>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${
                n.status === "active"
                  ? "border-emerald-800 bg-emerald-950 text-emerald-300"
                  : "border-ink-700 bg-ink-800 text-ink-400"
              }`}
            >
              {n.status}
            </span>
          </div>
        ))}

        {(numbers ?? []).length === 0 && (
          <div className="rounded-lg border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-ink-400">
            No phone number connected yet. Follow docs/TELNYX_SETUP.md, then insert a row into{" "}
            <code className="rounded bg-ink-900 px-1 py-0.5">phone_numbers</code> once it's live.
          </div>
        )}
      </div>
    </div>
  );
}
