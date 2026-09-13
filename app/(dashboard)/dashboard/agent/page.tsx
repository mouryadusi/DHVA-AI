import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId, getBusinessBrain } from "@/lib/business-brain/queries";

async function updateAgent(formData: FormData) {
  "use server";
  const agentId = formData.get("agent_id") as string;
  const supabase = await createClient();

  await supabase
    .from("agents")
    .update({
      name: formData.get("name") as string,
      greeting: formData.get("greeting") as string,
      personality: formData.get("personality") as string,
      escalation_phone_number: formData.get("escalation_phone_number") as string,
      tts_provider: formData.get("tts_provider") as "cartesia" | "elevenlabs",
    })
    .eq("id", agentId);

  revalidatePath("/dashboard/agent");
}

export default async function AgentPage() {
  const businessId = await getDefaultBusinessId();
  if (!businessId) return <h1 className="text-xl font-semibold">AI Agent</h1>;

  const { agent } = await getBusinessBrain(businessId);

  if (!agent) {
    return (
      <div>
        <h1 className="mb-6 text-xl font-semibold">AI Agent</h1>
        <p className="text-sm text-ink-400">No active agent configured for this business yet.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">AI Agent</h1>
      <p className="mb-6 text-sm text-ink-400">
        Controls exactly what agent/src/entrypoint.py loads at call time — no restart needed, it's
        read fresh from the database on every call.
      </p>

      <form action={updateAgent} className="space-y-4 rounded-lg border border-ink-800 bg-ink-900 p-5">
        <input type="hidden" name="agent_id" value={agent.id} />

        <div>
          <label className="mb-1.5 block text-sm text-ink-200">Agent name</label>
          <input
            name="name"
            defaultValue={agent.name}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-ink-200">Greeting</label>
          <textarea
            name="greeting"
            defaultValue={agent.greeting}
            rows={2}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-ink-200">Personality</label>
          <textarea
            name="personality"
            defaultValue={agent.personality}
            rows={3}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-ink-200">Voice provider</label>
          <select
            name="tts_provider"
            defaultValue={agent.tts_provider}
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
          >
            <option value="cartesia">Cartesia (fast, low latency)</option>
            <option value="elevenlabs">ElevenLabs (more expressive)</option>
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-ink-200">
            Human transfer number (escalation)
          </label>
          <input
            name="escalation_phone_number"
            defaultValue={agent.escalation_phone_number ?? ""}
            placeholder="+15555550123"
            className="w-full rounded-md border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
          <p className="mt-1 text-xs text-ink-400">
            Where calls transfer to when the agent escalates — see agent/src/tools/handoff.py.
          </p>
        </div>

        <button
          type="submit"
          className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}
