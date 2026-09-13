/**
 * Deliberately the single source of truth for "what does this order cost."
 * The Python agent's calculate_order tool (agent/src/tools/order.py)
 * implements the identical rule set — see the docstring there. If you
 * change pricing/rounding rules, change both, and add a test here.
 */

export interface MenuItem {
  id: string;
  name: string;
  price_cents: number;
}

export interface OrderLineInput {
  productId: string;
  quantity: number;
}

export interface OrderLineResult {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface OrderResult {
  lineItems: OrderLineResult[];
  totalCents: number;
}

export function calculateOrderTotal(lines: OrderLineInput[], menu: MenuItem[]): OrderResult {
  const menuById = new Map(menu.map((item) => [item.id, item]));

  const lineItems: OrderLineResult[] = lines.map((line) => {
    if (line.quantity <= 0) {
      throw new Error(`Invalid quantity for product ${line.productId}: quantity must be positive`);
    }
    const item = menuById.get(line.productId);
    if (!item) {
      throw new Error(`Product not found on menu: ${line.productId}`);
    }
    return {
      productId: item.id,
      name: item.name,
      quantity: line.quantity,
      unitPriceCents: item.price_cents,
      lineTotalCents: item.price_cents * line.quantity,
    };
  });

  const totalCents = lineItems.reduce((sum, li) => sum + li.lineTotalCents, 0);

  return { lineItems, totalCents };
}
