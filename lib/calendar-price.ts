/**
 * Precio de un tipo de evento: parseo de lo que escribe el dueño y límites
 * de Stripe. Sin dependencias de servidor (lo usa también el panel de cobro).
 * Los montos se guardan siempre en centavos (price_cents), también para
 * monedas sin decimales.
 */

/** Monedas sin decimales en Stripe: unit_amount va en unidades, no en centavos. */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['clp']);

/**
 * Mínimo por cargo que acepta Stripe (en centavos). Con un precio menor cada
 * Checkout falla: se rechaza al guardar. Monedas sin mínimo publicado: 1 unidad.
 */
const STRIPE_MIN_CENTS: Record<string, number> = {
  usd: 50,
  eur: 50,
  gbp: 30,
  brl: 50,
  mxn: 1000,
};

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase());
}

export function minimumPriceCents(currency: string): number {
  return STRIPE_MIN_CENTS[currency.toLowerCase()] ?? 100;
}

/** Grupos de miles bien formados: "15", "15.000", "1.500.000" (con el separador dado). */
function validThousands(intPart: string, sep: string): boolean {
  const groups = intPart.split(sep);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/**
 * Convierte lo que escribió el dueño en centavos, aceptando separador de
 * miles con punto o coma ("15.000", "1,500.50", "1.500,50"). Un solo
 * separador seguido de exactamente 3 dígitos es de miles ("15.000" son quince
 * mil); con 1 o 2 dígitos es decimal ("15.5", "15,50"). Monedas sin decimales
 * no aceptan centavos. Devuelve null si el texto no es un monto válido.
 */
export function parsePriceInput(input: string, currency: string): number | null {
  const raw = input.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(raw)) return null;
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let intPart = raw;
  let decPart = '';
  if (lastDot >= 0 && lastComma >= 0) {
    // Los dos: el último es el decimal y el otro, el de miles.
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    const at = raw.lastIndexOf(decSep);
    intPart = raw.slice(0, at);
    decPart = raw.slice(at + 1);
    if (intPart.includes(decSep) || !validThousands(intPart, thouSep)) return null;
    intPart = intPart.split(thouSep).join('');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = raw.split(sep);
    if (parts.length > 2 || parts[1].length === 3) {
      if (!validThousands(raw, sep)) return null;
      intPart = parts.join('');
    } else {
      intPart = parts[0];
      decPart = parts[1];
    }
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  if (isZeroDecimal(currency) && /[1-9]/.test(decPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Texto inicial del input para un precio guardado (sin ",00" en monedas sin decimales). */
export function priceInputValue(priceCents: number, currency: string): string {
  if (priceCents <= 0) return '0';
  return isZeroDecimal(currency) ? String(Math.round(priceCents / 100)) : (priceCents / 100).toFixed(2);
}

/**
 * Problema de un precio para la moneda (null si se puede cobrar): con
 * centavos en una moneda sin decimales, o por debajo del mínimo de Stripe.
 * 0 es gratis y siempre vale.
 */
export function priceProblem(priceCents: number, currency: string): 'zero_decimal' | 'below_minimum' | null {
  if (priceCents === 0) return null;
  if (isZeroDecimal(currency) && priceCents % 100 !== 0) return 'zero_decimal';
  if (priceCents < minimumPriceCents(currency)) return 'below_minimum';
  return null;
}
