"""take_message tool — the safety net: any call that can't be fully resolved lands here."""
from __future__ import annotations


def format_message_record(caller_name: str | None, message: str) -> dict:
    return {
        "caller_name": caller_name,
        "message": message.strip(),
    }
