/**
 * Matemática del generador de facturas. Todo se calcula en unidades menores
 * (centavos) para no arrastrar errores de punto flotante.
 *
 * Orden: importe de línea = qty × precio (redondeado) → el descuento se reparte
 * proporcionalmente entre las líneas → impuesto por línea sobre el neto →
 * total = subtotal − descuento + impuestos.
 */

export interface InvoiceItem {
  description: string;
  qty: number;
  price: number;
  /** Porcentaje (21 = 21%). */
  taxRate: number;
}

export interface InvoiceDiscount {
  type: 'percent' | 'amount';
  value: number;
}

export interface InvoiceLine {
  amount: number;
  discount: number;
  tax: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  /** Impuesto agrupado por alícuota, ordenado de menor a mayor. */
  taxes: Array<{ rate: number; base: number; amount: number }>;
  tax: number;
  total: number;
}

/** Decimales de la moneda (USD 2, JPY 0, BHD 3). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** x en unidades menores, redondeo "half away from zero" sin ruido binario. */
function toMinor(x: number, factor: number): number {
  const scaled = Number((x * factor).toPrecision(12));
  return Math.sign(scaled) * Math.round(Math.abs(scaled));
}

export function computeInvoice(
  items: InvoiceItem[],
  discount: InvoiceDiscount = { type: 'percent', value: 0 },
  digits = 2,
): InvoiceTotals {
  const f = 10 ** digits;
  const amounts = items.map((it) => toMinor(num(it.qty) * num(it.price), f));
  const subtotal = amounts.reduce((a, b) => a + b, 0);

  let discountMinor = 0;
  const dv = Math.max(0, num(discount.value));
  if (discount.type === 'percent') discountMinor = toMinor((subtotal * Math.min(dv, 100)) / 100, 1);
  else discountMinor = Math.min(toMinor(dv, f), Math.max(subtotal, 0));
  if (subtotal <= 0) discountMinor = 0;

  // Reparto proporcional; la última línea con importe absorbe el resto.
  const shares = amounts.map(() => 0);
  if (discountMinor > 0) {
    let assigned = 0;
    let lastIdx = -1;
    amounts.forEach((a, i) => {
      if (a > 0) lastIdx = i;
    });
    amounts.forEach((a, i) => {
      if (a <= 0 || i === lastIdx) return;
      shares[i] = Math.round((discountMinor * a) / subtotal);
      assigned += shares[i];
    });
    if (lastIdx >= 0) shares[lastIdx] = discountMinor - assigned;
  }

  const lines: InvoiceLine[] = items.map((it, i) => {
    const net = amounts[i] - shares[i];
    const tax = toMinor((net * Math.max(0, num(it.taxRate))) / 100, 1);
    return { amount: amounts[i] / f, discount: shares[i] / f, tax: tax / f };
  });

  const byRate = new Map<number, { base: number; amount: number }>();
  items.forEach((it, i) => {
    const rate = Math.max(0, num(it.taxRate));
    if (rate === 0) return;
    const cur = byRate.get(rate) ?? { base: 0, amount: 0 };
    cur.base += amounts[i] - shares[i];
    cur.amount += Math.round(lines[i].tax * f);
    byRate.set(rate, cur);
  });
  const taxes = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, v]) => ({ rate, base: v.base / f, amount: v.amount / f }));
  const taxMinor = taxes.reduce((a, t) => a + Math.round(t.amount * f), 0);

  return {
    lines,
    subtotal: subtotal / f,
    discount: discountMinor / f,
    taxes,
    tax: taxMinor / f,
    total: (subtotal - discountMinor + taxMinor) / f,
  };
}

export const INVOICE_CURRENCIES = ['USD', 'EUR', 'GBP', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'CAD', 'AUD', 'JPY', 'CHF'] as const;
