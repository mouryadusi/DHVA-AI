# Dhva AI

The AI voice employee that answers your business phone. No customer lost
because nobody could pick up.

Full architecture rationale: `docs/architecture-and-roadmap.md`. Project
context for future development: `CLAUDE.md`.

> **Before you start:** this codebase was built in a sandboxed environment
> with no network access, so `npm install` / `npm run build` / tests were
> never actually executed against it — only syntax-checked. Your first step
> is running the install + build + test commands below for real. See
> "Known limitations" at the bottom.

## Architecture in one paragraph

Two separately-deployed processes sharing one Postgres (Supabase) database:
a **Next.js dashboard** (this repo's root) and a **Python LiveKit Agents
voice worker** (`agent/`). The dashboard manages business config; the
worker answers calls using that config and logs everything back to the
same database. See `CLAUDE.md` for why they're split this way.

## Required external accounts

| Service | For | Free tier? |
|---|---|---|
| [Supabase](https://supabase.com) | Database + Auth | Yes |
| [LiveKit Cloud](https://cloud.livekit.io) | Real-time voice transport + SIP | Yes (dev tier) |
| [Deepgram](https://deepgram.com) | Speech-to-text | Yes (trial credit) |
| [Anthropic](https://console.anthropic.com) or [OpenAI](https://platform.openai.com) | LLM reasoning | Paid |
| [Cartesia](https://cartesia.ai) or [ElevenLabs](https://elevenlabs.io) | Text-to-speech | Yes (trial credit) |
| [Telnyx](https://telnyx.com) | Real phone number (only needed for the real phone test) | Pay-as-you-go |

## 1. Install and configure

```bash
git clone <your-repo-url>
cd dhva-ai
npm install
cp .env.example .env.local        # fill in Supabase + LiveKit values
```

## 2. Database setup

```bash
npm run db:migrate      # applies supabase/migrations/0001_init.sql + 0002_rls.sql
npm run db:seed         # loads the Dhva Pizza demo tenant (supabase/seed.sql)
```

`db:migrate` requires the Supabase CLI linked to your project
(`supabase link --project-ref <ref>`) — see Supabase's own docs for that
one-time setup step.

After seeding, sign up through the app once (`npm run dev` → `/signup`),
then link your new organization to the seeded business manually for the
demo (see the comment at the top of `supabase/seed.sql`) — the MVP doesn't
yet have a self-serve "claim this business" flow.

## 3. Run the dashboard

```bash
npm run dev
```

Visit `http://localhost:3000`, sign up, and you should land on the
dashboard Overview page.

## 4. Run the agent worker (separate terminal, separate venv)

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # fill in Supabase service_role + LiveKit + provider keys
python -m src.entrypoint dev
```

Leave this running — it holds a connection open to LiveKit and waits for
call dispatch.

## 5. Browser voice test

With both processes running: go to `http://localhost:3000/test`, click
**Start call**, allow microphone access, and talk. This is a real LiveKit
WebRTC session hitting the real agent pipeline — not a simulation. Full
scenario checklist: `docs/VOICE_TEST_SCENARIOS.md`.

## 6. Real phone test

Follow `docs/TELNYX_SETUP.md` exactly — buying a number, wiring the Telnyx
SIP trunk to LiveKit, and creating a dispatch rule. Once done, calling that
number from your mobile phone should reach the same agent pipeline as
step 5.

## Deployment

`docs/DEPLOYMENT.md` — dashboard to Vercel, agent worker to
Railway/Fly/Render (**not** Vercel; it needs a persistent process).

## Status: VERIFIED / IMPLEMENTED BUT NOT VERIFIED / REQUIRES EXTERNAL CONFIGURATION

Three honest categories, used throughout `CLAUDE.md` and the docs below —
worth understanding before you trust any specific claim in this repo:

- **VERIFIED** — actually executed in the sandbox this was built in
  (currently: `scripts/doctor.mjs`'s runtime behavior, and every file's
  syntax). Nothing about correctness beyond that.
- **IMPLEMENTED BUT NOT VERIFIED** — real, complete code using
  current-as-researched provider APIs, but never run against a live
  Supabase/LiveKit/Telnyx/provider account, because this sandbox has no
  network access. This is most of the codebase.
- **REQUIRES EXTERNAL CONFIGURATION** — cannot be verified without real
  accounts no matter the dev environment (Telnyx number, SIP trunk, the
  actual phone call).

**The real-phone acceptance test has not been run.** `docs/PHONE_TEST.md`
is the walkthrough; don't consider Dhva "working" until you've run it
end to end yourself.

## Known gaps

Full list with reasoning: `CLAUDE.md` → "Known gaps." Headline items:
- `execute_transfer`'s SIP transfer call is unverified against the
  installed LiveKit SDK version — most likely thing to break on first
  real transfer attempt
- Multi-tenant SIP routing by dialed number is implemented but unverified
  against a real inbound call's participant attributes
- Outcome classification is intentionally coarse (5 buckets, rule-based —
  see `docs/ARCHITECTURE_DECISIONS.md` ADR-7)

## Security & production-readiness review

Performed as a final pass on this codebase, not a generic checklist:

| Area | Status | Note |
|---|---|---|
| RLS on every business-scoped table | ✅ Fixed | See `docs/TROUBLESHOOTING.md` — this pass found and fixed a real gap (missing INSERT policies), not a hypothetical one |
| `SUPABASE_SERVICE_ROLE_KEY` isolation | ✅ | Only in `agent/.env`, never in Next.js client code or `NEXT_PUBLIC_*` vars |
| API keys in frontend code | ✅ | Checked every `"use client"` file — none reference server-only env vars |
| Prompt-injection resistance | ⚠️ Partial | Explicit defense block in `build_system_prompt`; only tested via the manual scenario (#15 in `docs/VOICE_TEST_SCENARIOS.md`), not an automated adversarial suite |
| Tenant isolation for calls/customers/tool_executions | ✅ Fixed | Static test (`tests/tenant-isolation.test.ts`) confirms every table has a policy; **does not** confirm policy logic is correct — see that test file's own caveat |
| Webhook/input validation | N/A | No custom webhooks in this architecture — Telnyx↔LiveKit is SIP trunk config, not a webhook endpoint (see ADR-4-adjacent note in `docs/TELNYX_SETUP.md`) |
| Rate limiting | ✅ Fixed | `/api/livekit/token` now enforces 10 tokens/user/minute via a SECURITY DEFINER Postgres function (atomic check-and-record, avoids a race condition a naive table+policy approach would have) — see `supabase/migrations/0005_review_and_rate_limit.sql` |
| Secrets never committed | ✅ | `.gitignore` covers `.env`, `.env.local`, `agent/.env` |
| SIP transfer authorization | ⚠️ | `execute_transfer` doesn't currently verify the caller is actually still in-room before transferring — low risk given it's only reachable via the LLM's own tool-calling decision, not caller input directly, but worth hardening before a second tenant |

This table reflects a genuine review, not reassurance — the ⚠️ and ❌ rows
are real, not filler modesty.

## Your next action

```bash
npm install && npm run typecheck && npm run lint && npm test && npm run build
npm run doctor          # after copying .env.example -> .env.local
cd agent && pip install -r requirements.txt && pytest
```

Fix whatever surfaces first. Then work through `docs/PHONE_TEST.md` in
order — browser test before real phone, real phone before human transfer.
