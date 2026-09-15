import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const ORDER_STATUSES = ["received", "confirmed", "preparing", "ready", "completed", "cancelled"] as const;

async function updateOrderStatus(formData: FormData) {
  "use server";
  const orderId = formData.get("order_id") as string;
  const status = formData.get("status") as string;
  const callId = formData.get("call_id") as string;
  const supabase = await createClient();
  await supabase.from("orders").update({ status }).eq("id", orderId);
  revalidatePath(`/dashboard/calls/${callId}`);
}

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: call }, { data: messages }, { data: summary }, { data: toolExecutions }, { data: order }] =
    await Promise.all([
      supabase.from("calls").select("*, customers(name, phone_number)").eq("id", id).single(),
      supabase.from("call_messages").select("*").eq("call_id", id).order("sequence"),
      supabase.from("call_summaries").select("*").eq("call_id", id).maybeSingle(),
      supabase.from("tool_executions").select("*").eq("call_id", id).order("created_at"),
      supabase
        .from("orders")
        .select("*, order_items(*)")
        .eq("call_id", id)
        .maybeSingle(),
    ]);

  if (!call) notFound();

  const customer = (call as any).customers;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">
        Call with {customer?.name || call.from_number || "Unknown caller"}
      </h1>
      <p className="mb-6 text-sm text-ink-400">
        {new Date(call.started_at).toLocaleString()} · {call.duration_seconds ?? "?"}s · {call.status}
        {call.transferred && ` · transferred (${call.transfer_reason ?? "reason unknown"})`}
      </p>

      {call.needs_review && (
        <div className="mb-6 rounded-md border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          <p className="font-medium">Flagged for review</p>
          <p className="mt-1 text-amber-300">{call.review_reason ?? "No specific reason recorded."}</p>
        </div>
      )}

      {order && (
        <div className="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/20 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-300">
              Order #{order.id.slice(0, 8)} · {order.fulfillment_type}
            </p>
            <form action={updateOrderStatus} className="flex items-center gap-2">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="call_id" value={id} />
              <select
                name="status"
                defaultValue={order.status}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-200"
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </form>
          </div>
          <div className="space-y-1 text-sm text-ink-200">
            {((order as any).order_items ?? []).map((item: any) => (
              <div key={item.id} className="flex justify-between">
                <span>
                  {item.quantity}× {item.product_name}
                </span>
                <span className="text-ink-400">${(item.line_total_cents / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between border-t border-ink-800 pt-2 text-sm font-medium">
            <span>Total</span>
            <span>${(order.total_cents / 100).toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-medium text-ink-200">Transcript</h2>
            <div className="space-y-2 rounded-lg border border-ink-800 bg-ink-900 p-4">
              {(messages ?? []).map((m) => (
                <div key={m.id} className="text-sm">
                  <span
                    className={
                      m.role === "user"
                        ? "text-accent-500"
                        : m.role === "assistant"
                          ? "text-ink-50"
                          : "text-ink-400"
                    }
                  >
                    {m.role === "user" ? "Caller" : m.role === "assistant" ? "Dhva" : m.role}:
                  </span>{" "}
                  <span className="text-ink-200">{m.content}</span>
                </div>
              ))}
              {(messages ?? []).length === 0 && (
                <p className="text-sm text-ink-400">No transcript recorded for this call.</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium text-ink-200">Tools used</h2>
            <div className="space-y-2">
              {(toolExecutions ?? []).map((t) => (
                <div
                  key={t.id}
                  className="rounded-md border border-ink-800 bg-ink-900 px-3 py-2 text-sm"
                >
                  <span className="font-mono text-accent-500">{t.tool_name}</span>{" "}
                  <span className={t.success ? "text-emerald-400" : "text-red-400"}>
                    {t.success ? "succeeded" : "failed"}
                  </span>
                  {t.latency_ms && <span className="text-ink-400"> · {t.latency_ms}ms</span>}
                </div>
              ))}
              {(toolExecutions ?? []).length === 0 && (
                <p className="text-sm text-ink-400">No tools were called on this call.</p>
              )}
            </div>
          </section>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-200">Summary</h2>
          <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 text-sm text-ink-200">
            {summary?.summary_text ?? "No summary generated for this call."}
            {summary?.opportunity_saved && (
              <p className="mt-3 text-xs text-emerald-400">✓ Counted as an opportunity saved</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
