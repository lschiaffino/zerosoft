/**
 * Precios de zerosoft Cloud: el plan gratis por workspace y el uso por encima
 * de él. La regla es pública y la página la muestra entera: el precio es
 * nuestro costo de infraestructura × 3, y la tabla pone los dos números lado a
 * lado. La IA es la excepción: el costo del proveedor × 1,2.
 *
 * Los costos se midieron el 12 de octubre de 2026 (PRICING_MEASURED). Si
 * cambian, se cambia `cost` acá y el precio sale solo.
 */

/** Precio = costo × PRICE_MULTIPLIER. */
export const PRICE_MULTIPLIER = 3;
/** Tokens de IA: costo del proveedor × AI_MULTIPLIER. */
export const AI_MULTIPLIER = 1.2;
/** Mínimo mensual de un workspace pago, acreditado al uso. */
export const PAID_MINIMUM = 5;
/** Fecha en que se midieron los costos (ISO). */
export const PRICING_MEASURED = '2026-10-12';

export type UsageKey = 'clicks' | 'bookings' | 'emails' | 'storage';

export interface UsageRate {
  key: UsageKey;
  /** Cantidad incluida gratis por workspace y por mes, en la unidad base. */
  free: number;
  /** Bloque que se cobra (100.000 clics, 1.000 reservas, 1 GB por mes…). */
  block: number;
  /** Nuestro costo de infraestructura por bloque, en USD. */
  cost: number;
}

/**
 * Lo que se cobra por uso. Clics: $0,025 cada 1.000 → $2,50 cada 100.000.
 * Reservas: $0,012 cada una. Emails: $0,003 cada uno. Almacenamiento: $0,50
 * por GB al mes. El costo es el precio publicado ÷ 3.
 */
export const USAGE_RATES: readonly UsageRate[] = [
  { key: 'clicks', free: 25_000, block: 100_000, cost: 2.5 / PRICE_MULTIPLIER },
  { key: 'bookings', free: 50, block: 1_000, cost: 12 / PRICE_MULTIPLIER },
  { key: 'emails', free: 150, block: 1_000, cost: 3 / PRICE_MULTIPLIER },
  { key: 'storage', free: 0.5, block: 1, cost: 0.5 / PRICE_MULTIPLIER },
];

/** Precio por bloque: el costo × 3, redondeado al centavo. */
export function usagePrice(rate: UsageRate): number {
  return Math.round(rate.cost * PRICE_MULTIPLIER * 100) / 100;
}

/** Costo por bloque redondeado al centavo (lo que muestra la tabla). */
export function usageCost(rate: UsageRate): number {
  return Math.round(rate.cost * 100) / 100;
}
