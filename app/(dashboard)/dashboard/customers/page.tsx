import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId } from "@/lib/business-brain/queries";

export default async function CustomersPage() {
  const businessId = await getDefaultBusinessId();
  if (!businessId) return <h1 className="text-xl font-semibold">Customers</h1>;

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", businessId)
    .order("last_contact_at", { ascending: false, nullsFirst: false });

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold">Customers</h1>
      <div className="overflow-hidden rounded-lg border border-ink-800">
        <table className="w-full text-sm">
          <thead className="border-b border-ink-800 bg-ink-900 text-left text-xs uppercase text-ink-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Last contact</th>
            </tr>
          </thead>
          <tbody>
            {(customers ?? []).map((c) => (
              <tr key={c.id} className="border-b border-ink-800 last:border-0">
                <td className="px-4 py-3">{c.name || "—"}</td>
                <td className="px-4 py-3 text-ink-400">{c.phone_number}</td>
                <td className="px-4 py-3 text-ink-400">
                  {c.last_contact_at ? new Date(c.last_contact_at).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {(customers ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-ink-400">
                  No customers yet — they're created automatically from calls.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
