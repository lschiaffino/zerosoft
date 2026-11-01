import { PARITY } from '@/content/feature-parity';
import type { ParityRow } from '@/content/feature-parity/types';
import { computeParity, rowWeight, type ParityScore } from '@/lib/feature-parity';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from '@/lib/products';

/**
 * Páginas de comparación (/compare/zerosoft-vs-<competidor> y
 * /compare/<competidor>-alternative). Salen de content/feature-parity: el
 * competidor es el de la tabla de paridad de cada app, así que el porcentaje,
 * lo que tenemos y lo que falta se actualizan solos cuando cambia ese archivo.
 * No hay páginas contra competidores que no tengan tabla.
 */

export type CompareKind = 'vs' | 'alternative';

export interface Comparison {
  product: ProductKey;
  name: string;
  competitor: string;
  /** "hubspot", "excalidraw-plus", "wispr-flow-granola". */
  slug: string;
  vsSlug: string;
  altSlug: string;
  lastReviewed: string;
  score: ParityScore;
}

/** "Excalidraw+" → "excalidraw-plus"; "Wispr Flow + Granola" → "wispr-flow-granola". */
export function competitorSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\+\s*$/, ' plus')
    .replace(/\+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function build(product: ProductKey): Comparison {
  const parity = PARITY[product];
  const slug = competitorSlug(parity.competitor);
  return {
    product,
    name: PRODUCT_CONFIG[product].name,
    competitor: parity.competitor,
    slug,
    vsSlug: `zerosoft-vs-${slug}`,
    altSlug: `${slug}-alternative`,
    lastReviewed: parity.lastReviewed,
    score: computeParity(parity.rows),
  };
}

/** Una comparación por app, en el orden del sitio. */
export function getComparisons(): Comparison[] {
  return PRODUCT_KEYS.map(build);
}

export function comparisonFor(product: ProductKey): Comparison {
  return build(product);
}

/** Todas las rutas /compare/<slug> que existen. */
export function compareSlugs(): string[] {
  return getComparisons().flatMap((c) => [c.vsSlug, c.altSlug]);
}

export function findComparison(slug: string): { kind: CompareKind; comparison: Comparison } | null {
  for (const c of getComparisons()) {
    if (c.vsSlug === slug) return { kind: 'vs', comparison: c };
    if (c.altSlug === slug) return { kind: 'alternative', comparison: c };
  }
  return null;
}

/** Lo más importante que tenemos: filas que el competidor tiene y nosotros también, primero las de peso 2. */
export function strongestRows(product: ProductKey, limit = 8): ParityRow[] {
  return PARITY[product].rows
    .filter((r) => r.competitorHas && (r.status === 'have' || r.status === 'better'))
    .sort((a, b) => rowWeight(b) - rowWeight(a))
    .slice(0, limit);
}

/** Lo que falta o está a medias, primero lo central (peso 2). */
export function gapRows(product: ProductKey): ParityRow[] {
  return PARITY[product].rows
    .filter((r) => r.competitorHas && (r.status === 'missing' || r.status === 'partial'))
    .sort((a, b) => rowWeight(b) - rowWeight(a) || (a.status === 'missing' ? -1 : 1));
}

/** Lo que hacemos y el competidor no. */
export function beyondRows(product: ProductKey): ParityRow[] {
  return PARITY[product].rows.filter((r) => !r.competitorHas && r.status === 'better');
}

/**
 * El precio de lista que cita la página de producto (pages.json →
 * products.<key>.compare) es del rival del sitio, que a veces no es el de la
 * tabla (Link se compara con Dub y cita a Bitly). Solo lo mostramos en la
 * comparación si es el mismo competidor.
 */
export function rivalMatches(competitor: string, rival: string): boolean {
  return competitorSlug(competitor) === competitorSlug(rival);
}
