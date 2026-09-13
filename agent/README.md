# Dhva AI — Agent Worker

This is the real-time voice pipeline: a LiveKit Agents worker that connects
to LiveKit, gets dispatched into a room whenever a call comes in (via the
Telnyx SIP trunk — see ../docs/TELNYX_SETUP.md — or the browser test page
at /test), and runs the STT -> LLM -> TTS conversation loop with tool
calling against the business brain in Supabase.

## Why this isn't part of the Next.js app

This needs to be a long-lived, persistent process holding a LiveKit
connection open and waiting for job dispatches. Vercel serverless functions
are request/response and cannot do this. Deploy this separately — Railway,
Fly.io, Render, or a plain VM all work. The Next.js app and this worker
share only two things: the Supabase database, and (implicitly) the LiveKit
project they're both configured against.

## Local development

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in real keys
python -m src.entrypoint dev
```

`dev` mode connects to your LiveKit project and waits for job dispatch —
leave it running, then either:
- open the Next.js app's `/test` page and click "Start call", or
- place a real call once Telnyx is wired up (../docs/TELNYX_SETUP.md)

## Tests

```bash
pip install -r requirements.txt   # includes pytest
pytest
```

Only pure logic (agent/src/tools/*, business_brain.py's prompt builder) is
unit tested here — no live Supabase/LiveKit connection is required to run
these. Full pipeline behavior is covered by the manual scenarios in
../docs/VOICE_TEST_SCENARIOS.md, which need real calls.

## Structure

```
src/
  entrypoint.py       LiveKit AgentSession wiring — the actual voice loop
  business_brain.py   Fetches tenant config from Supabase, builds the system prompt
  call_logging.py     Writes calls/messages/tool_executions/summaries
  db.py                Supabase client (service_role — bypasses RLS by design)
  tools/
    hours.py           get_business_hours logic
    menu.py            search_menu logic
    order.py           calculate_order logic
    message.py          take_message logic
    transfer.py         request_human_transfer / escalation decision + SIP transfer
tests/
  test_tools.py        Unit tests for everything in tools/
```
