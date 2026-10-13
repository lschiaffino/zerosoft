/**
 * CRM — matemática de dinero (puro, sin DB: lo usan server y client).
 *
 * - Redondeo por línea a los decimales de la moneda (USD 2, JPY/CLP 0…),
 *   half away from zero, así los totales de la UI, la API y el quote coinciden.
 * - Línea: subtotal = qty × precio; descuento = subtotal × d%; neto = subtotal − descuento;
 *   impuesto = neto × t%; total = neto + impuesto.
 * - El amount del deal calculado desde line items es la suma de los NETOS
 *   (después de descuento, antes de impuestos): el valor del negocio no incluye tax.
 * - Tipos de cambio: `rates[c]` = unidades de la moneda base por 1 unidad de c.
 */

export interface LineInput {
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
}

export interface LineTotals {
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

export interface DocTotals {
  subtotal: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

const digitsCache = new Map<string, number>();

/** Decimales de la moneda según ISO 4217 (vía Intl). Default 2. */
export function currencyDigits(currency: string): number {
  const cur = (currency || 'USD').toUpperCase();
  const hit = digitsCache.get(cur);
  if (hit !== undefined) return hit;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  digitsCache.set(cur, digits);
  return digits;
}

/** Redondea a los decimales de la moneda (half away from zero, sin errores de float). */
export function roundMoney(value: number, currency = 'USD'): number {
  if (!Number.isFinite(value)) return 0;
  const d = currencyDigits(currency);
  const f = 10 ** d;
  const sign = value < 0 ? -1 : 1;
  // toPrecision(15) limpia el ruido binario (1.005 * 100 = 100.49999…).
  const scaled = Number((Math.abs(value) * f).toPrecision(15));
  return (sign * Math.round(scaled)) / f || 0;
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(Math.max(p, 0), 100);
}

export function lineTotals(line: LineInput, currency = 'USD'): LineTotals {
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const price = Number.isFinite(line.unit_price) ? line.unit_price : 0;
  const subtotal = roundMoney(qty * price, currency);
  const discount = roundMoney((subtotal * clampPct(line.discount_pct)) / 100, currency);
  const net = roundMoney(subtotal - discount, currency);
  const tax = roundMoney((net * clampPct(line.tax_pct)) / 100, currency);
  const total = roundMoney(net + tax, currency);
  return { subtotal, discount, net, tax, total };
}

/** Totales de un documento (suma de líneas ya redondeadas). */
export function sumLines(lines: LineInput[], currency = 'USD'): DocTotals {
  const acc: DocTotals = { subtotal: 0, discount: 0, net: 0, tax: 0, total: 0 };
  for (const line of lines) {
    const t = lineTotals(line, currency);
    acc.subtotal += t.subtotal;
    acc.discount += t.discount;
    acc.net += t.net;
    acc.tax += t.tax;
    acc.total += t.total;
  }
  return {
    subtotal: roundMoney(acc.subtotal, currency),
    discount: roundMoney(acc.discount, currency),
    net: roundMoney(acc.net, currency),
    tax: roundMoney(acc.tax, currency),
    total: roundMoney(acc.total, currency),
  };
}

export interface CurrencyContext {
  base: string;
  /** Moneda → unidades de base por 1 unidad. La base no necesita estar. */
  rates: Record<string, number>;
}

/** Tipo de cambio de una moneda a la base (1 para la base, null si no hay). */
export function rateToBase(currency: string, ctx: CurrencyContext): number | null {
  const cur = (currency || ctx.base).toUpperCase();
  if (cur === ctx.base.toUpperCase()) return 1;
  const r = ctx.rates[cur];
  return typeof r === 'number' && r > 0 ? r : null;
}

/**
 * Convierte entre monedas pasando por la base. null si falta algún tipo de
 * cambio (la UI muestra solo el original en ese caso).
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  ctx: CurrencyContext,
): number | null {
  if ((from || '').toUpperCase() === (to || '').toUpperCase()) return amount;
  const rFrom = rateToBase(from, ctx);
  const rTo = rateToBase(to, ctx);
  if (rFrom === null || rTo === null) return null;
  return roundMoney((amount * rFrom) / rTo, to);
}

/** Monto en moneda base; si falta el tipo de cambio se toma 1:1 (igual que los reportes SQL). */
export function toBase(amount: number, currency: string, ctx: CurrencyContext): number {
  const r = rateToBase(currency, ctx) ?? 1;
  return roundMoney(amount * r, ctx.base);
}

/** Formato de moneda tolerante a códigos inválidos. */
export function formatMoney(amount: number, currency: string, locale = 'en', exact = false): string {
  const cur = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: cur,
      ...(exact ? {} : { maximumFractionDigits: 0 }),
    }).format(amount);
  } catch {
    return `${cur} ${amount.toFixed(exact ? 2 : 0)}`;
  }
}
