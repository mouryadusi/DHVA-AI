import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getDefaultBusinessId, getOrphanedOrgId } from "@/lib/business-brain/queries";
import SignOutButton from "./sign-out-button";

async function createStarterBusiness(formData: FormData) {
  "use server";
  const orgId = formData.get("org_id") as string;
  const supabase = await createClient();
  // Calls the SECURITY DEFINER function added in
  // supabase/migrations/0003_fix_onboarding.sql — it verifies org
  // membership itself, so this is safe to expose directly.
  const { error } = await supabase.rpc("provision_starter_business", { target_org_id: orgId });
  if (error) {
    // Surfaces on next render via the empty-state still being shown;
    // acceptable for this one-time recovery path rather than a full toast system.
    console.error("provision_starter_business failed:", error.message);
  }
  revalidatePath("/dashboard");
}

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/calls", label: "Calls" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/business", label: "Business" },
  { href: "/dashboard/agent", label: "AI Agent" },
  { href: "/dashboard/phone", label: "Phone" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const businessId = await getDefaultBusinessId();
  const orphanedOrgId = businessId ? null : await getOrphanedOrgId();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-ink-800 px-4 py-6">
        <div className="mb-8 px-2 text-lg font-semibold tracking-tight">Dhva AI</div>
        <nav className="space-y-0.5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-2 py-1.5 text-sm text-ink-200 transition hover:bg-ink-800 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-8 border-t border-ink-800 pt-4">
          <Link
            href="/test"
            className="block rounded-md px-2 py-1.5 text-sm text-accent-500 transition hover:bg-ink-800"
          >
            Browser voice test →
          </Link>
        </div>

        <div className="mt-auto pt-8">
          <p className="truncate px-2 text-xs text-ink-400">{user.email}</p>
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 px-8 py-6">
        {!businessId && orphanedOrgId && (
          <div className="mb-6 rounded-md border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            <p className="mb-2">
              Your organization doesn't have a business yet — this happens for accounts created
              before the onboarding fix in{" "}
              <code className="rounded bg-ink-900 px-1 py-0.5">
                supabase/migrations/0003_fix_onboarding.sql
              </code>{" "}
              (see <code className="rounded bg-ink-900 px-1 py-0.5">docs/TROUBLESHOOTING.md</code>).
              New signups no longer hit this.
            </p>
            <form action={createStarterBusiness}>
              <input type="hidden" name="org_id" value={orphanedOrgId} />
              <button
                type="submit"
                className="rounded-md bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
              >
                Create starter business now
              </button>
            </form>
          </div>
        )}
        {!businessId && !orphanedOrgId && (
          <div className="mb-6 rounded-md border border-amber-800 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
            No organization found for your account. This shouldn't happen after signup — see{" "}
            <code className="rounded bg-ink-900 px-1 py-0.5">docs/TROUBLESHOOTING.md</code>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
