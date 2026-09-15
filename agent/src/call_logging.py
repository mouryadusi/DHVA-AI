"""
Call logging.

Every function here writes directly to the tables the dashboard reads
(app/(dashboard)/dashboard/calls/*). There is no intermediate API — the
agent worker and the Next.js app share a database, not a service boundary,
which is the simplest correct design for a single-process-per-call worker
talking to Postgres.
"""
from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Optional

from src.db import get_supabase


def get_or_create_customer(business_id: str, phone_number: str, name: Optional[str] = None) -> str:
    sb = get_supabase()
    existing = (
        sb.table("customers")
        .select("id")
        .eq("business_id", business_id)
        .eq("phone_number", phone_number)
        .limit(1)
        .execute()
    )
    if existing.data:
        customer_id = existing.data[0]["id"]
        sb.table("customers").update({"last_contact_at": "now()"}).eq("id", customer_id).execute()
        return customer_id

    created = (
        sb.table("customers")
        .insert({"business_id": business_id, "phone_number": phone_number, "name": name})
        .execute()
    )
    return created.data[0]["id"]


def create_call_record(
    business_id: str,
    livekit_room_name: str,
    direction: str = "inbound",
    from_number: Optional[str] = None,
    to_number: Optional[str] = None,
    customer_id: Optional[str] = None,
) -> str:
    sb = get_supabase()
    row = (
        sb.table("calls")
        .insert(
            {
                "business_id": business_id,
                "livekit_room_name": livekit_room_name,
                "direction": direction,
                "from_number": from_number,
                "to_number": to_number,
                "customer_id": customer_id,
                "status": "in_progress",
            }
        )
        .execute()
    )
    return row.data[0]["id"]


def append_message(call_id: str, role: str, content: str, sequence: int) -> None:
    sb = get_supabase()
    sb.table("call_messages").insert(
        {"call_id": call_id, "role": role, "content": content, "sequence": sequence}
    ).execute()


def log_tool_execution(
    call_id: str,
    tool_name: str,
    input_json: dict[str, Any],
    output_json: Optional[dict[str, Any]],
    success: bool,
    error_message: Optional[str] = None,
    latency_ms: Optional[int] = None,
    error_category: Optional[str] = None,
) -> None:
    sb = get_supabase()
    sb.table("tool_executions").insert(
        {
            "call_id": call_id,
            "tool_name": tool_name,
            "input_json": input_json,
            "output_json": output_json,
            "success": success,
            "error_message": error_message,
            "latency_ms": latency_ms,
            "error_category": error_category,
        }
    ).execute()


def finalize_call(
    call_id: str,
    status: str,
    outcome: Optional[str],
    duration_seconds: int,
    transferred: bool = False,
    transfer_reason: Optional[str] = None,
    needs_review: bool = False,
    review_reason: Optional[str] = None,
) -> None:
    sb = get_supabase()
    sb.table("calls").update(
        {
            "status": status,
            "outcome": outcome,
            "ended_at": "now()",
            "duration_seconds": duration_seconds,
            "transferred": transferred,
            "transfer_reason": transfer_reason,
            "needs_review": needs_review,
            "review_reason": review_reason,
        }
    ).eq("id", call_id).execute()


def write_call_summary(call_id: str, summary_text: str, opportunity_saved: bool) -> None:
    sb = get_supabase()
    sb.table("call_summaries").insert(
        {"call_id": call_id, "summary_text": summary_text, "opportunity_saved": opportunity_saved}
    ).execute()


def place_order(
    business_id: str,
    call_id: str,
    customer_id: Optional[str],
    line_items: list[dict[str, Any]],
    total_cents: int,
    fulfillment_type: str = "pickup",
    notes: Optional[str] = None,
) -> str:
    """
    Persists a real order record. Called from the `place_order` tool
    (agent/src/entrypoint.py) AFTER server-side re-validation via
    agent/src/tools/order.py::calculate_order — never called with a total
    the LLM computed or claimed itself. Returns the order id, which is
    also usable as a caller-facing reference number.
    """
    sb = get_supabase()
    order = (
        sb.table("orders")
        .insert(
            {
                "business_id": business_id,
                "call_id": call_id,
                "customer_id": customer_id,
                "fulfillment_type": fulfillment_type,
                "total_cents": total_cents,
                "notes": notes,
            }
        )
        .execute()
    )
    order_id = order.data[0]["id"]

    sb.table("order_items").insert(
        [
            {
                "order_id": order_id,
                "product_id": li["product_id"],
                "product_name": li["name"],
                "unit_price_cents": li["unit_price_cents"],
                "quantity": li["quantity"],
                "line_total_cents": li["line_total_cents"],
            }
            for li in line_items
        ]
    ).execute()

    return order_id


@contextmanager
def timed_tool_call(call_id: str, tool_name: str, input_json: dict[str, Any]):
    """
    Usage:
        with timed_tool_call(call_id, "search_menu", {"query": q}) as record:
            result = do_the_thing()
            record["output"] = result
    Automatically logs success/failure and latency to tool_executions.

    By default, success/failure is inferred from whether an exception
    propagated out of the `with` block. Some tool outcomes are legitimate
    failures without an exception (e.g. "no escalation number configured" —
    the tool ran correctly and determined the action can't be taken) — set
    record["success"] = False explicitly for these, plus optionally
    record["error_category"] (an ErrorCategory value) and
    record["error_message"]. This was added specifically because several
    call sites were catching their own exceptions internally and returning
    without re-raising, which meant this context manager's except branch
    never fired and the failure got persisted to tool_executions as
    success=true — a real bug found during a fresh audit, not a
    hypothetical one. If you're tempted to catch-and-swallow inside a
    `with timed_tool_call(...)` block, use the explicit override instead.
    """
    t0 = time.monotonic()
    record: dict[str, Any] = {"output": None, "error_category": None, "success": None, "error_message": None}
    exception_message: Optional[str] = None
    try:
        yield record
    except Exception as e:  # noqa: BLE001 — intentionally broad; this is a logging boundary
        exception_message = str(e)
        if record.get("error_category") is None:
            from src.errors import categorize_unknown_exception

            record["error_category"] = categorize_unknown_exception(e, context=tool_name).value
        raise
    finally:
        latency_ms = int((time.monotonic() - t0) * 1000)
        explicit_success = record.get("success")
        success = explicit_success if explicit_success is not None else (exception_message is None)
        error_message = exception_message or (None if success else record.get("error_message"))
        log_tool_execution(
            call_id=call_id,
            tool_name=tool_name,
            input_json=input_json,
            output_json=record.get("output"),
            success=success,
            error_message=error_message,
            latency_ms=latency_ms,
            error_category=record.get("error_category") if not success else None,
        )
