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

export type DiscountKind = 'percent' | 'fixed' | 'free_shipping' | 'bxgy';
export type DiscountMethod = 'code' | 'automatic';

export interface DiscountRule {
  code: string;
  kind: DiscountKind;
  /** percent y bxgy: puntos básicos (1500 = 15 %; bxgy: el descuento de lo que se lleva, 10000 = gratis); fixed: cents; free_shipping: 0. */
  value: number;
  minOrderCents: number;
  usageLimit: number | null;
  usedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  /** Código que escribe el cliente o automático (se aplica solo cuando se cumplen las condiciones). */
  method?: DiscountMethod;
  /** Nombre que ve el cliente en un descuento automático. */
  title?: string;
  /** Unidades mínimas (de los productos a los que aplica). 0 = sin mínimo. */
  minQuantity?: number;
  /** bxgy: lleva buyQuantity + getQuantity y getQuantity salen con el descuento. */
  buyQuantity?: number;
  getQuantity?: number;
  /** A qué aplica; vacío = todo el pedido. */
  scope?: DiscountScope;
  oncePerCustomer?: boolean;
}

export interface DiscountScope {
  productIds?: string[];
  collectionIds?: string[];
}

export type DiscountError = 'discount_invalid' | 'discount_inactive' | 'discount_not_started' | 'discount_expired' | 'discount_used_up' | 'discount_min_order' | 'discount_min_quantity' | 'discount_not_applicable';

export type ShippingKind = 'flat' | 'weight' | 'pickup';

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
  /** Retiro: dirección y horario que ve el cliente. */
  note?: string;
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
  productId?: string;
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
  /** Retiro en un local: no hace falta dirección. */
  pickup?: boolean;
  note?: string;
  /** Retiro: el impuesto es el del país del local. */
  taxCountry?: string;
}

export interface Totals {
  subtotalCents: number;
  /** Todo lo descontado, también por medio de pago. */
  discountCents: number;
  /** Parte de discountCents que viene del medio de pago elegido. */
  paymentDiscountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  /** Hay que pedir dirección (hay envío y no es retiro). */
  needsAddress: boolean;
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

/**
 * Descuento según las líneas: un alcance (productos o colecciones ya resueltos
 * a ids; null = todo), porcentaje o monto fijo sobre lo elegible, y "lleve X
 * pague Y": de cada grupo de buy + get unidades, las más baratas llevan el
 * descuento. Monedas sin decimales: redondea computeTotals.
 */
export function lineDiscountAmount(d: Pick<DiscountRule, 'kind' | 'value' | 'buyQuantity' | 'getQuantity'>, lines: MoneyLine[], eligible: Set<string> | null): number {
  const inScope = lines.filter((l) => !eligible || (l.productId != null && eligible.has(l.productId)));
  const base = subtotalOf(inScope);
  if (d.kind !== 'bxgy') return discountAmount(d, base);
  const buy = Math.max(0, Math.trunc(d.buyQuantity ?? 0));
  const get = Math.max(0, Math.trunc(d.getQuantity ?? 0));
  if (buy < 1 || get < 1) return 0;
  const units: number[] = [];
  for (const l of inScope) for (let i = 0; i < Math.min(999, l.quantity); i++) units.push(Math.max(0, Math.trunc(l.unitCents)));
  units.sort((a, b) => b - a);
  const groups = Math.floor(units.length / (buy + get));
  const bps = Math.min(10_000, Math.max(0, d.value));
  let off = 0;
  for (let g = 0; g < groups; g++) {
    const start = g * (buy + get);
    for (let i = start + buy; i < start + buy + get; i++) off += roundCents((units[i] * bps) / 10_000);
  }
  return Math.min(base, off);
}

/** Condiciones que dependen de las líneas (unidades mínimas, productos elegibles). null = se cumplen. */
export function discountLineError(d: Pick<DiscountRule, 'kind' | 'minQuantity' | 'buyQuantity' | 'getQuantity'>, lines: MoneyLine[], eligible: Set<string> | null): DiscountError | null {
  const inScope = lines.filter((l) => !eligible || (l.productId != null && eligible.has(l.productId)));
  const qty = inScope.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  if (eligible && qty === 0) return 'discount_not_applicable';
  const need = Math.max(d.minQuantity ?? 0, d.kind === 'bxgy' ? (d.buyQuantity ?? 0) + (d.getQuantity ?? 0) : 0);
  return qty < need ? 'discount_min_quantity' : null;
}

function rateApplies(rate: ShippingRate, country: string, weightGrams: number): boolean {
  if (rate.kind === 'pickup') return true;
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
  // Sin país todavía solo se puede ofrecer el retiro en un local.
  return rates
    .filter((r) => (country ? rateApplies(r, country, weightGrams) : r.kind === 'pickup'))
    .map((r) => {
      const free = r.freeOverCents != null && merchandiseCents >= r.freeOverCents;
      return {
        id: r.id,
        name: r.name,
        priceCents: free ? 0 : Math.max(0, r.priceCents),
        free,
        ...(r.kind === 'pickup' ? { pickup: true, note: r.note ?? '', taxCountry: r.countries[0] ?? '' } : {}),
      };
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
  /** Ya calculado por líneas (lineDiscountAmount); si está, reemplaza al cálculo sobre el subtotal. */
  discountCentsOverride?: number;
  /** Descuento del medio de pago, sobre lo que queda de mercadería (como Tiendanube: no toca el envío). */
  paymentDiscountBps?: number;
}

export function computeTotals(input: TotalsInput): Totals {
  const unit = input.currency && ZERO_DECIMAL.has(input.currency.toLowerCase()) ? 100 : 1;
  const toUnit = (n: number) => (unit === 1 ? n : Math.round(n / unit) * unit);
  const subtotalCents = subtotalOf(input.lines);
  const ruleDiscount = Math.min(subtotalCents, toUnit(input.discountCentsOverride ?? discountAmount(input.discount ?? null, subtotalCents)));
  const paymentBps = Math.min(10_000, Math.max(0, Math.trunc(input.paymentDiscountBps ?? 0)));
  const paymentDiscountCents = Math.min(subtotalCents - ruleDiscount, toUnit(roundCents(((subtotalCents - ruleDiscount) * paymentBps) / 10_000)));
  const discountCents = ruleDiscount + paymentDiscountCents;
  const merchandise = subtotalCents - discountCents;
  const needsShipping = input.lines.some((l) => l.requiresShipping !== false && l.quantity > 0);
  const weightGrams = weightOf(input.lines);
  const options = needsShipping ? shippingOptions(input.shippingRates, input.address, weightGrams, merchandise) : [];
  // El retiro solo se aplica si se eligió: nadie queda sin dirección por ser la opción más barata.
  let shipping = needsShipping ? (options.find((o) => o.id === input.shippingRateId) ?? options.find((o) => !o.pickup) ?? null) : null;
  const freeShippingByCode = input.discount?.kind === 'free_shipping' && shipping != null && shipping.priceCents > 0;
  if (shipping && input.discount?.kind === 'free_shipping') shipping = { ...shipping, priceCents: 0, free: true };
  const shippingCents = shipping?.priceCents ?? 0;

  const taxAddress = shipping?.pickup ? (shipping.taxCountry ? { country: shipping.taxCountry } : input.address) : input.address;
  const rate = taxRateFor(input.taxRates, taxAddress);
  const bps = rate ? Math.max(0, rate.rateBps) : 0;
  const taxable = merchandise + (rate?.appliesToShipping ? shippingCents : 0);
  const taxIncluded = Boolean(input.taxIncluded);
  // Incluido: la parte del precio que es impuesto (precio − precio / (1 + t)); no se suma.
  const taxCents = toUnit(bps === 0 ? 0 : taxIncluded ? roundCents(taxable - taxable / (1 + bps / 10_000)) : roundCents((taxable * bps) / 10_000));
  const totalCents = merchandise + shippingCents + (taxIncluded ? 0 : taxCents);
  return {
    subtotalCents,
    discountCents,
    paymentDiscountCents,
    shippingCents,
    taxCents,
    totalCents,
    needsAddress: needsShipping && !shipping?.pickup,
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
