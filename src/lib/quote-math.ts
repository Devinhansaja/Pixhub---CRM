// Mirrors the database calculation (quotation_items.line_total + quotations_workflow trigger)
// so the builder shows exactly what will be stored.

export interface QuoteLine { quantity: number; unit_price: number; discount_pct: number }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineTotal = (l: QuoteLine) => r2(l.quantity * l.unit_price * (1 - l.discount_pct / 100));

export function quoteTotals(lines: QuoteLine[], discountAmount: number, taxRate: number) {
  const subtotal = r2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const tax = r2((subtotal - discountAmount) * taxRate / 100);
  return { subtotal, tax, total: r2(subtotal - discountAmount + tax) };
}
