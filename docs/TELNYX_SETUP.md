# Telnyx ↔ LiveKit Phone Setup

This is how a real phone call reaches the Dhva agent: **Telnyx routes the
call as a SIP trunk directly into LiveKit**, which dispatches the agent
worker into a room. There is no custom webhook code involved in the basic
inbound-call path — this is configuration, done once per phone number.

> Verify each exact field name/flow against current docs before doing this
> for real — both Telnyx's portal and LiveKit's SIP docs have moved fields
> around across versions. Treat the steps below as the correct shape of the
> process, confirmed against LiveKit's SIP documentation, not a guaranteed
> byte-for-byte walkthrough of Telnyx's current UI.
> - LiveKit SIP: https://docs.livekit.io/sip/
> - Telnyx SIP trunking: https://developers.telnyx.com/docs/voice/sip-trunking

## 1. Buy a number on Telnyx

Telnyx Portal → Numbers → Buy Numbers. Note the number in E.164 format
(e.g. `+15551234567`).

## 2. Create a LiveKit inbound SIP trunk

Using the LiveKit CLI (`lk`) against your project:

```bash
lk sip inbound create inbound-trunk.json
```

`inbound-trunk.json`:
```json
{
  "trunk": {
    "name": "Dhva Telnyx Inbound",
    "numbers": ["+15551234567"]
  }
}
```

This gives you a LiveKit SIP URI to point Telnyx at (found in the LiveKit
Cloud dashboard under Settings → SIP, or via `lk sip inbound list`).

## 3. Point Telnyx at LiveKit

In the Telnyx portal, create a SIP Connection (Voice → SIP Connections)
using **IP authentication** or **credentials**, with:
- Destination: LiveKit's SIP domain for your project (from step 2)
- Assign the phone number from step 1 to this connection's outbound voice profile / number routing

## 4. Create a LiveKit dispatch rule

This is what makes an inbound call automatically create a room and
dispatch the Dhva agent worker into it:

```bash
lk sip dispatch create dispatch-rule.json
```

`dispatch-rule.json`:
```json
{
  "dispatch_rule": {
    "rule": {
      "dispatchRuleIndividual": {
        "roomPrefix": "call-"
      }
    },
    "trunk_ids": ["<the trunk ID from step 2>"]
  }
}
```

Each inbound call now gets its own room (`call-<random>`), and any running
agent worker (`agent/src/entrypoint.py`) with automatic dispatch enabled
joins it. The MVP entrypoint uses automatic dispatch (no `agent_name`
filtering) for simplicity — see the `resolve_business_id_for_room` TODO in
`agent/src/entrypoint.py` for what production multi-tenant dispatch needs
instead (routing by dialed number, not "whichever worker is free").

## 5. Record the number in the database

Once steps 1–4 are live, insert a row so the dashboard's Phone page
reflects reality:

```sql
insert into phone_numbers (business_id, e164_number, provider, status)
values ('<your business id>', '+15551234567', 'telnyx', 'active');
```

## 6. Run the agent worker

```bash
cd agent
python -m src.entrypoint dev
```

Leave this running. It needs to be a persistent process — see
`agent/README.md` for why this can't run on Vercel.

## 7. Call it

Dial `+15551234567` from your phone. The call should route: Telnyx → SIP
trunk → LiveKit room → agent worker dispatch → `entrypoint.py` runs →
Dhva answers.

## Environment variables this depends on

Agent worker (`agent/.env`):
```
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DEEPGRAM_API_KEY=
ANTHROPIC_API_KEY=   # or OPENAI_API_KEY
CARTESIA_API_KEY=    # or ELEVENLABS_API_KEY
```

## Local development caveat

If you're running the agent worker on `localhost` (not deployed), LiveKit
Cloud still reaches it fine — the worker makes an *outbound* WebSocket
connection to LiveKit, so no inbound port-forwarding or public IP is
needed for local dev. This is different from a traditional webhook-based
telephony integration, which is one of the reasons this architecture was
chosen over one requiring a publicly reachable webhook endpoint during
development.

## Production deployment caveat

For production, run the agent worker somewhere with a stable outbound
connection and enough concurrency headroom for your expected simultaneous
call volume (Railway/Fly.io/Render/a VM — see `agent/README.md`). Multiple
worker instances can run simultaneously; LiveKit's dispatch balances jobs
across connected workers.
