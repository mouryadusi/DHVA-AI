# Architecture Decisions

Short ADR-style records for decisions worth remembering the reasoning
behind. Full original research/tradeoffs: `docs/architecture-and-roadmap.md`.

## ADR-1: Two separate deployables, not a monolith

**Decision:** Next.js dashboard (Vercel) and Python LiveKit Agents worker
(Railway/Fly/Render) are separate processes sharing only a Postgres database.

**Why:** The voice pipeline needs a persistent process holding a LiveKit
connection open, waiting for job dispatch. Vercel serverless functions are
request/response and cannot do this. Forcing both into one deployable
would mean either running the voice worker somewhere it doesn't belong, or
crippling the dashboard's deploy simplicity to accommodate it.

**Consequence:** No direct API between the two — communication is via
shared tables. See `CLAUDE.md` for the rule this implies (new
cross-process needs become schema changes, not new internal APIs).

## ADR-2: Cascaded pipeline (STT → LLM → TTS), not native speech-to-speech

**Decision:** Deepgram + Claude/GPT + Cartesia/ElevenLabs as separate
stages, not a single native speech-to-speech model (OpenAI Realtime,
Gemini Live).

**Why:** Dhva's core promise depends on reliable tool calling (bookings,
orders) across many business types. Native speech-to-speech models are
faster and more natural-sounding but are a black box for debugging
tool-call failures, and lock you into one vendor's audio path. The latency
cost (roughly 700-900ms vs 300-500ms) is real but was judged worth paying
for observability and provider swappability.

**Revisit if:** tool-calling reliability stops being the bottleneck and
latency becomes the dominant competitive factor.

## ADR-3: LiveKit Agents (self-hosted orchestration), not Vapi/Retell

**Decision:** Build the voice loop on open-source LiveKit Agents rather
than a managed platform.

**Why:** Dhva is meant to be the platform, not a company renting someone
else's voice platform. Vapi/Retell get to market faster (hours vs days)
and include warm transfer as a built-in primitive, but cap how defensible
the core product can become long-term.

**Consequence:** Human transfer (`agent/src/tools/transfer.py`) had to be
built from LiveKit's lower-level SIP transfer primitive instead of getting
it for free — this is the single most failure-prone piece of the MVP as a
direct result (see `docs/TROUBLESHOOTING.md`).

## ADR-4: Telnyx primary, Twilio as documented fallback

**Decision:** Telnyx for telephony/SIP trunking.

**Why:** Meaningfully cheaper at volume, runs its own private network
(lower latency to co-located compute). Twilio remains better-documented
and is the safer choice if a specific enterprise customer requires it —
not implemented in this MVP, just left as an option in the schema
(`phone_numbers.provider` accepts both).

## ADR-5: Business Brain is data, not code

**Decision:** Every piece of business-specific behavior (hours, menu,
policies, personality, escalation rules) is a database row, never a
`if vertical == "X"` branch in application code.

**Why:** This is the entire mechanism by which Dhva can serve "hundreds of
industries" without hundreds of code paths. It also makes the dashboard's
edit forms directly and immediately effective — the agent reads fresh from
Supabase at the start of every call, no redeploy needed.

**Enforcement:** `CLAUDE.md` states this as a hard rule for future changes.

## ADR-6: Deterministic search/order logic, not RAG, for Phase 1

**Decision:** `search_menu` does substring matching over actual rows, not
semantic/vector search; `calculate_order` only accepts real product IDs
and raises rather than guessing.

**Why:** A phone AI hallucinating a price or an unavailable menu item is a
direct trust failure with a real customer on the line. Deterministic logic
is fully debuggable and cannot invent a fact that isn't in the database.
Revisit once there's a large enough product catalog that substring
matching becomes the bottleneck, not before.

## ADR-7: Outcome classification is rule-based, not LLM-judged

**Decision:** `agent/src/outcome.py` classifies `calls.outcome` from which
tools actually succeeded, in a fixed precedence order — not by asking an
LLM to judge the call.

**Why:** This field feeds the "Customer Opportunities Saved" dashboard
metric. A metric that can silently drift because a judge model's opinion
changed between calls is worse than a coarser but fully auditable rule
set. Call summaries (a separate field) DO use an LLM — see ADR-8 — because
prose summarization doesn't have the same "the business trusts this number"
stakes as a metric.

## ADR-8: Call summaries use a fresh one-shot LLM call, not the session's LLM

**Decision:** `agent/src/summarize.py` makes a new Anthropic/OpenAI request
after the call ends, rather than reusing the `AgentSession`'s streaming
LLM connection.

**Why:** Summarization happens in the shutdown callback, by which point
the session (and its LLM connection) may already be torn down. A fresh
request is simpler and more reliable than trying to keep the session's
connection alive past the point the call itself has ended.

**Failure mode, handled explicitly:** if the LLM call fails, the fallback
is a raw transcript excerpt clearly labeled `[Auto-summary unavailable]` —
never silently presented as if it were a real summary.

## Open decisions / explicitly not yet made

- Whether a second vertical shares the Telnyx SIP trunk/dispatch rule
  setup from ADR-4, or needs its own — not decided, not needed until
  there's a second real tenant (`docs/architecture-and-roadmap.md` §4
  argues against expanding verticals before the first one is proven out)
- Whether transfer failures should retry once before falling back to
  "take a message" — currently fails once, immediately, gracefully. No
  evidence yet on whether this is the right tradeoff for real callers.
