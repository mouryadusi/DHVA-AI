"""
Error taxonomy for the agent worker.

Purpose: right now, failures are logged ad hoc (`logger.exception(...)`,
free-text messages) with no consistent category. Given a call_id, an
engineer currently has to read prose log lines to guess what kind of
failure happened. This module makes the failure type a first-class,
queryable value instead — it's what `tool_executions.error_category`
(migration 0007) is populated from, and what `logging_utils.py`'s
structured logger uses as its primary filter dimension.

Deliberately a flat, fixed set of 14 categories, not an open string — the
whole point is that "search tool_executions where error_category =
'LLM_PROVIDER_ERROR'" is a real, reliable query, which it can't be if
category strings drift per call site.
"""
from __future__ import annotations

from enum import Enum


class ErrorCategory(str, Enum):
    AUTH_ERROR = "AUTH_ERROR"
    AUTHORIZATION_ERROR = "AUTHORIZATION_ERROR"
    TENANT_ACCESS_DENIED = "TENANT_ACCESS_DENIED"
    ONBOARDING_ERROR = "ONBOARDING_ERROR"
    DATABASE_ERROR = "DATABASE_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    LLM_TIMEOUT = "LLM_TIMEOUT"
    LLM_PROVIDER_ERROR = "LLM_PROVIDER_ERROR"
    TOOL_ERROR = "TOOL_ERROR"
    STT_ERROR = "STT_ERROR"
    TTS_ERROR = "TTS_ERROR"
    TELEPHONY_ERROR = "TELEPHONY_ERROR"
    LIVEKIT_ERROR = "LIVEKIT_ERROR"
    INTEGRATION_ERROR = "INTEGRATION_ERROR"


class DhvaError(Exception):
    """
    Raise this (or a call-site-specific subclass) instead of a bare
    Exception anywhere the failure type is known at the raise site. Code
    that only catches `Exception` generically (provider SDK calls, mostly)
    should categorize at the catch site instead — see
    `categorize_unknown_exception` below for that path.
    """

    def __init__(self, category: ErrorCategory, message: str, *, safe_for_caller: bool = False):
        super().__init__(message)
        self.category = category
        self.message = message
        # Whether `message` is safe to speak back to the caller verbatim.
        # Default False — provider/DB error text often contains internal
        # details (stack traces, connection strings, vendor error codes)
        # that shouldn't reach a customer on the phone. Callers of this
        # exception should use a generic spoken fallback unless this is True.
        self.safe_for_caller = safe_for_caller


def categorize_unknown_exception(exc: Exception, *, context: str) -> ErrorCategory:
    """
    Best-effort categorization for exceptions raised by third-party SDKs
    (Deepgram/Cartesia/ElevenLabs/Anthropic/OpenAI/Supabase/LiveKit clients),
    which don't raise DhvaError. `context` is a short hint about which
    stage of the pipeline the exception came from — this is a heuristic,
    not a guarantee; when in doubt it falls back to TOOL_ERROR rather than
    guessing wrong into a misleading specific category.
    """
    context = context.lower()
    exc_name = type(exc).__name__.lower()

    if "timeout" in exc_name or "timeout" in str(exc).lower():
        if "llm" in context:
            return ErrorCategory.LLM_TIMEOUT
    if "stt" in context or "deepgram" in context:
        return ErrorCategory.STT_ERROR
    if "tts" in context or "cartesia" in context or "elevenlabs" in context:
        return ErrorCategory.TTS_ERROR
    if "llm" in context or "anthropic" in context or "openai" in context:
        return ErrorCategory.LLM_PROVIDER_ERROR
    if "livekit" in context or "sip" in context or "transfer" in context:
        return ErrorCategory.TELEPHONY_ERROR if "transfer" in context else ErrorCategory.LIVEKIT_ERROR
    if "supabase" in context or "database" in context or "db" in context:
        return ErrorCategory.DATABASE_ERROR
    return ErrorCategory.TOOL_ERROR
