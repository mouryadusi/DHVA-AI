"""
Outcome classification for the `calls.outcome` column.

Deliberately deterministic and rule-based, not LLM-judged — the outcome
feeds the dashboard's "Customer Opportunities Saved" metric
(docs/architecture-and-roadmap.md §6), and a metric that can silently
drift because an LLM's judgment call changed is worse than a slightly
coarser rule-based one that's auditable. If you need finer-grained
outcomes later, add rules here, don't swap in an LLM judge without a
strong reason.
"""
from __future__ import annotations

REVIEW_WORTHY_ESCALATION_REASONS = {"repeated_misunderstanding", "out_of_scope_request", "explicit_compliance_topic"}


def is_review_worthy_reason(reason: str) -> bool:
    """
    Pure predicate extracted specifically so it's unit-testable without
    livekit-agents installed — the call site (DhvaAgent.request_human_transfer
    in entrypoint.py) can't be unit tested directly since it subclasses the
    Agent base class.
    """
    return reason in REVIEW_WORTHY_ESCALATION_REASONS


CallOutcome = str  # matches the `calls.outcome` check constraint


def classify_outcome(tool_calls: list[dict], transferred: bool) -> CallOutcome | None:
    """
    tool_calls: [{"tool_name": str, "success": bool}, ...] in call order —
    the same shape logged to `tool_executions`.

    Precedence matters: a transfer or a completed order/booking is a
    stronger signal than "we just answered a question," which is stronger
    than nothing happening at all.
    """
    tool_names_succeeded = {t["tool_name"] for t in tool_calls if t.get("success")}

    if transferred:
        return "transferred"
    if "calculate_order" in tool_names_succeeded:
        return "order_placed"
    if "take_message" in tool_names_succeeded:
        return "message_taken"
    if tool_names_succeeded & {"get_business_hours", "get_business_info", "search_menu"}:
        return "answered_faq"
    if not tool_calls:
        return "abandoned"
    return None  # tools ran but none matched a known outcome pattern — leave for manual review
