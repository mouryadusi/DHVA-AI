# Real Phone Test

This is the walkthrough for the acceptance test: a real call from your
mobile phone, through Telnyx and LiveKit, to the Dhva agent, with a human
transfer fallback and a complete record in the dashboard afterward.

**Status: REQUIRES EXTERNAL CONFIGURATION.** Nothing in this doc has been
executed against real Telnyx/LiveKit/provider accounts — this sandbox has
no network access. Every step below is code- and docs-verified, not
call-verified. Treat your first real call as the actual test, not this
document.

## Prerequisites

- [ ] `npm run doctor` shows all required Next.js + agent env vars set
- [ ] `npm run db:migrate` applied (includes `0003_fix_onboarding.sql`)
- [ ] Signed up through the app once — confirm the dashboard shows Dhva
      Pizza automatically (no "No business found" banner; see
      `docs/TROUBLESHOOTING.md` if it still appears)
- [ ] Agent worker running (`cd agent && python -m src.entrypoint dev`) and
      its logs show it connected to LiveKit
- [ ] **Phone 2 configured**: set a real number you can answer on the
      dashboard's AI Agent page ("Human transfer number") — human transfer
      cannot be tested with this left blank
- [ ] Telnyx number purchased and wired per `docs/TELNYX_SETUP.md`
- [ ] A row exists in `phone_numbers` for that number with `status = 'active'`

## Test 1 — Browser call (do this before the real phone test)

1. `npm run dev`, go to `/test`, click **Start call**
2. Speak naturally — ask about hours, ask for the menu, place a small order
3. Confirm: live transcript appears, agent responds with real menu items
   (not invented ones), `calculate_order` total matches the seeded prices
4. Check the dashboard **Calls** page — the call should appear with a
   transcript and (after a few seconds — summarization is a background
   step in the shutdown callback) a summary

If this doesn't work, **stop and fix it before attempting a real phone
call** — the phone path adds Telnyx/SIP as more moving parts on top of
the same pipeline; it can't fix a pipeline problem browser calls also hit.

## Test 2 — Real phone call (Phone 1)

1. Dial the Telnyx number from your mobile phone
2. Confirm you hear the configured greeting within a couple seconds
3. Ask a real business question ("are you open right now?", "how much is
   a pepperoni pizza?") — confirm the answer matches actual seeded data
4. Place an order ("two Margheritas and a garlic bread") — confirm the
   agent doesn't invent unavailable items and totals correctly
5. Hang up normally

Check the dashboard:
- [ ] Call appears in **Calls** with your phone number as caller
- [ ] Transcript reflects what was actually said
- [ ] `tool_executions` show the tools that fired (visible on the call
      detail page)
- [ ] `outcome` is set (not null) — see `agent/src/outcome.py` for the
      classification rules
- [ ] Summary is present and reads like a real summary, not a truncated
      transcript dump (if it looks like a dump, the LLM summarization call
      failed and fell back — see `agent/src/summarize.py`'s fallback path
      and check the agent worker's logs for why)

## Test 3 — Human transfer to Phone 2

1. Call the Telnyx number again (Phone 1)
2. Say "I want to talk to a real person" or otherwise clearly request a human
3. **Have Phone 2 ready to answer** — this is the business/fallback number
   you set in AI Agent settings
4. Confirm Phone 2 rings and, when answered, you're connected to the
   original caller

If the transfer doesn't happen: check the agent worker logs for the
`transfer_fn` failure reason. `agent/src/tools/transfer.py::execute_transfer`
is explicitly flagged as **IMPLEMENTED BUT NOT VERIFIED** — this is the
single most likely thing to need a fix on first real attempt. Confirm
`transfer_sip_participant`'s exact method/argument names against
https://docs.livekit.io/sip/ for the `livekit-agents` version actually
installed (`pip show livekit-agents`).

If the transfer API call is wrong, the caller hears "the transfer didn't
go through" (the designed fail-safe) rather than a dropped call — that's
the intended degraded behavior, not a bug, while this is unverified.

## Test 4 — Normal calls don't need Phone 2

Place a normal call (Test 2) **without** Phone 2 being reachable. Confirm
Dhva completes the whole interaction — greeting, business questions,
order — without ever needing Phone 2 to answer. Phone 2 should only ring
when a transfer is explicitly triggered (Test 3).

## What "done" looks like

All four tests pass, and every real call — transferred or not — shows up
in the dashboard with an accurate transcript, a real (LLM-generated, not
concatenated) summary, and a non-null outcome.
