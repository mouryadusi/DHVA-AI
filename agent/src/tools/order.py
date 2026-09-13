"""
calculate_order tool logic.

Mirrors lib/business-brain/order-math.ts exactly — same rule set, same
error conditions. If you change pricing/rounding rules, change both and
add a test in both tests/order-calculation.test.ts and
agent/tests/test_tools.py.
"""
from __future__ import annotations

from src.business_brain import BusinessBrain


class OrderError(Exception):
    pass


def calculate_order(brain: BusinessBrain, lines: list[dict]) -> dict:
    """
    lines: [{"product_id": str, "quantity": int}, ...]
    Raises OrderError if a product isn't on the menu or quantity is invalid —
    the agent must surface this as "I don't have that on the menu," never
    silently invent a price.
    """
    by_id = {p.id: p for p in brain.products}

    line_items = []
    for line in lines:
        product_id = line["product_id"]
        quantity = line["quantity"]
        if quantity <= 0:
            raise OrderError(f"Invalid quantity for product {product_id}: quantity must be positive")
        product = by_id.get(product_id)
        if product is None:
            raise OrderError(f"Product not found on menu: {product_id}")
        line_items.append(
            {
                "product_id": product.id,
                "name": product.name,
                "quantity": quantity,
                "unit_price_cents": product.price_cents,
                "line_total_cents": product.price_cents * quantity,
            }
        )

    total_cents = sum(li["line_total_cents"] for li in line_items)
    return {"line_items": line_items, "total_cents": total_cents}
