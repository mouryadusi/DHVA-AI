# Competitive Analysis — AI Phone Receptionists (2026)

Research conducted via web search across vendor comparison sites, review
aggregators, and community sentiment (Reddit/G2/Trustpilot as cited by
secondary sources — not directly scraped). Two distinct market tiers
exist; Dhva sits in the second one.

## Tier 1: Developer voice-AI platforms

**Retell AI, Vapi, Bland AI, Synthflow** — infrastructure you build a
receptionist *on top of*, not a receptionist itself.

| | Strength | Weakness |
|---|---|---|
| Retell | Best-in-class latency (~600ms), managed stack, fastest to production | Less flexible than Vapi; per-minute cost adds up |
| Vapi | Full control (bring your own LLM/STT/TTS) | 2-3x longer build time; "most expensive in production once 4-6 providers are billing you" |
| Bland | Scales to huge outbound volume, deterministic "Pathways" flows | Real-world latency measured far above its own claims (~800ms avg, 2,500ms+ worst case) — directly causes callers to hang up |
| Synthflow | Fastest time-to-demo, no-code, 50+ integrations | Highest per-minute cost; weaker on long/complex conversations |

**Relevant to Dhva's own architecture decision (ADR-3):** the fact that
Bland's *claimed* latency and *measured* latency diverge so badly is
exactly the failure mode a cascaded, observable pipeline (vs. an opaque
managed black box) is meant to avoid — you can't fix what you can't see
per-hop.

## Tier 2: SMB-focused AI receptionists (Dhva's actual competitive set)

**Goodcall, My AI Front Desk, Rosie, Dialzara, Smith.ai, Voksha,
Nextiva AI Receptionist, RingCentral AI Receptionist** — plus vertical
specialists **Slang.ai** (restaurants), **Sameday** (home services),
**Numa** (auto dealerships).

Consistent findings across independent reviews:

1. **Hallucination on out-of-scope questions is treated as a pass/fail
   test, not a nice-to-have.** One reviewer's explicit methodology:
   "ask an out-of-knowledge-base question and verify the fallback works
   before you trust the vendor with real callers." This directly
   validates Dhva's deterministic search/order logic (ADR-6) and is the
   exact scenario `docs/VOICE_TEST_SCENARIOS.md` #9 and #14 already test.
2. **Multi-step, longer conversations are a widely-cited weak spot** —
   Goodcall specifically is called out for this. Generic FAQ-answering is
   commoditized; state management across a multi-turn order/booking is
   where products actually differentiate.
3. **Vertical specialists outperform generalists on relevance and trust**
   (Slang.ai/Sameday/Numa vs. generic tools) — validates Dhva's own
   decision to launch narrow (one vertical) rather than "hundreds of
   industries" (`docs/architecture-and-roadmap.md` §4).
4. **Escalation quality is the real differentiator, not raw call
   volume.** Every credible reviewer's litmus test is: "what happens when
   the AI can't handle a call?" — name/phone/summary capture plus a clean
   handoff is table stakes; almost nobody surfaces *which* calls were
   uncertain to the business owner afterward, they just log a
   transcript.
5. **HIPAA/compliance claims are murky across nearly the entire
   category** — several vendors' compliance certifications are
   plan-tier-gated or unverified by the reviewers themselves ("verify
   direct BAA before PHI deployment" is a repeated caveat). Not an MVP
   priority for Dhva's current pizza-restaurant vertical, but a real gap
   worth knowing about before expanding into medical/legal.
6. **Pricing opacity** — several vendors' headline per-minute rate
   excludes the LLM/TTS/telephony costs that actually get billed
   separately, making real cost comparison hard for a buyer.

## Where this pass changed Dhva

Finding #4 (escalation quality is the differentiator, and almost nobody
surfaces *which calls were uncertain* to the owner) is the one this build
pass actually acted on: **`calls.needs_review`** (see
`supabase/migrations/0005_review_and_rate_limit.sql`) flags a call the
moment the agent hits real uncertainty — an empty menu search, a failed
order calculation, a failed transfer, or an explicit
`repeated_misunderstanding`/`out_of_scope_request` escalation — and
surfaces it as a filterable dashboard view. Competitors capture the
transcript; none of the reviewed products appear to proactively tell the
owner *"these three calls today need your attention"* as a first-class
surface. That's a real, buildable, defensible difference — not a
marketing claim.

## Explicitly not pursued this pass, and why

- **RAG over uploaded documents/websites** (`<business_knowledge>`'s
  "documents, websites" wishlist) — valuable eventually, but every
  competitor's failure mode above is about *trusting structured data
  correctly*, not about ingesting more of it. Building open-ended
  document RAG before the deterministic path is proven in a real pilot
  would add hallucination surface area, not reduce it. Revisit after
  `docs/PHONE_TEST.md` has actually been run.
- **Native CRM/calendar integrations** (Cal.com, HubSpot, etc., per the
  solopreneur research above) — genuinely valuable, zero architecture
  risk to add later (`agent/src/tools/booking.py` already isolates the
  calendar integration point), but is pure scope, not quality — deferred
  per the roadmap's "don't expand before vertical #1 is proven" rule.
- **Outbound calling / campaigns** — a different product (Bland/Synthflow's
  actual specialty). Dhva's stated mission is inbound-only ("no customer
  lost because nobody answered") — out of scope by design, not oversight.
