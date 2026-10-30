/**
 * Shop: matemática de una compra (puro, sin DB: lo usan el servidor, el
 * carrito y los tests). Todo en unidades mínimas enteras ("cents": monto ×
 * 100, también en monedas sin decimales como CLP; Stripe convierte al cobrar).
 *
 * Orden (como Shopify):
 *   subtotal = Σ precio × cantidad
 *   descuento = % del subtotal, o un monto fijo (tope: el subtotal); envío gratis va aparte
 *   envío = la tarifa elegida entre las que aplican (país, peso), gratis desde un monto
 *   impuesto = tasa de la región sobre (subtotal − descuento) y, si la tasa lo dice, el envío
 *   total = subtotal − descuento + envío + impuesto (si los precios ya incluyen impuesto, no se suma)
 *
 * Redondeo: half away from zero en cada paso, una vez por pedido.
 */

export type DiscountKind = 'percent' | 'fixed' | 'free_shipping';

export interface DiscountRule {
  code: string;
  kind: DiscountKind;
  /** percent: puntos básicos (1500 = 15 %); fixed: cents; free_shipping: 0. */
  value: number;
  minOrderCents: number;
  usageLimit: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}

export type DiscountError = 'discount_invalid' | 'discount_inactive' | 'discount_not_started' | 'discount_expired' | 'discount_used_up' | 'discount_min_order';

export type ShippingKind = 'flat' | 'weight';

export interface ShippingRate {
  id: string;
  name: string;
  kind: ShippingKind;
  /** Países ISO-2 donde aplica; vacío = todos. */
  countries: string[];
  priceCents: number;
  /** Solo 'weight': rango en gramos (null = sin tope). */
  minWeightG: number | null;
  maxWeightG: number | null;
  /** Gratis cuando el subtotal (después del descuento) llega a este monto. */
  freeOverCents: number | null;
}

export interface TaxRate {
  country: string;
  /** '' = todo el país. */
  region: string;
  /** Puntos básicos: 2100 = 21 %. */
  rateBps: number;
  name: string;
  appliesToShipping: boolean;
}

export interface MoneyLine {
  unitCents: number;
  quantity: number;
  weightGrams: number;
  /** Sin envío (producto digital o servicio). */
  requiresShipping?: boolean;
}

export interface Address {
  country: string;
  region?: string;
}

export interface ShippingOption {
  id: string;
  name: string;
  priceCents: number;
  free: boolean;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  /** El envío lo descontó un código de envío gratis. */
  freeShippingByCode: boolean;
  shippingOptions: ShippingOption[];
  /** Tarifa aplicada (null si no hace falta envío o no hay ninguna que aplique). */
  shipping: ShippingOption | null;
  needsShipping: boolean;
  weightGrams: number;
  taxName: string | null;
  taxRateBps: number;
  taxIncluded: boolean;
}

/** Redondeo half away from zero a entero. */
export function roundCents(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Redondea a la unidad mínima de la moneda: en monedas sin decimales (CLP, PYG…), a enteros (múltiplos de 100 cents). */
export function roundToCurrency(cents: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(cents / 100) * 100 : Math.round(cents);
}

/** Basis points de un porcentaje escrito ("21", "10.5") con dos decimales. */
export function percentToBps(pct: number): number {
  return Math.round(pct * 100);
}

export function subtotalOf(lines: MoneyLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(0, Math.trunc(l.unitCents)) * Math.max(0, Math.trunc(l.quantity)), 0);
}

export function weightOf(lines: MoneyLine[]): number {
  return lines.reduce((sum, l) => sum + (l.requiresShipping === false ? 0 : Math.max(0, l.weightGrams) * Math.max(0, l.quantity)), 0);
}

function ts(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * ¿El código se puede usar para este subtotal ahora? null = sí. El tope de
 * usos se vuelve a chequear con compare-and-set al crear el pedido.
 */
export function discountError(d: DiscountRule | null, subtotalCents: number, now: Date = new Date()): DiscountError | null {
  if (!d) return 'discount_invalid';
  if (!d.active) return 'discount_inactive';
  const start = ts(d.startsAt);
  const end = ts(d.endsAt);
  if (start != null && now.getTime() < start) return 'discount_not_started';
  if (end != null && now.getTime() > end) return 'discount_expired';
  if (d.usageLimit != null && d.usedCount >= d.usageLimit) return 'discount_used_up';
  if (subtotalCents < Math.max(0, d.minOrderCents)) return 'discount_min_order';
  return null;
}

/** Descuento sobre el subtotal (sin el envío gratis, que se aplica en el envío). */
export function discountAmount(d: Pick<DiscountRule, 'kind' | 'value'> | null, subtotalCents: number): number {
  if (!d || subtotalCents <= 0) return 0;
  if (d.kind === 'percent') {
    const bps = Math.min(10_000, Math.max(0, d.value));
    return Math.min(subtotalCents, roundCents((subtotalCents * bps) / 10_000));
  }
  if (d.kind === 'fixed') return Math.min(subtotalCents, Math.max(0, Math.trunc(d.value)));
  return 0;
}

function rateApplies(rate: ShippingRate, country: string, weightGrams: number): boolean {
  if (rate.countries.length && !rate.countries.includes(country)) return false;
  if (rate.kind === 'weight') {
    if (rate.minWeightG != null && weightGrams < rate.minWeightG) return false;
    if (rate.maxWeightG != null && weightGrams > rate.maxWeightG) return false;
  }
  return true;
}

/** Tarifas que aplican a la dirección y al peso, más baratas primero. */
export function shippingOptions(rates: ShippingRate[], address: Address | null, weightGrams: number, merchandiseCents: number): ShippingOption[] {
  const country = (address?.country ?? '').toUpperCase();
  if (!country) return [];
  return rates
    .filter((r) => rateApplies(r, country, weightGrams))
    .map((r) => {
      const free = r.freeOverCents != null && merchandiseCents >= r.freeOverCents;
      return { id: r.id, name: r.name, priceCents: free ? 0 : Math.max(0, r.priceCents), free };
    })
    .sort((a, b) => a.priceCents - b.priceCents || a.name.localeCompare(b.name));
}

/** Tasa de la dirección: la de la región gana a la del país; sin ninguna, null. */
export function taxRateFor(rates: TaxRate[], address: Address | null): TaxRate | null {
  if (!address?.country) return null;
  const country = address.country.toUpperCase();
  const region = (address.region ?? '').trim().toLowerCase();
  const sameCountry = rates.filter((r) => r.country.toUpperCase() === country);
  return (region ? sameCountry.find((r) => r.region.trim().toLowerCase() === region) : undefined) ?? sameCountry.find((r) => !r.region.trim()) ?? null;
}

export interface TotalsInput {
  lines: MoneyLine[];
  discount?: Pick<DiscountRule, 'kind' | 'value'> | null;
  shippingRates: ShippingRate[];
  /** Tarifa elegida; si no está o no aplica, la más barata. */
  shippingRateId?: string | null;
  address: Address | null;
  taxRates: TaxRate[];
  /** Los precios ya incluyen el impuesto (IVA incluido, lo común en LATAM). */
  taxIncluded?: boolean;
  /** Moneda: en las que no tienen decimales, descuento e impuesto se redondean a enteros. */
  currency?: string;
}

export function computeTotals(input: TotalsInput): Totals {
  const unit = input.currency && ZERO_DECIMAL.has(input.currency.toLowerCase()) ? 100 : 1;
  const toUnit = (n: number) => (unit === 1 ? n : Math.round(n / unit) * unit);
  const subtotalCents = subtotalOf(input.lines);
  const discountCents = Math.min(subtotalCents, toUnit(discountAmount(input.discount ?? null, subtotalCents)));
  const merchandise = subtotalCents - discountCents;
  const needsShipping = input.lines.some((l) => l.requiresShipping !== false && l.quantity > 0);
  const weightGrams = weightOf(input.lines);
  const options = needsShipping ? shippingOptions(input.shippingRates, input.address, weightGrams, merchandise) : [];
  let shipping = needsShipping ? (options.find((o) => o.id === input.shippingRateId) ?? options[0] ?? null) : null;
  const freeShippingByCode = input.discount?.kind === 'free_shipping' && shipping != null && shipping.priceCents > 0;
  if (shipping && input.discount?.kind === 'free_shipping') shipping = { ...shipping, priceCents: 0, free: true };
  const shippingCents = shipping?.priceCents ?? 0;

  const rate = taxRateFor(input.taxRates, input.address);
  const bps = rate ? Math.max(0, rate.rateBps) : 0;
  const taxable = merchandise + (rate?.appliesToShipping ? shippingCents : 0);
  const taxIncluded = Boolean(input.taxIncluded);
  // Incluido: la parte del precio que es impuesto (precio − precio / (1 + t)); no se suma.
  const taxCents = toUnit(bps === 0 ? 0 : taxIncluded ? roundCents(taxable - taxable / (1 + bps / 10_000)) : roundCents((taxable * bps) / 10_000));
  const totalCents = merchandise + shippingCents + (taxIncluded ? 0 : taxCents);
  return {
    subtotalCents,
    discountCents,
    shippingCents,
    taxCents,
    totalCents,
    freeShippingByCode,
    shippingOptions: options,
    shipping,
    needsShipping,
    weightGrams,
    taxName: rate?.name || null,
    taxRateBps: bps,
    taxIncluded,
  };
}

/** Monto para Stripe (unidad mínima de la moneda): sin decimales, cents / 100. */
export function stripeAmount(cents: number, zeroDecimal: boolean): number {
  return zeroDecimal ? Math.round(cents / 100) : cents;
}

/** "12.50" → 1250. null si no es un monto válido (≥ 0, hasta 2 decimales). */
export function parseMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/\s/g, '');
  if (!s) return null;
  // "1.234,56" (coma decimal) y "1,234.56" (punto decimal).
  let norm = s;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s) || /^\d+,\d{1,2}$/.test(s)) norm = s.replace(/\./g, '').replace(',', '.');
  else norm = s.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  return Math.round(Number(norm) * 100);
}

/** Cents → "12.50" (para formularios y CSV). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Cents → texto con la moneda ("$12.50", "ARS 1.250,00"). */
export function formatMoney(cents: number, currency: string, locale = 'en'): string {
  const zero = ZERO_DECIMAL.has(currency.toLowerCase());
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: zero ? 0 : 2,
      maximumFractionDigits: zero ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${centsToInput(cents)}`;
  }
}

/** Monedas sin decimales (las de Stripe que usamos en la región, más las comunes). */
const ZERO_DECIMAL = new Set(['clp', 'pyg', 'jpy', 'krw', 'vnd', 'xaf', 'xof', 'ugx', 'rwf', 'kmf', 'gnf', 'bif', 'djf', 'mga', 'vuv', 'xpf']);

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toLowerCase());
}

/** Monedas que se pueden elegir para la tienda. */
export const SHOP_CURRENCIES = ['USD', 'ARS', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'UYU', 'EUR', 'GBP', 'CAD'] as const;
