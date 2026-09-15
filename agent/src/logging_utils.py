"""
Structured logging for the agent worker.

Replaces ad hoc `logger.info(f"...")` string formatting at the sites that
matter for diagnosing a specific call: every log line here is a single
JSON object with a fixed set of correlation fields, so "grep logs for
call_id=X" or "count LLM_PROVIDER_ERROR in the last hour" are real queries
against structured output, not string-matching against prose.

Deliberately NOT a wrapper around every single log call in the codebase —
routine debug logging (`logger.debug(...)` during development) is left
alone. This is specifically for events an engineer would want to correlate
across a call: start/end, tool executions, and categorized failures.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Optional

from src.errors import ErrorCategory

logger = logging.getLogger("dhva.agent.structured")

# Redact anything that looks like a secret before it can ever reach a log
# line, even if a caller accidentally passes one in `extra`. Matches
# common key patterns (api_key, secret, token, password) case-insensitively.
_SECRET_KEY_PATTERN = re.compile(r"(key|secret|token|password|credential)", re.IGNORECASE)


def _redact(value: dict[str, Any]) -> dict[str, Any]:
    redacted = {}
    for k, v in value.items():
        if _SECRET_KEY_PATTERN.search(k):
            redacted[k] = "***redacted***"
        elif isinstance(v, dict):
            redacted[k] = _redact(v)
        else:
            redacted[k] = v
    return redacted


def log_event(
    event: str,
    *,
    call_id: Optional[str] = None,
    business_id: Optional[str] = None,
    org_id: Optional[str] = None,
    category: Optional[ErrorCategory] = None,
    level: int = logging.INFO,
    **fields: Any,
) -> None:
    """
    event: short machine-readable name, e.g. "call_started", "tool_executed",
    "call_failed" — not a prose sentence. Human-readable detail goes in
    `fields`, e.g. log_event("tool_executed", call_id=cid, tool_name="calculate_order", success=True).
    """
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "call_id": call_id,
        "business_id": business_id,
        "org_id": org_id,
        "error_category": category.value if category else None,
        **_redact(fields),
    }
    # Drop None correlation fields so log lines for browser-test sessions
    # (no business_id resolved yet, etc.) don't carry visual noise.
    record = {k: v for k, v in record.items() if v is not None}
    logger.log(level, json.dumps(record, default=str))


def log_error(
    event: str,
    category: ErrorCategory,
    message: str,
    *,
    call_id: Optional[str] = None,
    business_id: Optional[str] = None,
    **fields: Any,
) -> None:
    log_event(
        event, call_id=call_id, business_id=business_id, category=category,
        level=logging.ERROR, message=message, **fields,
    )
