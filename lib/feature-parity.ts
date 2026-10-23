import type { Localized, ParityRow, ParityStatus, ProductParity } from '@/content/feature-parity/types';

/**
 * Paridad de funciones: el porcentaje que muestran las páginas de producto.
 *
 * Fórmula (una sola, en computeParity): cuentan solo las filas que el
 * competidor tiene (competitorHas). Cada una suma su peso (1 o 2) por un
 * puntaje: have y better = 1, partial = 0,5, missing = 0. El porcentaje es la
 * suma sobre el total posible, truncado hacia abajo (61,9 se muestra 61).
 * Las filas better que el competidor no tiene no suman: se listan aparte.
 */

/** Puntaje de cada estado, en medios (para no arrastrar decimales). */
const HALVES: Record<ParityStatus, number> = { have: 2, better: 2, partial: 1, missing: 0 };

export interface ParityScore {
  /** Entero de 0 a 100, truncado (nunca redondea para arriba). */
  percent: number;
  /** Filas que cuentan (competitorHas). */
  counted: number;
  /** De las que cuentan: have + better. */
  have: number;
  partial: number;
  missing: number;
  /** Filas better que el competidor no tiene (no cuentan para el %). */
  beyond: number;
}

/** Peso de una fila (1 por defecto). */
export function rowWeight(row: Pick<ParityRow, 'weight'>): number {
  return row.weight ?? 1;
}

/** La fórmula. Sin filas que cuenten, 0. */
export function computeParity(rows: readonly ParityRow[]): ParityScore {
  let got = 0;
  let max = 0;
  const score: ParityScore = { percent: 0, counted: 0, have: 0, partial: 0, missing: 0, beyond: 0 };
  for (const row of rows) {
    if (!row.competitorHas) {
      if (row.status === 'better') score.beyond += 1;
      continue;
    }
    const w = rowWeight(row);
    got += w * HALVES[row.status];
    max += w * 2;
    score.counted += 1;
    if (row.status === 'have' || row.status === 'better') score.have += 1;
    else if (row.status === 'partial') score.partial += 1;
    else score.missing += 1;
  }
  // Enteros: got y max van en medios, así que la división no pierde precisión.
  score.percent = max === 0 ? 0 : Math.floor((got * 100) / max);
  return score;
}

export interface AreaScore extends ParityScore {
  id: string;
  label: Localized;
}

/** El mismo cálculo por área, en el orden de `areas`. Las áreas sin filas que cuenten quedan con counted = 0. */
export function computeAreas(parity: ProductParity): AreaScore[] {
  return parity.areas.map((a) => ({
    id: a.id,
    label: a.label,
    ...computeParity(parity.rows.filter((r) => r.area === a.id)),
  }));
}

/** Texto en el idioma de la página (en si el locale no existe). */
export function loc(text: Localized, locale: string): string {
  return (text as unknown as Record<string, string>)[locale] ?? text.en;
}

/**
 * Problemas de forma de un archivo de paridad (ids repetidos, áreas
 * inexistentes, fecha mal escrita, textos vacíos). Lista vacía = está bien.
 */
export function validateParity(parity: ProductParity): string[] {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parity.lastReviewed)) problems.push(`lastReviewed "${parity.lastReviewed}"`);
  const areaIds = new Set<string>();
  for (const a of parity.areas) {
    if (areaIds.has(a.id)) problems.push(`área repetida ${a.id}`);
    areaIds.add(a.id);
  }
  const ids = new Set<string>();
  for (const r of parity.rows) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id)) problems.push(`id inválido ${r.id}`);
    if (ids.has(r.id)) problems.push(`id repetido ${r.id}`);
    ids.add(r.id);
    if (!areaIds.has(r.area)) problems.push(`${r.id}: área ${r.area} no existe`);
    for (const text of [r.label, r.detail].filter(Boolean) as Localized[]) {
      if (!text.en?.trim() || !text.es?.trim() || !text.pt?.trim()) problems.push(`${r.id}: falta un idioma`);
    }
  }
  for (const a of parity.areas) {
    if (!parity.rows.some((r) => r.area === a.id)) problems.push(`área vacía ${a.id}`);
  }
  return problems;
}
