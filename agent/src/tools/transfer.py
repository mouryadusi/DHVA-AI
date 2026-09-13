"""
request_human_transfer tool.

Per docs/architecture-and-roadmap.md §2, this is the highest-scrutiny piece
of the whole agent. decide_escalation() is pure and unit-tested
(agent/tests/test_tools.py); execute_transfer() does the actual LiveKit SIP
transfer and is intentionally isolated so it can be swapped/mocked without
touching the decision logic.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

ALLOWED_TRIGGERS = {
    "caller_requests_human",
    "out_of_scope_request",
    "low_confidence_tool_call",
    "repeated_misunderstanding",
    "angry_sentiment",
    "explicit_compliance_topic",
}


@dataclass
class EscalationSignal:
    trigger: str
    confidence: float
    detail: Optional[str] = None


def decide_escalation(
    signals: list[EscalationSignal],
    configured_triggers: list[str],
    confidence_threshold: float = 0.6,
) -> Optional[EscalationSignal]:
    eligible = [
        s
        for s in signals
        if s.trigger in ALLOWED_TRIGGERS
        and s.trigger in configured_triggers
        and s.confidence >= confidence_threshold
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda s: s.confidence)


def summarize_for_handoff(transcript_lines: list[str], escalation: EscalationSignal) -> str:
    """
    TODO(post-MVP): replace with an LLM-generated summary call, benchmarked
    in agent/benchmarks/ like any other tool output — a bad handoff summary
    costs the business as much as a bad booking. The MVP uses a trimmed raw
    transcript so the human receiving the transfer at least has real
    context rather than nothing, which is the honest fallback per
    docs/architecture-and-roadmap.md §2's "cold transfer is worse than no AI."
    """
    recent = "\n".join(transcript_lines[-12:])  # last ~12 lines as a crude window
    return f"[Escalation: {escalation.trigger}] Recent conversation:\n{recent}"


async def execute_transfer(
    livekit_api,  # livekit.api.LiveKitAPI instance, passed in from entrypoint.py
    room_name: str,
    sip_participant_identity: str,
    transfer_to_number: str,
) -> bool:
    """
    Performs a SIP REFER-style transfer of the caller to a human number
    using LiveKit's SIP transfer API.

    IMPORTANT — verify against the LiveKit SDK version pinned in
    requirements.txt before relying on this in production; the SIP
    transfer method name/signature has moved between SDK versions and
    should be confirmed against current docs.livekit.io/sip at
    implementation time, not assumed from this comment.
    """
    from livekit import api as lk_api  # local import: only needed when actually transferring

    try:
        await livekit_api.sip.transfer_sip_participant(
            lk_api.TransferSIPParticipantRequest(
                room_name=room_name,
                participant_identity=sip_participant_identity,
                transfer_to=f"tel:{transfer_to_number}",
            )
        )
        return True
    except Exception:
        # Transfer failure must never crash the call — caller falls back to
        # take_message. Caller-facing error handling happens in entrypoint.py.
        return False
