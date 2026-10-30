/**
 * Books: dinero en unidades mínimas enteras de cada moneda (puro, sin DB).
 *
 * - Cada moneda tiene sus decimales (USD 2, CLP 0, KWD 3): un importe se
 *   guarda como entero en esa unidad. Nunca se suman floats.
 * - Redondeo: mitad lejos del cero, a la unidad mínima de la moneda.
 * - Línea: bruto = cantidad × precio; descuento = bruto × bps; neto = bruto −
 *   descuento; impuesto = neto × tasa, redondeado por línea (como imprimen las
 *   facturas de AR, MX y BR).
 * - Tipo de cambio manual: texto decimal ("1050.25" = unidades de la moneda
 *   base por 1 de la moneda del documento), convertido con aritmética entera.
 */

const DECIMALS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** Monedas que ofrece la app (las de la región primero). */
export const BOOKS_CURRENCIES = ['ARS', 'MXN', 'BRL', 'CLP', 'COP', 'PEN', 'UYU', 'PYG', 'BOB', 'USD', 'EUR', 'GBP', 'CAD'] as const;

export const CURRENCY_RE = /^[A-Z]{3}$/;

export function currencyDecimals(currency: string): number {
  return DECIMALS[currency.toUpperCase()] ?? 2;
}

/** Redondeo a entero, mitad lejos del cero (Math.round redondea -2.5 a -2). */
export function roundHalfAway(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const r = Math.round(Math.abs(x) + 1e-9 * Math.sign(Math.abs(x)));
  return x < 0 ? -r : r;
}

/** "1.234,56" / "1234.56" / "1,234.56" → unidades mínimas de la moneda. null si no es un número. */
export function parseAmount(input: string | number, currency: string): number | null {
  const dec = currencyDecimals(currency);
  if (typeof input === 'number') return Number.isFinite(input) ? roundHalfAway(input * 10 ** dec) : null;
  let s = String(input).trim().replace(/\s/g, '').replace(/^\$|[A-Z]{3}$/i, '');
  if (!s) return null;
  const neg = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  s = s.replace(/^[-(]|\)$/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // El separador que aparece último es el decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // Solo comas: decimal si hay 1-3 dígitos después de la última y es la única.
    const after = s.length - lastComma - 1;
    s = s.split(',').length === 2 && after > 0 && after <= 3 && !(after === 3 && dec !== 3) ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot > -1) {
    // Solo puntos: varios son miles ("1.234.567"); uno con 3 dígitos en una moneda sin decimales también ("15.990" CLP).
    const parts = s.split('.');
    if (parts.length > 2 || (s.length - lastDot - 1 === 3 && dec === 0)) s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  // Entero exacto: unidades + fracción truncada a los decimales, redondeando con el siguiente dígito.
  const padded = (frac + '0'.repeat(dec + 1)).slice(0, dec + 1);
  let minor = Number(int) * 10 ** dec + Number(padded.slice(0, dec) || '0');
  if (Number(padded[dec] ?? '0') >= 5) minor += 1;
  if (!Number.isSafeInteger(minor)) return null;
  return neg ? -minor : minor;
}

/** Unidades mínimas → "1234.56" (para inputs y CSV). */
export function toDecimalString(minor: number, currency: string): string {
  const dec = currencyDecimals(currency);
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  if (dec === 0) return `${neg ? '-' : ''}${abs}`;
  const s = String(abs).padStart(dec + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -dec)}.${s.slice(-dec)}`;
}

/** Unidades mínimas → número decimal (solo para mostrar o para APIs externas). */
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** currencyDecimals(currency);
}

export function formatMoney(minor: number, currency: string, locale = 'en'): string {
  const dec = currencyDecimals(currency);
  const tag = locale === 'es' ? 'es-AR' : locale === 'pt' ? 'pt-BR' : 'en-US';
  try {
    return new Intl.NumberFormat(tag, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: dec, maximumFractionDigits: dec }).format(minor / 10 ** dec);
  } catch {
    return `${currency.toUpperCase()} ${toDecimalString(minor, currency)}`;
  }
}

/** Convierte entre monedas con distinta cantidad de decimales (CLP 0 ↔ USD 2) sin perder la unidad. */
export function rescale(minor: number, from: string, to: string): number {
  const diff = currencyDecimals(to) - currencyDecimals(from);
  if (diff === 0) return minor;
  return diff > 0 ? minor * 10 ** diff : roundHalfAway(minor / 10 ** -diff);
}

// ---------- Tipo de cambio ----------

const RATE_SCALE = 1_000_000_000n;

/** "1050,25" o 1050.25 → "1050.25" normalizado; null si no es positivo o tiene más de 9 decimales. */
export function normalizeRate(input: string | number | null | undefined): string | null {
  if (input == null || input === '') return null;
  const s = String(input).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,9})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  const int = i.replace(/^0+(?=\d)/, '');
  const frac = f.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return Number(out) > 0 ? out : null;
}

function rateUnits(rate: string): bigint {
  const [i, f = ''] = rate.split('.');
  return BigInt(i) * RATE_SCALE + BigInt((f + '000000000').slice(0, 9));
}

/**
 * Importe en la moneda del documento → moneda base con el tipo de cambio
 * manual (unidades base por 1 unidad del documento), redondeado a la unidad
 * mínima de la base. Aritmética entera con BigInt.
 */
export function convert(minor: number, docCurrency: string, rate: string, baseCurrency: string): number {
  const scaled = rescale(minor, docCurrency, baseCurrency);
  if (docCurrency.toUpperCase() === baseCurrency.toUpperCase()) return scaled;
  const num = BigInt(Math.trunc(scaled)) * rateUnits(rate);
  const neg = num < 0n;
  const abs = neg ? -num : num;
  let q = abs / RATE_SCALE;
  if ((abs % RATE_SCALE) * 2n >= RATE_SCALE) q += 1n;
  return Number(neg ? -q : q);
}

// ---------- Líneas y totales ----------

export interface LineInput {
  quantity: number;
  /** Precio unitario en unidades mínimas. */
  unitPrice: number;
  /** Descuento en basis points (1000 = 10 %). */
  discountBps?: number;
  /** Tasa del impuesto en basis points (2100 = 21 %, 1050 = 10,5 %). */
  taxBps?: number;
}

export interface LineAmounts {
  gross: number;
  discount: number;
  net: number;
  tax: number;
  total: number;
}

/** Cantidades con hasta 4 decimales (0,5 horas, 1,25 kg). */
export function normalizeQuantity(q: number): number {
  if (!Number.isFinite(q)) return 0;
  return Math.round(q * 10_000) / 10_000;
}

export function lineAmounts(l: LineInput): LineAmounts {
  const qty = normalizeQuantity(l.quantity);
  // qty con 4 decimales × precio entero: se calcula en diezmilésimos para no arrastrar error de float.
  const gross = roundHalfAway((Math.round(qty * 10_000) * Math.trunc(l.unitPrice)) / 10_000);
  const discount = roundHalfAway((gross * Math.max(0, Math.min(10_000, Math.trunc(l.discountBps ?? 0)))) / 10_000);
  const net = gross - discount;
  const tax = roundHalfAway((net * Math.max(0, Math.trunc(l.taxBps ?? 0))) / 10_000);
  return { gross, discount, net, tax, total: net + tax };
}

export interface DocTotals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  /** Impuesto por tasa (bps → { neto, impuesto }), para el PDF y el libro IVA. */
  byRate: Array<{ taxBps: number; net: number; tax: number }>;
  lines: LineAmounts[];
}

export function docTotals(lines: LineInput[]): DocTotals {
  const amounts = lines.map(lineAmounts);
  const byRate = new Map<number, { net: number; tax: number }>();
  lines.forEach((l, i) => {
    const k = Math.trunc(l.taxBps ?? 0);
    const cur = byRate.get(k) ?? { net: 0, tax: 0 };
    cur.net += amounts[i].net;
    cur.tax += amounts[i].tax;
    byRate.set(k, cur);
  });
  const subtotal = amounts.reduce((s, a) => s + a.gross, 0);
  const discountTotal = amounts.reduce((s, a) => s + a.discount, 0);
  const taxTotal = amounts.reduce((s, a) => s + a.tax, 0);
  return {
    subtotal,
    discountTotal,
    taxTotal,
    total: subtotal - discountTotal + taxTotal,
    byRate: [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([taxBps, v]) => ({ taxBps, ...v })),
    lines: amounts,
  };
}

/** "21" / "10.5" / "10,5" → bps (2100 / 1050). null si no es un porcentaje válido (0-100, 2 decimales). */
export function percentToBps(input: string | number): number | null {
  const s = String(input).trim().replace(',', '.').replace(/%$/, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

export function bpsToPercent(bps: number): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, '');
  return s;
}

// ---------- Fechas ----------

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Suma meses respetando fin de mes (31 ene + 1 mes = 28/29 feb). */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay ?? d, last));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
