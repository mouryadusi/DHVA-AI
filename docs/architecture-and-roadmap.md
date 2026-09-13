# Dhva AI — Architecture, MVP, and Roadmap
### Founding CTO working document — September 2026

---

## 0. Framing: what kind of company this actually is

Before architecture: **Dhva AI is a real-time distributed systems company that happens to sell voice.** The AI reasoning is the easy 20%. The hard 80% is telephony, streaming media, sub-second orchestration across five networked services, multi-tenant configuration at scale, and the moment a caller needs a human. Most teams that fail at this fail on the boring half, not the AI half. This document is written with that bias.

I'm also going to push back on scope in a few places, per your instruction not to flatter you. The biggest risk in the brief as written isn't technical — it's **trying to serve "hundreds of industries" before you've proven you can serve one.**

---

## 1. The competitive landscape, honestly assessed

The voice-agent market went from "glued-together demo" to a real category in about 18 months. As of mid-2026, three genuinely different tiers exist:

| Tier | Who | What you get | What you give up |
|---|---|---|---|
| **Managed, no-code-ish** | Vapi, Retell | Phone number ringing in hours, warm transfer built in, dashboards, simulators | You're a thin layer on someone else's platform — hard to differentiate, per-minute economics you don't control, ceiling on customization |
| **Open-source framework, self-hosted** | LiveKit Agents, Pipecat | Full control of the media pipeline, no vendor lock-in, can co-locate compute, defensible over time | You own SIP, WebRTC, turn-detection tuning, observability, and scaling — real infra engineering from day one |
| **Native speech-to-speech (single vendor)** | OpenAI Realtime, Gemini Live | Lowest latency, best prosody, simplest integration (audio in, audio out, one API) | Weaker reasoning/tool-calling reliability than a dedicated LLM layer, harder to swap models, some compliance gaps (e.g., audio isn't yet BAA-eligible on OpenAI as of mid-2026) |

Concretely, on the frameworks: <cite index="11-1">Vapi wins on flexibility and developer ecosystem for a code-led build, while Retell wins on UX for a visual-workflow-led build</cite>. On the infra side, <cite index="11-1">LiveKit's real edge is multimodality — voice and video agents are genuinely better on LiveKit than Vapi or Retell — and it's open source, so if LiveKit disappeared tomorrow your agent still runs on your own infrastructure; the tradeoff is that time-to-first-agent is days, not hours, and operating cost includes a real engineer's attention, not just a subscription</cite>. <cite index="12-1">Pipecat gives the most pipeline-level control for tuning latency and quality; LiveKit gives the most infrastructure-level control, especially self-hosted; Vapi optimizes purely for fast deployment</cite>.

On native speech-to-speech: <cite index="2-1">OpenAI's Realtime API turned voice agents from a stitched STT→LLM→TTS pipeline into one bidirectional model, dropping latency and improving intonation — but it's a model, not a complete voice agent; carrier integration, tool layer, observability, compliance, and transfers are still your code</cite>. One production builder's account is worth taking seriously: <cite index="8-1">the reasoning was clean, latency was under a second, the answer was technically perfect — and the caller hung up at 11 seconds because the voice sounded like a GPS; you can ship an agent that's technically correct and emotionally unlistenable</cite>, which is why the pattern that keeps recurring in production accounts is a **hybrid**: <cite index="8-1">use the frontier realtime model for what it's brilliant at — reasoning, turn detection, tool calling — and swap in a specialist TTS vendor for the voice itself</cite>.

Latency is now table stakes, not a differentiator, across the top of the market: <cite index="13-1">the industry benchmark is sub-800ms end-to-end voice-in to voice-out; leading platforms target 500–600ms; anything above 1.2 seconds feels like a legacy IVR to callers</cite>. The bottleneck has moved: <cite index="29-1">Cartesia, Deepgram, Rime, and ElevenLabs Flash v2.5 all publish sub-100ms time-to-first-byte now — latency is no longer the differentiator at the top of the market; the competitive surface has shifted to emotional control, prosody, multilingual fidelity, and cost</cite>.

**What this means for Dhva:** the "moat" is not going to be raw latency — everyone serious will be under a second within a year. The moat has to be the **business brain**: how well the system understands a specific dentist's cancellation policy, a specific plumber's service radius, a specific restaurant's 86'd items tonight — and how reliably it hands off to a human at exactly the right moment. That's a data/ops problem wearing a voice costume, not a speech problem.

---

## 2. The hardest unsolved problem: human handoff

This deserves its own section because it keeps surfacing across every serious production account and I don't want it buried. <cite index="14-1">"The handoff to a human is the hardest part. A warm transfer that preserves context, transcript, and caller intent is harder to ship than the agent itself... test the handoff with as much rigour as the happy path — it is the moment the agent has already failed, and the caller is already frustrated."</cite>

If Dhva's core promise is "no customer is lost because the business couldn't answer," then the failure mode isn't the AI being dumb — it's the AI being confidently wrong on a call it should have escalated, or dropping context when it does escalate. Design the escalation and handoff system *before* you design the conversational personality. It's the least glamorous 20% of the product and it's the part that actually earns trust with a business owner.

---

## 3. Recommended architecture

### 3.1 Core decision: cascaded pipeline, not native speech-to-speech

Recommend a **cascaded (modular) architecture** — separate STT, LLM/reasoning, and TTS stages — rather than betting the company on a single vendor's native speech-to-speech model. Reasoning:

- Dhva's differentiator is reliable **tool calling** (booking, order-taking, CRM writes) across dozens of business types. Cascaded pipelines let you use the strongest available reasoning model for that job and swap it as the frontier moves, without rewriting your telephony/audio surface. <cite index="3-1">If procurement or product strategy requires keeping options open between model vendors, don't lock the audio path into a single realtime model — a chained pipeline lets you swap LLMs without rewriting the audio surface</cite>.
- Native speech-to-speech is genuinely faster and more natural-sounding, but it's a black box for debugging tool-call failures — and tool-call reliability is your product's core promise, not a nice-to-have.
- The latency cost of cascading is real but shrinking: <cite index="17-1">cascaded managed platforms run roughly 700–900ms end to end today, versus roughly 300–500ms for native speech-to-speech</cite> — a gap that's noticeable but not disqualifying, and it buys you observability and swappability.

Build the orchestration layer on **LiveKit Agents** rather than a fully-managed platform, for one reason: you are the platform company, not a company using a platform. Vapi/Retell are correct answers if you want to *rent* a voice product; they're the wrong foundation if the voice loop itself is meant to become a 10-year defensible asset. <cite index="14-1">LiveKit Agents reached 1.0 with an adaptive turn-detection model considered the best open implementation in the category, native MCP tool support, GA SIP, and phone numbers shipping out of the dashboard — it's the right answer for teams with engineering depth and a path to multi-region deployment</cite>. Keep Pipecat on the shortlist as a lighter-weight fallback if LiveKit's operational overhead proves too heavy early on.

### 3.2 Component recommendations

| Layer | Recommendation | Why |
|---|---|---|
| **Telephony/SIP** | Telnyx primary, Twilio BYOC as fallback/enterprise trust option | <cite index="18-1">Telnyx blends to roughly $0.007/min for US outbound versus Twilio's $0.014 — about half — because it runs its own private global IP network instead of reselling someone else's</cite>. <cite index="20-1">Telnyx co-locates AI inference with its telephony network, so audio hits transcription, LLM, and TTS without leaving the private backbone, keeping compute latency sub-200ms</cite>. Twilio remains the safer enterprise-trust default and has the deeper ecosystem if a specific customer requires it — <cite index="24-1">"both carriers support BYO carrier — you bring your existing termination provider, they handle the AI media-stream side," and "once you're past 50,000 outbound minutes/month, integrate Telnyx as a secondary carrier"</cite> is a reasonable middle path.
| **STT** | Deepgram Nova-3 | Industry-standard low-latency streaming STT with predictable, connection-time pricing rather than volatile token pricing — <cite index="4-1">Deepgram's Growth tier bills at a flat $0.05/min regardless of transcript length, versus token-based pricing where cost scales with prompt size, response length, and conversation history</cite>, which matters a lot once you're running thousands of concurrent business calls with unpredictable conversation lengths.
| **LLM / reasoning** | Model-agnostic behind an abstraction layer; start with a strong tool-calling model (Claude or GPT-class), swap freely | This is the layer where reliability under real-world noise (interruptions, ambiguous requests, adversarial callers) matters most. <cite index="7-1">One frontier model's tool-calling reliability translated into a 26-point lift in call success rate after prompt optimization (95% vs 69%) on a hard adversarial benchmark</cite> in a real production deployment — the point isn't which model, it's that **this number is where your product either works or doesn't**, and you should be benchmarking it continuously, not picking once.
| **TTS** | Cartesia Sonic for latency-sensitive/high-volume flows; ElevenLabs Flash v2.5 for brand-critical or high-empathy verticals (dental, healthcare, sales) | <cite index="32-1">ElevenLabs wins on voice character and emotional range; Cartesia wins on raw end-to-end latency and per-minute cost — picking the wrong one for your use case shows up as either a sluggish-sounding agent or a robot reading from a teleprompter</cite>. Don't pick one company-wide; pick per vertical, and make the voice provider swappable per tenant in the business brain.
| **Orchestration** | LiveKit Agents (self-hosted or LiveKit Cloud initially) | Owns the moat; see 3.1.

### 3.3 The hardest technical problems to solve, ranked by how much they'll actually determine whether Dhva survives

1. **Human handoff with preserved context** (Section 2) — build this second, right after the happy-path conversation loop, not last.
2. **Multi-tenant "business brain" at scale** — every business needs its own knowledge base, rules, tone, and escalation policy, updatable by a non-technical owner. This is a retrieval + configuration UI problem more than an AI problem, and it's where "hundreds of industries" becomes either your moat or your undoing.
3. **Turn-taking and interruption handling.** Increasingly solved off-the-shelf (LiveKit's adaptive turn model, semantic VAD) — don't build this yourself; one production account was explicit that <cite index="8-1">"there's no production scenario where volume-based VAD wins" over semantic VAD</cite>.
4. **Latency budget discipline across five networked hops** (SIP → STT → LLM → tool call → TTS → SIP). Every hop leaks 20–100ms; without a hard sub-800ms budget enforced in CI, this creeps upward silently.
5. **Compliance variance by vertical and geography** — recording-consent law varies by US state alone, before you touch HIPAA (dental/medical) or PCI (any payment-taking flow). This is a legal-review-per-vertical problem, not a one-time audit.
6. **Cost discipline at scale.** Token-based LLM pricing and per-minute vendor stacking compound fast; model the full stack cost per call type before pricing your product, not after.

---

## 4. MVP: recommend narrowing, not the full brief

The brief describes an MVP with business onboarding, phone connection, full conversation, knowledge, FAQs, message-taking, human transfer, call history, and analytics — **across an unspecified number of industries.** That's not an MVP, that's the whole product. Recommend:

- **Pick 1–2 verticals to launch with**, not "hundreds." Home services (plumbers, electricians, HVAC — high call-loss pain, simple booking logic, low compliance risk) is a strong first choice; it's also the exact vertical the brief's own examples lean toward. Dental/medical is the second-best choice for pain intensity but carries HIPAA overhead you don't want in week one — several production teams explicitly <cite index="3-1">launch a non-PHI-adjacent flow first (appointment scheduling that never references diagnoses) and defer the fully compliant hybrid pipeline until it's needed</cite>.
- **10–20 pilot businesses, hand-held onboarding**, not a self-serve signup flow. You need to watch real calls fail before you can generalize the "business brain" schema.
- Ship human handoff and message-taking as **first-class from day one**, not a later feature — see Section 2.

### MVP scope (revised)
1. Business onboarding (manual/white-glove, not self-serve)
2. One phone number per business via Telnyx
3. LiveKit Agents conversation loop: Deepgram STT → LLM with tool calling → Cartesia/ElevenLabs TTS
4. Business brain v0: structured FAQ + hours + services + pricing (no open-ended RAG yet — keep it deterministic while you learn failure modes)
5. Appointment booking as the one deep tool integration (calendar API)
6. Message-taking fallback for anything outside scope
7. Warm handoff to a human phone number, with transcript passed via SMS/email at minimum
8. Call log + "Customer Opportunities Saved" dashboard (see Section 6)

---

## 5. Roadmap

**Phase 0 — Foundation (4–6 weeks).** Architecture spikes: LiveKit Agents + Telnyx SIP integration, latency budget baseline, tool-calling reliability benchmark harness (build this now — you'll rely on it forever). No product code yet.

**Phase 1 — MVP, one vertical (8–12 weeks).** Section 4 scope, 10–20 hand-onboarded businesses, engineers riding shotgun on live calls daily.

**Phase 2 — Vertical #2 and self-serve onboarding (Q+1).** Only expand verticals once vertical #1's business-brain schema and escalation logic are boring and reliable. Build the configuration UI a business owner can use without you.

**Phase 3 — Scale infrastructure (Q+2 to Q+3).** Multi-region LiveKit deployment, cost optimization (evaluate self-hosted STT/TTS at volume vs. vendor), formal compliance program per vertical added, analytics maturity.

**Phase 4 — Platform (year 2+).** Developer API, third-party tool marketplace, outbound + multi-channel (SMS/chat) unification, evaluate owned inference where volume justifies it.

Don't skip ahead to Phase 4 concepts (hardware, research labs, global offices) — they're fine as a 10–20 year picture but shouldn't shape any decision made in the next 12 months.

---

## 6. North Star metric

"Customer Opportunities Saved" is a good north star — it's outcome-based, not activity-based. Instrument it precisely from day one: a call only counts as "saved" if it resulted in a booking, order, qualified lead capture, or successful message relay that a human later confirmed as real. Track supporting metrics alongside it so the north star can't be gamed by a chatty-but-useless agent:

- **Containment rate** (resolved without human) vs. **handoff success rate** (resolved *with* human, cleanly)
- **Call abandonment rate** in the first 15 seconds (the GPS-voice problem from Section 1)
- **Tool-call success rate** under real (not scripted) call conditions

---

## 7. Brutally honest risk summary

- The single biggest execution risk is **scope**, not technology. The brief's ambition (hundreds of industries, millions of users, hardware, labs) is a fine 10–20 year picture and a dangerous week-one plan.
- The single biggest technical risk is **human handoff**, which every serious production account flags as harder than the AI itself and which the brief undersells relative to "conversation intelligence."
- The biggest strategic choice you're making right now, whether or not it feels like one, is **build (LiveKit) vs. rent (Vapi/Retell)**. Rent gets you to market in days; build gets you a defensible company in 18 months. Given the 10–20 year framing in your own brief, build is the right call — but be honest that it means your first pilot businesses go live slower than a Vapi-based competitor's would.

---

*Research basis: vendor documentation and comparative analyses current as of September 2026 (OpenAI, Google, Deepgram, Cartesia, ElevenLabs, Hume, LiveKit, Pipecat, Vapi, Retell, Twilio, Telnyx). Pricing and latency figures move — re-verify before budgeting or committing to a vendor contract.*
