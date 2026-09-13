"""get_business_hours / get_business_info tool logic — pure functions, no I/O, easy to unit test."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from src.business_brain import BusinessBrain

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def is_open_now(brain: BusinessBrain, at: datetime | None = None) -> dict:
    """
    Returns whether the business is open right now in its own timezone, plus
    a human-readable hours line for today. `at` is injectable for testing;
    defaults to real current time.
    """
    tz = ZoneInfo(brain.timezone)
    now = (at or datetime.now(tz)).astimezone(tz)
    # Python's Monday=0..Sunday=6; our schema uses Sunday=0..Saturday=6 (SQL convention).
    sql_dow = (now.weekday() + 1) % 7

    today = next((h for h in brain.hours if h.day_of_week == sql_dow), None)
    if today is None or today.is_closed or not today.open_time or not today.close_time:
        return {"is_open": False, "hours_today": "Closed today"}

    open_t = datetime.strptime(today.open_time, "%H:%M:%S" if len(today.open_time) > 5 else "%H:%M").time()
    close_t = datetime.strptime(today.close_time, "%H:%M:%S" if len(today.close_time) > 5 else "%H:%M").time()
    is_open = open_t <= now.time() <= close_t

    return {
        "is_open": is_open,
        "hours_today": f"{today.open_time}–{today.close_time}",
    }


def get_business_info(brain: BusinessBrain) -> dict:
    return {
        "name": brain.business_name,
        "description": brain.description,
        "timezone": brain.timezone,
        "policies": [{"type": p.policy_type, "content": p.content} for p in brain.policies],
    }
