"""
Tests for pure business logic in agent/src/tools/*. These deliberately
avoid Supabase/LiveKit entirely so they run offline — the network-dependent
paths (call_logging.py, db.py, entrypoint.py) need a real Supabase project
and are exercised manually per docs/VOICE_TEST_SCENARIOS.md instead.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from src.business_brain import BusinessBrain, BusinessHours, Product, Service, FAQ, Policy, AgentConfig
from src.tools.hours import is_open_now
from src.tools.menu import search_menu
from src.tools.order import calculate_order, OrderError
from src.tools.transfer import EscalationSignal, decide_escalation


def make_brain(**overrides) -> BusinessBrain:
    defaults = dict(
        business_id="biz-1",
        business_name="Dhva Pizza",
        vertical="food.pizza_restaurant",
        description="Neighborhood pizza restaurant.",
        timezone="America/New_York",
        hours=[
            BusinessHours(day_of_week=1, open_time="11:00", close_time="23:00", is_closed=False),  # Monday
        ],
        products=[
            Product(id="p1", name="Margherita", description="Classic", category="pizza", price_cents=399),
            Product(id="p2", name="Garlic Bread", description=None, category="sides", price_cents=199),
        ],
        services=[],
        faqs=[FAQ(question="Do you deliver?", answer="Yes, within 3 miles.")],
        policies=[Policy(policy_type="payment", content="Cash or card at pickup/delivery.")],
        agent=AgentConfig(
            id="agent-1",
            name="Dhva",
            greeting="Thanks for calling!",
            personality="Warm and efficient.",
            language="en",
            llm_provider="anthropic",
            llm_model="claude-sonnet-5",
            stt_provider="deepgram",
            tts_provider="cartesia",
            tts_voice_id=None,
            escalation_phone_number="+15555550123",
        ),
    )
    defaults.update(overrides)
    return BusinessBrain(**defaults)


class TestBusinessHours:
    def test_open_during_hours(self):
        brain = make_brain()
        monday_noon = datetime(2026, 9, 14, 12, 0, tzinfo=ZoneInfo("America/New_York"))  # a Monday
        result = is_open_now(brain, at=monday_noon)
        assert result["is_open"] is True

    def test_closed_outside_hours(self):
        brain = make_brain()
        monday_late = datetime(2026, 9, 14, 23, 59, tzinfo=ZoneInfo("America/New_York"))
        result = is_open_now(brain, at=monday_late)
        assert result["is_open"] is False

    def test_closed_on_unlisted_day(self):
        brain = make_brain()  # only Monday is configured
        tuesday = datetime(2026, 9, 15, 12, 0, tzinfo=ZoneInfo("America/New_York"))
        result = is_open_now(brain, at=tuesday)
        assert result["is_open"] is False


class TestSearchMenu:
    def test_finds_matching_product(self):
        brain = make_brain()
        results = search_menu(brain, "margherita")
        assert len(results) == 1
        assert results[0]["name"] == "Margherita"

    def test_empty_query_returns_everything(self):
        brain = make_brain()
        results = search_menu(brain, "")
        assert len(results) == 2

    def test_no_match_returns_empty(self):
        brain = make_brain()
        results = search_menu(brain, "sushi")
        assert results == []

    def test_never_invents_items_not_in_brain(self):
        brain = make_brain()
        results = search_menu(brain, "pepperoni")  # not seeded in this brain
        assert results == []


class TestCalculateOrder:
    def test_sums_correctly(self):
        brain = make_brain()
        result = calculate_order(brain, [{"product_id": "p1", "quantity": 2}, {"product_id": "p2", "quantity": 1}])
        assert result["total_cents"] == 399 * 2 + 199

    def test_raises_on_unknown_product(self):
        brain = make_brain()
        with pytest.raises(OrderError, match="not found"):
            calculate_order(brain, [{"product_id": "does-not-exist", "quantity": 1}])

    def test_raises_on_invalid_quantity(self):
        brain = make_brain()
        with pytest.raises(OrderError, match="quantity"):
            calculate_order(brain, [{"product_id": "p1", "quantity": 0}])


class TestEscalation:
    CONFIGURED = ["caller_requests_human", "low_confidence_tool_call", "angry_sentiment"]

    def test_below_threshold_does_not_escalate(self):
        signal = EscalationSignal(trigger="angry_sentiment", confidence=0.3)
        assert decide_escalation([signal], self.CONFIGURED) is None

    def test_explicit_request_escalates(self):
        signal = EscalationSignal(trigger="caller_requests_human", confidence=1.0)
        result = decide_escalation([signal], self.CONFIGURED)
        assert result is not None
        assert result.trigger == "caller_requests_human"

    def test_unconfigured_trigger_is_ignored(self):
        # explicit_compliance_topic is a valid trigger type but not configured for this business
        signal = EscalationSignal(trigger="explicit_compliance_topic", confidence=0.99)
        assert decide_escalation([signal], self.CONFIGURED) is None

    def test_picks_highest_confidence_when_multiple_qualify(self):
        signals = [
            EscalationSignal(trigger="low_confidence_tool_call", confidence=0.65),
            EscalationSignal(trigger="caller_requests_human", confidence=0.9),
        ]
        result = decide_escalation(signals, self.CONFIGURED)
        assert result.trigger == "caller_requests_human"
