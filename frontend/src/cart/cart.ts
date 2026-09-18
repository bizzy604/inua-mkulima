import type { CartLine } from "../api";

/** The in-memory cart keyed by product ID. */
export type Cart = Record<number, CartLine>;

/** Converts cart state into the economic payload accepted by preview and payment. */
export function cartPayload(cart: Cart) {
  const items = Object.values(cart);
  return {
    items,
    expectedDeductionTotalMinor: items.reduce(
      (total, item) => total + item.deductionMinor,
      0,
    ),
  };
}

/** Returns the cart lines in their stable object-value order. */
export function cartLines(cart: Cart) {
  return Object.values(cart);
}

/** Calculates the combined subsidy deduction in KES minor units. */
export function deductionTotal(cart: Cart) {
  return cartLines(cart).reduce(
    (total, item) => total + item.deductionMinor,
    0,
  );
}
