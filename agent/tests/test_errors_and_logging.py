import json
import logging

from src.errors import ErrorCategory, DhvaError, categorize_unknown_exception
from src.logging_utils import log_event, log_error, _redact


class TestErrorCategory:
    def test_all_14_categories_present(self):
        expected = {
            "AUTH_ERROR", "AUTHORIZATION_ERROR", "TENANT_ACCESS_DENIED", "ONBOARDING_ERROR",
            "DATABASE_ERROR", "VALIDATION_ERROR", "LLM_TIMEOUT", "LLM_PROVIDER_ERROR",
            "TOOL_ERROR", "STT_ERROR", "TTS_ERROR", "TELEPHONY_ERROR", "LIVEKIT_ERROR",
            "INTEGRATION_ERROR",
        }
        actual = {c.value for c in ErrorCategory}
        assert actual == expected


class TestDhvaError:
    def test_defaults_to_unsafe_for_caller(self):
        err = DhvaError(ErrorCategory.DATABASE_ERROR, "connection string leaked in this message")
        assert err.safe_for_caller is False

    def test_can_be_marked_safe(self):
        err = DhvaError(ErrorCategory.VALIDATION_ERROR, "That item isn't on the menu.", safe_for_caller=True)
        assert err.safe_for_caller is True


class TestCategorizeUnknownException:
    def test_stt_context(self):
        assert categorize_unknown_exception(Exception("boom"), context="deepgram STT connect") == ErrorCategory.STT_ERROR

    def test_tts_context(self):
        assert categorize_unknown_exception(Exception("boom"), context="cartesia TTS synth") == ErrorCategory.TTS_ERROR

    def test_llm_context(self):
        assert categorize_unknown_exception(Exception("boom"), context="anthropic LLM call") == ErrorCategory.LLM_PROVIDER_ERROR

    def test_llm_timeout_specifically(self):
        assert categorize_unknown_exception(TimeoutError("timeout"), context="llm request") == ErrorCategory.LLM_TIMEOUT

    def test_transfer_context_is_telephony_not_livekit(self):
        assert categorize_unknown_exception(Exception("boom"), context="sip transfer") == ErrorCategory.TELEPHONY_ERROR

    def test_livekit_context_without_transfer(self):
        assert categorize_unknown_exception(Exception("boom"), context="livekit room connect") == ErrorCategory.LIVEKIT_ERROR

    def test_database_context(self):
        assert categorize_unknown_exception(Exception("boom"), context="supabase query") == ErrorCategory.DATABASE_ERROR

    def test_unknown_context_falls_back_to_tool_error(self):
        assert categorize_unknown_exception(Exception("boom"), context="calculate_order") == ErrorCategory.TOOL_ERROR


class TestRedaction:
    def test_redacts_keys_matching_secret_patterns(self):
        result = _redact({"api_key": "sk-real-value", "user_name": "safe", "AUTH_TOKEN": "also-secret"})
        assert result["api_key"] == "***redacted***"
        assert result["AUTH_TOKEN"] == "***redacted***"
        assert result["user_name"] == "safe"

    def test_redacts_nested_dicts(self):
        result = _redact({"config": {"secret_key": "hidden", "region": "us-east"}})
        assert result["config"]["secret_key"] == "***redacted***"
        assert result["config"]["region"] == "us-east"


class TestLogEvent:
    def test_emits_valid_json_with_correlation_fields(self, caplog):
        with caplog.at_level(logging.INFO, logger="dhva.agent.structured"):
            log_event("test_event", call_id="call-123", business_id="biz-456", extra_field="value")
        assert len(caplog.records) == 1
        parsed = json.loads(caplog.records[0].message)
        assert parsed["event"] == "test_event"
        assert parsed["call_id"] == "call-123"
        assert parsed["business_id"] == "biz-456"
        assert parsed["extra_field"] == "value"

    def test_drops_none_correlation_fields_rather_than_logging_null_noise(self, caplog):
        with caplog.at_level(logging.INFO, logger="dhva.agent.structured"):
            log_event("test_event", call_id="call-123")
        parsed = json.loads(caplog.records[0].message)
        assert "business_id" not in parsed
        assert "org_id" not in parsed

    def test_never_logs_a_raw_api_key_passed_as_a_field(self, caplog):
        with caplog.at_level(logging.INFO, logger="dhva.agent.structured"):
            log_event("test_event", call_id="call-123", deepgram_api_key="sk-should-not-appear")
        parsed = json.loads(caplog.records[0].message)
        assert parsed["deepgram_api_key"] == "***redacted***"
        assert "sk-should-not-appear" not in caplog.text


class TestLogError:
    def test_includes_error_category(self, caplog):
        with caplog.at_level(logging.ERROR, logger="dhva.agent.structured"):
            log_error("test_failure", ErrorCategory.TELEPHONY_ERROR, "transfer failed", call_id="call-1")
        parsed = json.loads(caplog.records[0].message)
        assert parsed["error_category"] == "TELEPHONY_ERROR"
        assert parsed["message"] == "transfer failed"
