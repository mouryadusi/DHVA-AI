import pytest

from src.summarize import _parse_summary_json


def test_parses_clean_json():
    summary, saved = _parse_summary_json('{"summary": "Caller ordered a pizza.", "opportunity_saved": true}')
    assert summary == "Caller ordered a pizza."
    assert saved is True


def test_strips_markdown_fences():
    raw = '```json\n{"summary": "Test.", "opportunity_saved": false}\n```'
    summary, saved = _parse_summary_json(raw)
    assert summary == "Test."
    assert saved is False


def test_raises_on_malformed_json():
    with pytest.raises(Exception):
        _parse_summary_json("not json at all")
