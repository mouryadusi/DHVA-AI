"""search_menu tool logic — matches against real product/service rows only, never invents items."""
from __future__ import annotations

from src.business_brain import BusinessBrain


def search_menu(brain: BusinessBrain, query: str) -> list[dict]:
    """
    Simple case-insensitive substring match over product names/descriptions
    and service names/descriptions. Deliberately not fuzzy/semantic search
    for the MVP — see docs/architecture-and-roadmap.md on keeping the
    business brain deterministic in Phase 1 so failure modes are debuggable.
    """
    q = query.strip().lower()
    results: list[dict] = []

    for p in brain.products:
        haystack = f"{p.name} {p.description or ''} {p.category or ''}".lower()
        if q == "" or q in haystack:
            results.append(
                {"type": "product", "id": p.id, "name": p.name, "price_cents": p.price_cents,
                 "description": p.description}
            )

    for s in brain.services:
        haystack = f"{s.name} {s.description or ''}".lower()
        if q == "" or q in haystack:
            results.append(
                {"type": "service", "id": s.id, "name": s.name, "price_cents": s.price_cents,
                 "description": s.description}
            )

    return results
