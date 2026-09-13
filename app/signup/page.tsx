"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Organization + starter business creation happens entirely
    // server-side via the `handle_new_user` trigger on auth.users
    // (supabase/migrations/0004_fix_signup_trigger.sql) — NOT here. This
    // is deliberate: that trigger fires the instant Postgres creates the
    // user row, regardless of whether email confirmation is required and
    // regardless of whether this client ever gets an active session. The
    // previous version of this page tried to insert the organization from
    // here immediately after signUp(), which silently failed under RLS
    // whenever email confirmation was enabled (auth.uid() isn't set until
    // the user actually confirms and logs in) — that was the root cause
    // of "No organization found for your account." Don't reintroduce
    // client-side org creation here; fix or extend the trigger instead.
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { org_name: orgName || undefined }, // read by handle_new_user via raw_user_meta_data
      },
    });

    if (signUpError || !signUpData.user) {
      setError(signUpError?.message ?? "Sign up failed.");
      setLoading(false);
      return;
    }

    if (!signUpData.session) {
      // Email confirmation is required. The organization/business already
      // exist (the trigger ran on the server the moment the user row was
      // created) — this account just needs to confirm before logging in.
      setConfirmationSent(true);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  if (confirmationSent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="mb-2 text-xl font-semibold">Check your email</h1>
          <p className="text-sm text-ink-400">
            We sent a confirmation link to {email}. Your organization and starter business are
            already set up — once you confirm and log in, you'll land straight on the dashboard.
          </p>
          <Link href="/login" className="mt-4 inline-block text-sm text-accent-500 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mb-8 text-sm text-ink-400">Set up Dhva AI for your business</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-ink-200">Organization name</label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Acme Inc."
              className="w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-200">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-200">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-ink-700 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent-500 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-ink-400">
          Already have an account?{" "}
          <Link href="/login" className="text-accent-500 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
