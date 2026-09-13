"""
Call summarization — a real LLM call, not string concatenation.

Kept as its own small provider-abstracted module rather than reusing the
AgentSession's LLM plugin instance, because summarization happens AFTER
the conversation session has ended (in the shutdown callback), by which
point the session's streaming LLM connection may already be torn down.
This makes a fresh, one-shot request instead — provider-agnostic via the
same anthropic/openai split used elsewhere.
"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger("dhva.agent.summarize")

SUMMARY_SYSTEM_PROMPT = """You summarize a phone call transcript between an AI receptionist and a caller.
Respond with ONLY a JSON object, no other text, in this exact shape:
{"summary": "<2-3 sentence summary of what happened on the call>", "opportunity_saved": <true or false>}

opportunity_saved should be true if the caller's need was actually addressed
(an order was placed, a booking made, a question genuinely answered, or a
message taken that the business can act on) and false if the call was
abandoned, the caller hung up unsatisfied, or nothing useful happened."""


def _parse_summary_json(raw_text: str) -> tuple[str, bool]:
    # Models occasionally wrap JSON in markdown fences despite instructions;
    # strip those defensively rather than failing the whole summary.
    cleaned = raw_text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    data = json.loads(cleaned)
    return data["summary"], bool(data["opportunity_saved"])


async def generate_call_summary(
    transcript_lines: list[str],
    llm_provider: str,
    llm_model: str,
) -> tuple[str, bool]:
    """
    Returns (summary_text, opportunity_saved). Falls back to a naive
    concatenation (clearly labeled as such) if the LLM call fails or
    returns unparseable output — a degraded summary beats no summary, but
    it must never be silently mistaken for the real thing, which is why
    the fallback text says so explicitly.
    """
    transcript = "\n".join(transcript_lines) or "(no conversation recorded)"

    try:
        if llm_provider == "anthropic":
            summary, opportunity_saved = await _summarize_with_anthropic(transcript, llm_model)
        elif llm_provider == "openai":
            summary, opportunity_saved = await _summarize_with_openai(transcript, llm_model)
        else:
            raise ValueError(f"Unknown LLM provider for summarization: {llm_provider}")
        return summary, opportunity_saved
    except Exception as e:  # noqa: BLE001 — summarization must never crash call finalization
        logger.warning("LLM summarization failed (%s), falling back to raw transcript", e)
        fallback = "[Auto-summary unavailable — raw transcript excerpt] " + transcript[-600:]
        return fallback, len(transcript_lines) > 2  # crude heuristic fallback only


async def _summarize_with_anthropic(transcript: str, model: str) -> tuple[str, bool]:
    import anthropic

    client = anthropic.AsyncAnthropic()  # reads ANTHROPIC_API_KEY from env
    response = await client.messages.create(
        model=model or "claude-sonnet-5",
        max_tokens=300,
        system=SUMMARY_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Transcript:\n{transcript}"}],
    )
    raw_text = "".join(block.text for block in response.content if block.type == "text")
    return _parse_summary_json(raw_text)


async def _summarize_with_openai(transcript: str, model: str) -> tuple[str, bool]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI()  # reads OPENAI_API_KEY from env
    response = await client.chat.completions.create(
        model=model or "gpt-5.5",
        max_tokens=300,
        messages=[
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": f"Transcript:\n{transcript}"},
        ],
    )
    raw_text = response.choices[0].message.content or ""
    return _parse_summary_json(raw_text)
