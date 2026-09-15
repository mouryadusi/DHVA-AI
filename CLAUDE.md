# CLAUDE.md

Context for working on this repo — read this before making changes.

## What this is

Dhva AI: an AI voice employee that answers business phone calls. First
product: an AI receptionist. Promise: "no customer is lost because nobody
answered the phone." Full product/architecture rationale:
`docs/architecture-and-roadmap.md` — read that before making architecture
decisions, not just this file.

## Two-process architecture — this is the most important thing to understand

This is **two separately-deployed processes sharing one Postgres database**,
not a monolith:

1. **`/` (Next.js, TypeScript)** — dashboard, auth, business brain CRUD,
   browser voice test page, LiveKit token minting. Deploys to Vercel.
2. **`agent/` (Python)** — the actual real-time voice pipeline (LiveKit
   Agents: STT → LLM → TTS + tool calling). Deploys to Railway/Fly/Render/a
   VM — **never Vercel**, it needs a persistent process holding a LiveKit
   connection open, which serverless functions can't do.

They communicate through Supabase only. The Next.js app writes business
brain config (products, hours, agent personality); the agent worker reads
it fresh at the start of every call and writes back calls/messages/
tool_executions/summaries, which the dashboard then reads. There is no
direct API between the two processes.

If you're about to add a feature that needs the two to talk to each other
directly, that's a signal to re-check whether it should just be a new
table/column instead.

## Commands

```bash
# Next.js app
npm install
npm run dev            # local dev server
npm run build           # production build
npm run lint
npm run typecheck
npm run test            # vitest

# Database
npm run db:migrate      # supabase db push
npm run db:seed         # loads Dhva Pizza demo tenant

# Agent worker (separate venv)
cd agent
pip install -r requirements.txt
python -m src.entrypoint dev    # local dev, connects to LiveKit
pytest                           # unit tests, no network needed
```

## Coding conventions

- **Business brain is data, not code.** Never add per-vertical branches
  (`if vertical == "pizza"`) anywhere. If a vertical needs different
  behavior, that's a new column/table, not an if-statement. This is the
  whole point of the schema — see `docs/architecture-and-roadmap.md` §4.
- **TS and Python business logic that must match, must be mirrored
  explicitly with a comment pointing at its counterpart** — e.g.
  `lib/business-brain/order-math.ts` ↔ `agent/src/tools/order.py`. Don't
  let these drift; if you change one, change both and update tests in both.
- **RLS is not optional.** Every new table under a business needs an RLS
  policy in the same PR that creates it. `tests/tenant-isolation.test.ts`
  statically checks this — don't disable or work around that test to ship
  a table without a policy.
- **Human handoff is core, not a stretch feature.** Don't gate escalation
  logic behind a feature flag or defer it in a PR "for later."
- **No fake integrations.** If a provider integration can't be completed
  (e.g. no API access in a given environment), mark it with
  `# TODO(Phase N): ...` and a one-line reason, don't stub it silently.

## Environment variables

See `.env.example` (Next.js app) and `agent/.env.example` (agent worker) —
they're separate files on purpose since the two processes deploy
independently. Never commit real values. `SUPABASE_SERVICE_ROLE_KEY` is
especially sensitive — it bypasses RLS entirely and belongs only in the
agent worker's environment (or a Next.js server-only route, never a client
component).

## Testing

- `tests/*.test.ts` (Vitest) — pure TS logic (order math, escalation
  decision, static RLS-coverage check). No live Supabase connection needed.
- `agent/tests/test_tools.py` (pytest) — pure Python tool logic. No live
  Supabase/LiveKit connection needed.
- `docs/VOICE_TEST_SCENARIOS.md` — 20 manual scenarios that need an actual
  voice session (browser `/test` or a real call). These aren't automatable
  without a much larger investment in an LLM-driven test-caller harness;
  don't try to fake-automate them with scripted text inputs — that doesn't
  exercise STT/TTS/turn-taking, which is most of what can go wrong.

## Security requirements — do not break these

- RLS enabled + policy present on every business-scoped table (see above).
- `SUPABASE_SERVICE_ROLE_KEY` never in a client component, never in
  `NEXT_PUBLIC_*` env vars, never logged.
- No API keys in frontend code — check any new `app/**/page.tsx` /
  `"use client"` file before adding an env var reference to it.
- The agent's system prompt (`agent/src/business_brain.py::build_system_prompt`)
  includes an explicit instruction-injection defense block. Don't remove
  it, and treat scenario #15 in `docs/VOICE_TEST_SCENARIOS.md` (prompt
  injection) as a regression test whenever that prompt changes.

## Current status — VERIFIED / IMPLEMENTED BUT NOT VERIFIED / REQUIRES EXTERNAL CONFIGURATION

This distinction is load-bearing — see `README.md`'s definitions. Don't
upgrade an item's status without actually re-checking it.

**VERIFIED** (actually executed in this dev environment):
- `scripts/doctor.mjs` — ran it directly with Node, confirmed it correctly
  distinguishes set/placeholder/missing env vars
- Every `.ts`/`.tsx`/`.py`/`.sql` file's syntax (`node --check`, AST
  parse, `py_compile`, paren-balance check) — syntax only, not type
  correctness or runtime behavior

**IMPLEMENTED BUT NOT VERIFIED** (real code, current APIs researched, but
never run against a live Supabase/LiveKit/Telnyx/provider account —
no network access in this dev environment):
- Auth flow, RLS policies including the `0003_fix_onboarding.sql` fix
- Full DB schema, seed data, `provision_starter_business` auto-provisioning trigger
- Business brain CRUD via dashboard
- LiveKit `AgentSession` wiring (STT/LLM/TTS/tool calling)
- All six tools, including `request_human_transfer`'s real SIP transfer call
- Call logging, outcome classification (`agent/src/outcome.py`), LLM call
  summarization (`agent/src/summarize.py`)
- Browser voice test page (`/test`)
- `npm run typecheck` / `lint` / `test` / `build`, `pytest` — written to
  pass, never executed

**REQUIRES EXTERNAL CONFIGURATION** (cannot be verified without real
accounts regardless of dev environment):
- Telnyx number purchase + SIP trunk + dispatch rule (`docs/TELNYX_SETUP.md`)
- The actual real-phone acceptance test (`docs/PHONE_TEST.md`)
- Whether `transfer_sip_participant`'s signature matches the installed
  `livekit-agents` version — flagged explicitly at every call site

**Do not claim the real phone test works until `docs/PHONE_TEST.md` has
actually been run against real accounts and all four of its tests pass.**

## What changed in this pass (the missing "place order" persistence gap)

A fresh audit — not a continuation of assumptions — found the single
highest-value real gap: `calculate_order` computed a total and the call got
classified `outcome = 'order_placed'`, but **nothing was ever persisted**.
No order record existed anywhere a business owner could see it. This
directly violated the product's own standard ("never claim an action
succeeded unless the tool confirms it") — there was no real confirmation
to check.

Fixed with a real feature, not a relabeling:
- **`supabase/migrations/0007_orders.sql`** — `orders` + `order_items`
  tables, RLS scoped through `is_business_member()`, line items snapshot
  product name/price at order time (survives later menu changes). Business
  owners get update access (unlike `calls`, which stay read-only from the
  dashboard) since marking an order's status is a real expected workflow.
- **New `place_order` tool** (`agent/src/entrypoint.py`) — separate from
  `calculate_order`, which stays a pure preview with no side effects.
  `place_order` re-validates prices server-side rather than trusting
  anything claimed earlier in the conversation, and only returns
  `"confirmed"` after the DB write actually succeeds.
- **Fixed `agent/src/outcome.py`**: `order_placed` now requires `place_order`
  to have actually succeeded — previously it fired on `calculate_order`
  alone, meaning "Customer Opportunities Saved" could count calls where no
  order existed in the database at all. `calculate_order` now correctly
  lands in `answered_faq` (informational, no commitment).
- **Fixed a real latent bug found while wiring this in**: `customer_id`
  was computed in `entrypoint()` but never actually passed to `DhvaAgent`
  — it was always `None` regardless of whether a real customer existed.
- Call detail page now shows the order (items, total, status) with an
  inline status-update control.
- New tests: `tests/orders-migration.test.ts` (10 assertions, all
  confirmed to match the real SQL), and `agent/tests/test_outcome.py`
  updated and **actually executed directly** against the real `outcome.py`
  module (it has zero external dependencies, so this ran for real, not
  just as a syntax check) — 10/10 pass.

## What changed in the pass before that (error taxonomy + a real bug found while wiring it in)

Implemented `phase_15`'s error taxonomy from the master build request —
the item flagged as the evidence-based next step in the prior pass. In
the process of wiring it into `tool_executions`, found and fixed a real
bug, not a hypothetical one:

- **Bug**: `calculate_order` and `request_human_transfer`'s failure paths
  caught their own exceptions (or never raised one) *inside* the
  `with timed_tool_call(...)` block and returned without re-raising. That
  meant `timed_tool_call`'s own exception handler never fired, so these
  failures were being persisted to `tool_executions` as `success = true`
  — even though the LLM correctly saw the failure and `self.tool_calls`
  (used for outcome classification) correctly tracked it. The bug was
  specifically in the *audit trail*, not in what the caller experienced.
- **Fix**: `timed_tool_call` (`agent/src/call_logging.py`) now accepts an
  explicit `record["success"] = False` override with
  `record["error_category"]` / `record["error_message"]`, for the
  legitimate case of a failure that isn't an exception (e.g. "no
  escalation number configured" — the tool ran correctly and determined
  the action can't happen). All four failure sites in `entrypoint.py`
  (`calculate_order`, and three paths in `request_human_transfer`) updated
  to use it.
- **New**: `agent/src/errors.py` (14-category `ErrorCategory` enum +
  `DhvaError` + best-effort `categorize_unknown_exception` for
  third-party SDK exceptions), `agent/src/logging_utils.py` (structured
  JSON logging with call_id/business_id correlation fields and secret
  redaction — verified redaction actually works against a real log line,
  not just asserted), `supabase/migrations/0007_error_taxonomy.sql`
  (adds `tool_executions.error_category`, added `NOT VALID` deliberately
  so it can't break on existing failed rows from before this migration).
- Replaced the plain-string `logger.exception(...)` calls in the transfer
  path and top-level call-failure handler with categorized structured
  events. Also fixed a minor privacy improvement as a side effect: the
  old transfer log line included the handoff summary text (conversation
  excerpt) in a log message; the new structured event deliberately omits it.

**Verification note, unusually strong for this pass**: `agent/src/errors.py`
and `agent/src/logging_utils.py` have zero external dependencies (pure
stdlib — no pydantic/supabase), so I could actually *execute* them in this
sandbox despite no network access, not just syntax-check them. Ran all 14
category values, the context-based categorization heuristics, nested-dict
redaction, and a real captured log line through actual Python execution —
shown in this session's tool output. This is genuinely VERIFIED LOCALLY,
not IMPLEMENTED BUT NOT VERIFIED, for those two files specifically.

## What changed in the pass before that (repository audit against the 40-phase master build request)

Given the scope of that request (40 phases covering a full product rewrite),
I audited the actual repository first rather than assuming prior
descriptions were accurate — per that document's own "repository is the
source of truth" principle. Two migrations (`0005`, `0006`) already existed
in the repo from work not reflected in this file yet. Findings:

- **`0006_fix_provisioning_race_and_updated_at.sql` is real and correct**:
  it fixes the check-then-insert race in `provision_starter_business`
  properly — a genuine `unique(org_id)` constraint on `businesses` plus
  `exception when unique_violation` recovery (insert-and-recover, not
  check-then-act), and adds `updated_at` + triggers to the five mutable
  Business Brain tables. This was previously undocumented here and had
  **zero test coverage** — added `tests/provisioning-race-fix.test.ts`,
  verified all 9 assertions actually match the real SQL (shown in this
  session's tool output, not assumed).
- **The 0005 rate limiter is genuinely wired in**, not just defined in
  SQL — confirmed `app/api/livekit/token/route.ts` actually calls
  `check_and_record_token_mint` and fails closed (429) on a real limit hit,
  fails open (logged) only on an infra error. Already correct, no changes needed.
- **Prompt-injection defense block is still intact** in
  `agent/src/business_brain.py`'s `build_system_prompt` — confirmed present,
  not regressed.

I did not attempt the full 40-phase rewrite in this pass — see the note at
the end of this section. What I did do: verify what's claimed vs. what's
real for the highest-risk items (concurrency, security wiring), fix the one
real gap found (missing test coverage for 0006), and leave an honest map of
what's actually P0-complete vs. still open.

**Full 40-phase scope note:** that request is a complete product rewrite
across database, AI architecture, voice, observability, security,
frontend, testing, and competitive strategy — each phase individually is
a multi-day-plus effort done properly. Executing all 40 with genuine
verification in one pass isn't possible without fabricating completion,
which that document itself explicitly forbids ("do not fake completeness
... do not fabricate verification"). The honest path is incremental: audit
→ fix the highest-value real gap → verify it → repeat, which is what this
pass and the ones before it have actually done. See "Known gaps" below for
what's still genuinely open against that document's P0 list.

## What changed in the pass before that (competitive research + needs-review + rate limiting)

Did NOT restart or repeat prior investigation — auth/RLS/token fixes from
prior passes are unchanged and assumed working per their own VERIFIED
status below.

1. **Competitive research** (`docs/COMPETITIVE_ANALYSIS.md`) — real web
   research across 10+ named competitors (Retell, Vapi, Bland, Synthflow,
   Goodcall, Smith.ai, My AI Front Desk, Rosie, Slang.ai, Sameday, Numa,
   and others). Concrete, non-generic finding acted on: every serious
   reviewer explicitly stress-tests "what happens when the AI hits a
   question outside its knowledge" as a pass/fail test, and none of the
   reviewed products appear to proactively surface *which calls were
   uncertain* to the business owner — they just log a transcript.
2. **`calls.needs_review`** (`supabase/migrations/0005_review_and_rate_limit.sql`)
   — a real, narrow differentiator built directly from finding #1: calls
   are flagged the moment the agent hits genuine uncertainty (empty menu
   search, failed order calc, failed transfer, or an escalation reason
   indicating confusion), surfaced as a filterable dashboard view
   (Calls page) and a count on Overview. `agent/src/outcome.py`'s new
   `is_review_worthy_reason()` and the full `classify_outcome()` suite —
   **13 assertions, actually executed against real code in this sandbox**
   (no pydantic/pytest needed since `outcome.py` has zero external
   dependencies) — all passed. This is the one component in the whole
   repo with genuine, executed, not-just-syntax-checked test coverage.
3. **Token-mint rate limiting** — previously flagged in the security
   review table as a real, unaddressed ❌. Fixed with a SECURITY DEFINER
   Postgres function (`check_and_record_token_mint`) rather than
   RLS-policied table access, specifically to avoid a check-then-insert
   race condition. Wired into `/api/livekit/token` with a 429 response
   the browser test page now handles gracefully.



Two deeper root causes found by actually tracing the full chains, not
stopping at the first plausible fix:

1. **Auth/org chain:** the missing RLS INSERT policies (previous pass)
   were necessary but not sufficient — the client-side signup flow's
   insert timing was itself broken under email confirmation (no active
   session = no `auth.uid()` = RLS rejects the insert regardless of the
   policy existing). Fixed in `supabase/migrations/0004_fix_signup_trigger.sql`
   by moving provisioning to an `auth.users` trigger, which runs
   server-side at user-creation time regardless of session state.
   `app/signup/page.tsx` no longer creates anything client-side. Includes
   a one-time backfill for pre-existing orphaned accounts.
2. **LiveKit "invalid token":** the token-minting code itself matched the
   current `livekit-server-sdk` v2 API exactly (verified against current
   docs) — the real gap was no placeholder-detection, so a copy-pasted
   example credential silently minted a well-formed-but-garbage token
   that failed opaquely in the browser. Fixed with placeholder detection
   (`lib/livekit/token.ts`), a `ws://`/`wss://` scheme check
   (`app/api/livekit/token/route.ts`), and — the actually definitive
   fix — `npm run doctor -- --live` now does a real
   `RoomServiceClient.listRooms()` round-trip against the configured
   LiveKit project, which is the only thing that can catch a
   key/secret/URL mismatch before it surfaces as a cryptic client error.
   Also fixed a portability bug: `crypto.randomUUID()` relied on an
   implicit Node global instead of an explicit import.

See `docs/TROUBLESHOOTING.md` for the full diagnostic writeups.

## What changed in the pass before that (fixing "No business found")

Root cause was a genuine RLS gap, not a seed-linking issue: `organizations`
and `org_members` had RLS enabled with zero INSERT policies, so signup's
org-creation insert was silently rejected. Fixed in
`supabase/migrations/0003_fix_onboarding.sql`, which also replaces
fragile multi-step client-side business creation with an atomic
SECURITY DEFINER trigger that provisions a starter business the instant
an org gets its first owner. See `docs/ARCHITECTURE_DECISIONS.md` and
`docs/TROUBLESHOOTING.md` for the full story and recovery path for
accounts created before this fix.

Also implemented this pass: multi-tenant SIP routing by dialed number
(`resolve_business_id_for_room`), real SIP transfer execution wired end to
end (`transfer_fn` in `entrypoint.py`), rule-based outcome classification,
real LLM-generated call summaries (replacing naive concatenation),
graceful spoken fallback on provider failure, basic multilingual STT
wiring, `npm run doctor`, `/api/health`, and this document's honesty
framework.

## Known gaps / explicitly deferred (see inline TODOs for each)

- **`transfer_sip_participant`'s exact signature is unverified** against
  the pinned SDK version — the single most likely thing to need fixing on
  first real transfer attempt (see `docs/PHONE_TEST.md` Test 3)
- **SIP participant attribute keys for the dialed number are unverified**
  (`_find_dialed_number` in `entrypoint.py`) — checks several candidate
  key names but hasn't been confirmed against a real inbound call
- **No automated test exercises a live call end-to-end** — inherent to
  voice, not an oversight to "just fix." `docs/VOICE_TEST_SCENARIOS.md`
  and `docs/PHONE_TEST.md` are the manual coverage for this.
- **Outcome classification is coarse** — five buckets, no partial-success
  nuance (e.g. an order that was calculated but the caller then hung up
  before confirming). Extend `agent/src/outcome.py`'s rules, don't switch
  it to an LLM judge (see ADR-7).
- **Summarization fallback text is a raw transcript excerpt** if the LLM
  call fails — clearly labeled, but still not a "summary." Check agent
  worker logs if you see this in the dashboard.
- **Dev environment note:** this codebase was written in a sandboxed
  environment without network access. `npm install`, `npm run build`,
  `npm run lint`, `npm run test`, and `pytest` have NOT been executed
  against it — see the VERIFIED framework above. Do this first.

## Future roadmap

See `docs/architecture-and-roadmap.md` §5 for the full phased roadmap.
Short version: don't add a second vertical, self-serve onboarding, or
multi-region deployment until the gaps above are closed and this single
demo tenant has survived real pilot calls.
