from src.outcome import classify_outcome, is_review_worthy_reason


def test_transfer_takes_precedence():
    calls = [{"tool_name": "calculate_order", "success": True}]
    assert classify_outcome(calls, transferred=True) == "transferred"


def test_order_placed():
    calls = [{"tool_name": "search_menu", "success": True}, {"tool_name": "calculate_order", "success": True}]
    assert classify_outcome(calls, transferred=False) == "order_placed"


def test_failed_order_does_not_count():
    calls = [{"tool_name": "calculate_order", "success": False}]
    assert classify_outcome(calls, transferred=False) != "order_placed"


def test_message_taken():
    calls = [{"tool_name": "take_message", "success": True}]
    assert classify_outcome(calls, transferred=False) == "message_taken"


def test_answered_faq():
    calls = [{"tool_name": "get_business_hours", "success": True}]
    assert classify_outcome(calls, transferred=False) == "answered_faq"


def test_no_tools_is_abandoned():
    assert classify_outcome([], transferred=False) == "abandoned"


def test_unrecognized_tool_only_returns_none():
    calls = [{"tool_name": "get_business_info", "success": False}]
    assert classify_outcome(calls, transferred=False) is None


def test_review_worthy_reasons():
    assert is_review_worthy_reason("repeated_misunderstanding") is True
    assert is_review_worthy_reason("out_of_scope_request") is True
    assert is_review_worthy_reason("explicit_compliance_topic") is True


def test_non_review_worthy_reasons():
    # A caller simply asking for a human, or the agent flagging low
    # confidence on an otherwise-fine call, isn't inherently a sign
    # something went wrong worth flagging for owner review.
    assert is_review_worthy_reason("caller_requests_human") is False
    assert is_review_worthy_reason("low_confidence_tool_call") is False
    assert is_review_worthy_reason("angry_sentiment") is False
