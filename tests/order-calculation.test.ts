import { describe, it, expect } from "vitest";
import { calculateOrderTotal, type OrderLineInput, type MenuItem } from "@/lib/business-brain/order-math";

const MENU: MenuItem[] = [
  { id: "1", name: "Margherita", price_cents: 399 },
  { id: "2", name: "Pepperoni", price_cents: 499 },
  { id: "3", name: "Garlic Bread", price_cents: 199 },
];

describe("calculateOrderTotal", () => {
  it("sums line items correctly", () => {
    const lines: OrderLineInput[] = [
      { productId: "1", quantity: 2 },
      { productId: "3", quantity: 1 },
    ];
    const result = calculateOrderTotal(lines, MENU);
    expect(result.totalCents).toBe(399 * 2 + 199);
    expect(result.lineItems).toHaveLength(2);
  });

  it("throws on an item not on the menu rather than inventing a price", () => {
    const lines: OrderLineInput[] = [{ productId: "does-not-exist", quantity: 1 }];
    expect(() => calculateOrderTotal(lines, MENU)).toThrow(/not found/i);
  });

  it("rejects non-positive quantities", () => {
    const lines: OrderLineInput[] = [{ productId: "1", quantity: 0 }];
    expect(() => calculateOrderTotal(lines, MENU)).toThrow(/quantity/i);
  });

  it("handles an empty order", () => {
    const result = calculateOrderTotal([], MENU);
    expect(result.totalCents).toBe(0);
    expect(result.lineItems).toHaveLength(0);
  });
});
