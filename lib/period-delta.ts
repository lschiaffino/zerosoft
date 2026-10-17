export type PeriodDelta =
  | { kind: 'none' }
  | { kind: 'change'; text: string; dir: 'up' | 'down' | 'flat' };

/**
 * Variación contra el período anterior de igual largo. Sin clicks antes no hay
 * contra qué comparar ("Sin período anterior"); null = el rango no tiene
 * período anterior (p. ej. "Todo") y no se muestra nada.
 */
export function periodDelta(now: number, prev: number | null): PeriodDelta | null {
  if (prev === null) return null;
  if (prev === 0) return { kind: 'none' };
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return { kind: 'change', text: '0%', dir: 'flat' };
  return { kind: 'change', text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' };
}
