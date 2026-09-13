import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId, getBusinessBrain } from "@/lib/business-brain/queries";

async function updateBusiness(formData: FormData) {
  "use server";
  const businessId = formData.get("business_id") as string;
  const supabase = await createClient();

  await supabase
    .from("businesses")
    .update({
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      timezone: formData.get("timezone") as string,
    })
    .eq("id", businessId);

  revalidatePath("/dashboard/business");
}

export default async function BusinessPage() {
  const businessId = await getDefaultBusinessId();
  if (!businessId) return <h1 className="text-xl font-semibold">Business</h1>;

  const { business, hours, services, products, faqs } = await getBusinessBrain(businessId);
  if (!business) return <p className="text-ink-400">Business not found.</p>;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Business</h1>
        <p className="mb-6 text-sm text-ink-400">
          This is the ground truth Dhva uses on calls. The agent never invents facts beyond what's
          here — see agent/src/business_brain.py.
        </p>

        <form action={updateBusiness} className="space-y-4 rounded-lg border border-ink-800 bg-ink-900 p-5">
          <input type="hidden" name="business_id" value={business.id} />
          <div>
            <label className="mb-1.5 block text-sm text-ink-200">Name</label>
            <input
              name="name"
              defaultValue={business.name}
              className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-200">Description</label>
            <textarea
              name="description"
              defaultValue={business.description ?? ""}
              rows={3}
              className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-200">Timezone</label>
            <input
              name="timezone"
              defaultValue={business.timezone}
              className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            Save
          </button>
        </form>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-ink-200">Hours</h2>
        <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm">
          {hours.map((h) => (
            <div key={h.id} className="flex justify-between border-b border-ink-800 py-1.5 last:border-0">
              <span className="text-ink-400">{dayNames[h.day_of_week]}</span>
              <span>{h.is_closed ? "Closed" : `${h.open_time} – ${h.close_time}`}</span>
            </div>
          ))}
        </div>
      </div>

      {products.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-200">Menu / Products</h2>
          <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm">
            {products.map((p) => (
              <div key={p.id} className="flex justify-between border-b border-ink-800 py-1.5 last:border-0">
                <span>{p.name}</span>
                <span className="text-ink-400">${(p.price_cents / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {services.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-200">Services</h2>
          <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm">
            {services.map((s) => (
              <div key={s.id} className="border-b border-ink-800 py-1.5 last:border-0">
                <div className="flex justify-between">
                  <span>{s.name}</span>
                  <span className="text-ink-400">
                    {s.price_cents ? `$${(s.price_cents / 100).toFixed(2)}` : "Price on request"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium text-ink-200">FAQs</h2>
        <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm">
          {faqs.map((f) => (
            <div key={f.id} className="border-b border-ink-800 py-2 last:border-0">
              <p className="font-medium">{f.question}</p>
              <p className="text-ink-400">{f.answer}</p>
            </div>
          ))}
          {faqs.length === 0 && <p className="text-ink-400">No FAQs added yet.</p>}
        </div>
      </div>
    </div>
  );
}
