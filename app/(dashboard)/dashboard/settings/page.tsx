import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: orgs } = await supabase.from("organizations").select("*, org_members!inner(role)");

  return (
    <div className="max-w-xl">
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>

      <div className="space-y-6">
        <div className="rounded-lg border border-ink-800 bg-ink-900 p-5">
          <h2 className="mb-3 text-sm font-medium text-ink-200">Account</h2>
          <p className="text-sm text-ink-400">Email: {user?.email}</p>
        </div>

        <div className="rounded-lg border border-ink-800 bg-ink-900 p-5">
          <h2 className="mb-3 text-sm font-medium text-ink-200">Organization</h2>
          {(orgs ?? []).map((o) => (
            <div key={o.id} className="flex justify-between border-b border-ink-800 py-2 last:border-0">
              <span className="text-sm">{o.name}</span>
              <span className="text-xs text-ink-400">{(o as any).org_members[0]?.role}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
