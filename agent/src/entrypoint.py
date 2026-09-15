"""
Dhva AI — LiveKit Agents entrypoint.

This is the process that actually answers calls: a phone call arrives via
the Telnyx <-> LiveKit SIP trunk (docs/TELNYX_SETUP.md) or a browser
connects via /test, LiveKit places them in a room, this worker is
dispatched into that room, and everything below runs.

Run locally:
    cd agent
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env
    python -m src.entrypoint dev      # connects to LiveKit and waits for jobs

Deploy: see agent/README.md — this needs a long-lived process (Railway,
Fly.io, Render, a VM), NOT Vercel serverless functions.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, RoomInputOptions, WorkerOptions, cli, function_tool, RunContext
from livekit.plugins import anthropic, cartesia, deepgram, elevenlabs, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from src.business_brain import BusinessBrain, load_business_brain, build_system_prompt, BusinessBrainNotFound
from src.call_logging import (
    append_message,
    create_call_record,
    finalize_call,
    get_or_create_customer,
    place_order as place_order_db,
    timed_tool_call,
    write_call_summary,
)
from src.outcome import classify_outcome, is_review_worthy_reason
from src.errors import ErrorCategory, categorize_unknown_exception
from src.logging_utils import log_event, log_error
from src.summarize import generate_call_summary
from src.tools.hours import is_open_now, get_business_info
from src.tools.menu import search_menu
from src.tools.order import calculate_order, OrderError
from src.tools.message import format_message_record
from src.tools.transfer import EscalationSignal, decide_escalation, summarize_for_handoff, execute_transfer

load_dotenv()
logger = logging.getLogger("dhva.agent")


def _find_dialed_number(ctx: JobContext) -> Optional[str]:
    """
    Extracts the DID the caller dialed from a SIP participant's attributes.

    STATUS: IMPLEMENTED BUT NOT VERIFIED. LiveKit SIP exposes the trunk's
    phone number on the SIP participant as an attribute, but the exact key
    has moved across SDK versions in the past — confirm the attribute name
    against the LiveKit Agents/SIP version pinned in requirements.txt (see
    https://docs.livekit.io/sip/) before relying on this for a second real
    tenant. `sip.trunkPhoneNumber` is checked first as the most likely
    current key per LiveKit's SIP participant attribute docs, with a
    fallback to a small set of names seen in different SDK versions.
    """
    candidate_keys = ["sip.trunkPhoneNumber", "sip.trunk_phone_number", "sip.calledNumber", "sip.to"]
    for participant in ctx.room.remote_participants.values():
        if not participant.attributes:
            continue
        for key in candidate_keys:
            value = participant.attributes.get(key)
            if value:
                return value
    return None


def resolve_business_id_for_room(ctx: JobContext) -> str:
    """
    Maps an inbound room to a business.

    Real multi-tenant routing: look up the dialed number in `phone_numbers`
    and resolve to its business. Falls back to the single seeded demo
    business ONLY when no dialed number can be determined at all — which
    is the expected, correct case for the browser test page (/test has no
    DID) but should be treated as a routing failure for a real SIP call
    with two or more connected businesses (see docs/TROUBLESHOOTING.md).
    """
    from src.db import get_supabase

    sb = get_supabase()
    dialed_number = _find_dialed_number(ctx)

    if dialed_number:
        result = (
            sb.table("phone_numbers")
            .select("business_id")
            .eq("e164_number", dialed_number)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        if result.data:
            logger.info("Routed call to business %s via dialed number %s", result.data[0]["business_id"], dialed_number)
            return result.data[0]["business_id"]
        logger.warning(
            "Dialed number %s not found in phone_numbers table — falling back to demo business. "
            "This means a real caller reached an unconfigured number.",
            dialed_number,
        )

    # Browser test sessions (no dialed number) and unrouteable SIP calls
    # both land here. Only ever ship this as the sole tenant.
    result = sb.table("businesses").select("id").eq("slug", "dhva-pizza").limit(1).execute()
    if not result.data:
        raise BusinessBrainNotFound(
            "No business with slug 'dhva-pizza' found. If this is a fresh Supabase project, "
            "sign up through the app once — a starter business is now auto-provisioned "
            "(supabase/migrations/0003_fix_onboarding.sql)."
        )
    return result.data[0]["id"]


def build_stt(brain: BusinessBrain):
    """
    Multilingual note: Deepgram Nova-3 supports a `language` parameter
    (ISO 639-1 code, or "multi" for automatic language detection across a
    supported subset of languages). We pass the business's configured
    `agent.language` through directly. STATUS: IMPLEMENTED BUT NOT
    VERIFIED — confirm the exact set of codes Nova-3 accepts against
    current Deepgram docs before configuring a non-English business; an
    unsupported code should fail loudly at worker startup, not silently
    degrade transcription quality mid-call.
    """
    language = brain.agent.language or "en"
    return deepgram.STT(model="nova-3", language=language)


def build_llm(brain: BusinessBrain):
    if brain.agent.llm_provider == "anthropic":
        return anthropic.LLM(model=brain.agent.llm_model or "claude-sonnet-5")
    if brain.agent.llm_provider == "openai":
        return openai.LLM(model=brain.agent.llm_model or "gpt-5.5")
    raise ValueError(f"Unknown LLM provider: {brain.agent.llm_provider}")


def build_tts(brain: BusinessBrain):
    if brain.agent.tts_provider == "cartesia":
        return cartesia.TTS(voice=brain.agent.tts_voice_id) if brain.agent.tts_voice_id else cartesia.TTS()
    if brain.agent.tts_provider == "elevenlabs":
        return (
            elevenlabs.TTS(voice_id=brain.agent.tts_voice_id)
            if brain.agent.tts_voice_id
            else elevenlabs.TTS()
        )
    raise ValueError(f"Unknown TTS provider: {brain.agent.tts_provider}")


class DhvaAgent(Agent):
    """
    One instance per call. Holds the call_id and brain as instance state so
    tool methods can log against the right row without threading extra
    params through the LLM's function-calling interface.

    `transfer_fn` is injected from entrypoint() rather than constructed
    here because executing a real SIP transfer needs the LiveKitAPI client
    and room/participant identity, which live in JobContext, not on the
    Agent instance — see entrypoint() for what it actually does.
    """

    def __init__(self, brain: BusinessBrain, call_id: str, transfer_fn, customer_id: Optional[str] = None):
        super().__init__(instructions=build_system_prompt(brain))
        self.brain = brain
        self.call_id = call_id
        self.customer_id = customer_id
        self._transfer_fn = transfer_fn
        self._message_sequence = 0
        self._transcript_lines: list[str] = []
        self.tool_calls: list[dict] = []  # feeds classify_outcome() after the call
        self.review_signals: list[str] = []  # feeds needs_review — see docs/COMPETITIVE_ANALYSIS.md
        self.transferred = False
        self.transfer_reason: Optional[str] = None

    def _log_turn(self, role: str, content: str) -> None:
        self._message_sequence += 1
        append_message(self.call_id, role, content, self._message_sequence)
        self._transcript_lines.append(f"{role}: {content}")

    def _record_tool_call(self, tool_name: str, success: bool) -> None:
        self.tool_calls.append({"tool_name": tool_name, "success": success})

    @function_tool
    async def get_business_hours(self, context: RunContext) -> dict:
        """Use this whenever the caller asks if the business is open, or what the hours are."""
        with timed_tool_call(self.call_id, "get_business_hours", {}) as record:
            result = is_open_now(self.brain)
            record["output"] = result
        self._record_tool_call("get_business_hours", success=True)
        return result

    @function_tool
    async def get_business_info(self, context: RunContext) -> dict:
        """Use this for general questions about the business — description, policies, delivery area, etc."""
        with timed_tool_call(self.call_id, "get_business_info", {}) as record:
            result = get_business_info(self.brain)
            record["output"] = result
        self._record_tool_call("get_business_info", success=True)
        return result

    @function_tool
    async def search_menu(self, context: RunContext, query: str) -> list[dict]:
        """Search the menu/services for items matching the caller's request. Use an empty query to list everything."""
        with timed_tool_call(self.call_id, "search_menu", {"query": query}) as record:
            result = search_menu(self.brain, query)
            record["output"] = {"count": len(result)}
        self._record_tool_call("search_menu", success=True)
        if query and len(result) == 0:
            # Not a tool failure (the tool worked correctly), but a real
            # signal the caller asked for something outside what this
            # business offers — exactly the class of call
            # docs/COMPETITIVE_ANALYSIS.md finding #1 says every serious
            # reviewer explicitly stress-tests for.
            self.review_signals.append(f"No menu/service match for caller request: \"{query}\"")
        return result

    @function_tool
    async def calculate_order(self, context: RunContext, items: list[dict]) -> dict:
        """
        Calculate the total for an order. items: list of {"product_id": str, "quantity": int}.
        Only use product_ids returned by search_menu — never guess an id.
        """
        with timed_tool_call(self.call_id, "calculate_order", {"items": items}) as record:
            try:
                result = calculate_order(self.brain, items)
                record["output"] = result
                self._record_tool_call("calculate_order", success=True)
                return result
            except OrderError as e:
                # Explicit override, not a swallowed exception — see
                # timed_tool_call's docstring. Previously this branch
                # returned without re-raising, which meant the failure was
                # (incorrectly) persisted to tool_executions as success=true.
                record["success"] = False
                record["error_message"] = str(e)
                record["error_category"] = ErrorCategory.VALIDATION_ERROR.value
                record["output"] = {"error": str(e)}
                self._record_tool_call("calculate_order", success=False)
                self.review_signals.append(f"Order calculation failed: {e}")
                return {"error": str(e)}

    @function_tool
    async def place_order(
        self, context: RunContext, items: list[dict], fulfillment_type: str = "pickup"
    ) -> dict:
        """
        Actually places the order — only call this AFTER the caller has
        explicitly confirmed the items and total from calculate_order.
        items: list of {"product_id": str, "quantity": int}.
        fulfillment_type: "pickup" or "delivery".

        Re-validates prices server-side from the current menu rather than
        trusting any total mentioned earlier in the conversation. Never
        tell the caller their order is placed until this tool returns
        status "confirmed" — if it returns "failed", apologize and offer
        to take a message instead; do not claim success.
        """
        with timed_tool_call(
            self.call_id, "place_order", {"items": items, "fulfillment_type": fulfillment_type}
        ) as record:
            try:
                calc = calculate_order(self.brain, items)  # authoritative re-check, never reused from earlier
            except OrderError as e:
                record["success"] = False
                record["error_message"] = str(e)
                record["error_category"] = ErrorCategory.VALIDATION_ERROR.value
                record["output"] = {"error": str(e)}
                self._record_tool_call("place_order", success=False)
                self.review_signals.append(f"place_order rejected by validation: {e}")
                return {
                    "status": "failed",
                    "message": f"Could not place the order: {e}. Do not tell the caller it succeeded.",
                }

            safe_fulfillment = fulfillment_type if fulfillment_type in ("pickup", "delivery") else "pickup"

            try:
                order_id = place_order_db(
                    business_id=self.brain.business_id,
                    call_id=self.call_id,
                    customer_id=self.customer_id,
                    line_items=calc["line_items"],
                    total_cents=calc["total_cents"],
                    fulfillment_type=safe_fulfillment,
                )
            except Exception as e:  # noqa: BLE001 — a DB write failure here must not crash the call
                record["success"] = False
                record["error_message"] = str(e)
                record["error_category"] = ErrorCategory.DATABASE_ERROR.value
                record["output"] = {"error": str(e)}
                self._record_tool_call("place_order", success=False)
                self.review_signals.append(f"place_order DB write failed: {e}")
                return {
                    "status": "failed",
                    "message": "The order could not be saved due to a system error. Apologize, and "
                    "offer to take a message with the order details instead. "
                    "Do not tell the caller the order was placed.",
                }

            record["output"] = {"order_id": order_id, "total_cents": calc["total_cents"]}
            self._record_tool_call("place_order", success=True)
            return {
                "status": "confirmed",
                "order_id": order_id,
                "total_cents": calc["total_cents"],
                "message": f"Order confirmed. Reference number: {order_id[:8]}.",
            }

    @function_tool
    async def take_message(self, context: RunContext, caller_name: str | None, message: str) -> dict:
        """Use this when the caller wants to leave a message rather than complete an action now."""
        with timed_tool_call(self.call_id, "take_message", {"caller_name": caller_name, "message": message}) as record:
            result = format_message_record(caller_name, message)
            record["output"] = result
        self._record_tool_call("take_message", success=True)
        return {"status": "message recorded"}

    @function_tool
    async def request_human_transfer(self, context: RunContext, reason: str) -> dict:
        """
        Use this when the caller explicitly asks for a human, is upset, or
        you are not confident you can correctly help them. `reason` should
        be one of: caller_requests_human, out_of_scope_request,
        low_confidence_tool_call, repeated_misunderstanding, angry_sentiment,
        explicit_compliance_topic.
        """
        with timed_tool_call(self.call_id, "request_human_transfer", {"reason": reason}) as record:
            signal = EscalationSignal(trigger=reason, confidence=1.0)  # explicit tool call = full confidence
            configured = ["caller_requests_human", "low_confidence_tool_call", "angry_sentiment"]
            decision = decide_escalation([signal], configured)

            # An explicit request to escalate because the agent is
            # confused or the request is out of scope is itself a review
            # signal, independent of whether the transfer succeeds —
            # docs/COMPETITIVE_ANALYSIS.md finding #4.
            if is_review_worthy_reason(reason):
                self.review_signals.append(f"Agent escalated due to: {reason}")

            if decision is None:
                record["output"] = {"transferred": False, "reason": "trigger not configured for escalation"}
                record["success"] = False
                record["error_category"] = ErrorCategory.VALIDATION_ERROR.value
                record["error_message"] = f"Escalation trigger '{reason}' is not configured for this business"
                self._record_tool_call("request_human_transfer", success=False)
                return {"status": "cannot_transfer", "message": "Continue helping the caller yourself."}

            if not self.brain.agent.escalation_phone_number:
                record["output"] = {"transferred": False, "reason": "no escalation number configured"}
                record["success"] = False
                record["error_category"] = ErrorCategory.ONBOARDING_ERROR.value
                record["error_message"] = "No escalation_phone_number configured for this business"
                self._record_tool_call("request_human_transfer", success=False)
                self.review_signals.append("Caller needed human transfer but no transfer number is configured")
                return {
                    "status": "cannot_transfer",
                    "message": "No human transfer number is configured for this business right now — offer to take a message instead.",
                }

            summary = summarize_for_handoff(self._transcript_lines, decision)
            transfer_succeeded = await self._transfer_fn(self.brain.agent.escalation_phone_number, summary)

            record["output"] = {"transferred": transfer_succeeded, "summary": summary}
            record["success"] = transfer_succeeded
            if not transfer_succeeded:
                record["error_category"] = ErrorCategory.TELEPHONY_ERROR.value
                record["error_message"] = "SIP transfer did not complete — see agent worker logs for the specific exception"
            self._record_tool_call("request_human_transfer", success=transfer_succeeded)

            if transfer_succeeded:
                self.transferred = True
                self.transfer_reason = reason
                return {"status": "transferred", "reason": reason}

            self.review_signals.append(f"Transfer attempt failed (reason: {reason})")
            return {
                "status": "transfer_failed",
                "message": "The transfer didn't go through — apologize briefly and offer to take a message instead.",
            }


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    business_id = resolve_business_id_for_room(ctx)
    brain = await load_business_brain(business_id)

    # Resolve caller phone number: for SIP participants LiveKit exposes
    # this via participant attributes (sip.phoneNumber); for browser test
    # sessions there is no phone number.
    from_number = None
    sip_participant_identity = None
    for identity, p in ctx.room.remote_participants.items():
        phone = p.attributes.get("sip.phoneNumber") if p.attributes else None
        if phone:
            from_number = phone
            sip_participant_identity = identity
            break

    customer_id = get_or_create_customer(business_id, from_number) if from_number else None
    call_id = create_call_record(
        business_id=business_id,
        livekit_room_name=ctx.room.name,
        direction="inbound",
        from_number=from_number,
        customer_id=customer_id,
    )
    log_event(
        "call_started", call_id=call_id, business_id=business_id,
        room_name=ctx.room.name, has_caller_number=from_number is not None,
    )

    call_start = time.monotonic()

    async def transfer_fn(transfer_to_number: str, summary: str) -> bool:
        """
        Executes a real SIP transfer. Returns False (never raises) on any
        failure so the caller always gets a graceful fallback instead of a
        crashed call — see request_human_transfer's handling of a False result.

        STATUS: IMPLEMENTED BUT NOT VERIFIED. `transfer_sip_participant`'s
        exact signature is version-sensitive — see the warning in
        src/tools/transfer.py::execute_transfer. Test this against a real
        call before trusting it in production; if it's wrong, the caller
        will hear "the transfer didn't go through" (handled gracefully)
        rather than experiencing a dropped call, which is the intended
        fail-safe direction.
        """
        if not sip_participant_identity:
            log_event(
                "transfer_skipped", call_id=call_id, business_id=business_id,
                reason="no_sip_participant", level=logging.WARNING,
            )
            return False
        try:
            from livekit import api as lk_api

            async with lk_api.LiveKitAPI() as lkapi:  # reads LIVEKIT_URL/KEY/SECRET from env
                success = await execute_transfer(
                    livekit_api=lkapi,
                    room_name=ctx.room.name,
                    sip_participant_identity=sip_participant_identity,
                    transfer_to_number=transfer_to_number,
                )
            log_event(
                "transfer_attempted", call_id=call_id, business_id=business_id,
                success=success, transfer_to_number=transfer_to_number,
            )
            return success
        except Exception as e:
            log_error(
                "transfer_raised_exception", ErrorCategory.TELEPHONY_ERROR, str(e),
                call_id=call_id, business_id=business_id,
            )
            return False

    agent = DhvaAgent(brain=brain, call_id=call_id, transfer_fn=transfer_fn, customer_id=customer_id)

    session = AgentSession(
        stt=build_stt(brain),
        llm=build_llm(brain),
        tts=build_tts(brain),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    # Log every finalized user/assistant turn to call_messages so the
    # dashboard transcript (app/(dashboard)/dashboard/calls/[id]) is real.
    @session.on("conversation_item_added")
    def _on_item(event):  # noqa: ANN001 — event type per livekit-agents SDK
        item = event.item
        if item.role in ("user", "assistant") and item.text_content:
            agent._log_turn(item.role, item.text_content)

    async def _finalize(reason: str) -> None:
        duration = int(time.monotonic() - call_start)
        outcome = classify_outcome(agent.tool_calls, transferred=agent.transferred)

        needs_review = reason == "failed" or len(agent.review_signals) > 0
        review_reason = (
            "Call failed to complete cleanly — see agent worker logs."
            if reason == "failed"
            else ("; ".join(agent.review_signals)[:500] if agent.review_signals else None)
        )

        finalize_call(
            call_id=call_id,
            status="completed" if reason == "completed" else "failed",
            outcome=outcome,
            duration_seconds=duration,
            transferred=agent.transferred,
            transfer_reason=agent.transfer_reason,
            needs_review=needs_review,
            review_reason=review_reason,
        )
        log_event(
            "call_finalized", call_id=call_id, business_id=business_id,
            status=reason, outcome=outcome, duration_seconds=duration,
            transferred=agent.transferred, needs_review=needs_review,
        )

        summary_text, opportunity_saved = await generate_call_summary(
            transcript_lines=agent._transcript_lines,
            llm_provider=brain.agent.llm_provider,
            llm_model=brain.agent.llm_model,
        )
        write_call_summary(call_id, summary_text, opportunity_saved=opportunity_saved)

    # JobContext's documented shutdown hook — fires when the room/job ends
    # (caller hangs up, participant disconnects, etc). STATUS: IMPLEMENTED
    # BUT NOT VERIFIED — confirm add_shutdown_callback's exact signature
    # (sync vs async callback support) against the livekit-agents version
    # pinned in requirements.txt; this has moved across SDK versions.
    ctx.add_shutdown_callback(lambda: _finalize("completed"))

    try:
        await session.start(
            room=ctx.room,
            agent=agent,
            room_input_options=RoomInputOptions(),
        )
        await session.generate_reply(instructions=f"Greet the caller with: {brain.agent.greeting}")
    except Exception as e:
        category = categorize_unknown_exception(e, context="session.start")
        log_error(
            "call_failed_to_start", category, str(e),
            call_id=call_id, business_id=business_id,
        )
        # Never let the caller hit dead air or a raw error — attempt one
        # last spoken message before tearing the session down. If even
        # this fails (e.g. TTS provider is also down), there's nothing
        # further to do gracefully; the call simply ends.
        try:
            await session.say(
                "I'm sorry, I'm having trouble connecting right now. "
                "Please try calling back in a few minutes."
            )
        except Exception as fallback_error:
            log_error(
                "fallback_spoken_message_also_failed", ErrorCategory.TTS_ERROR, str(fallback_error),
                call_id=call_id, business_id=business_id,
            )
        await _finalize("failed")
        return


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
