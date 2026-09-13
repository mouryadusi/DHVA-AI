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


@contextmanager
def timed_tool_call(call_id: str, tool_name: str, input_json: dict[str, Any]):
    """
    Usage:
        with timed_tool_call(call_id, "search_menu", {"query": q}) as record:
            result = do_the_thing()
            record["output"] = result
    Automatically logs success/failure and latency to tool_executions.
    """
    t0 = time.monotonic()
    record: dict[str, Any] = {"output": None}
    error: Optional[str] = None
    try:
        yield record
    except Exception as e:  # noqa: BLE001 — intentionally broad; this is a logging boundary
        error = str(e)
        raise
    finally:
        latency_ms = int((time.monotonic() - t0) * 1000)
        log_tool_execution(
            call_id=call_id,
            tool_name=tool_name,
            input_json=input_json,
            output_json=record.get("output"),
            success=error is None,
            error_message=error,
            latency_ms=latency_ms,
        )
