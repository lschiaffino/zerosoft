/**
 * Elegir el gráfico. Puro: lo usan el cliente, los links públicos y los
 * tests. Reglas: un solo número → número; fecha + números → línea; texto +
 * un número con pocas filas → barras; el resto, tabla. Torta y embudo solo si
 * la persona los elige (y tienen sentido).
 */
import type { SchemaColumn, Viz, VizType } from './types';

export interface ResolvedViz {
  type: Exclude<VizType, 'auto'>;
  x: number;
  ys: number[];
}

export function pickViz(columns: SchemaColumn[], rowCount: number, viz: Viz = { type: 'auto' }): ResolvedViz {
  const idx = (name: string | undefined) => (name ? columns.findIndex((c) => c.name === name) : -1);
  const numeric = columns.map((c, i) => (c.type === 'number' ? i : -1)).filter((i) => i >= 0);
  const dateCol = columns.findIndex((c) => c.type === 'date');
  const textCol = columns.findIndex((c) => c.type === 'text');
  const want = viz.type ?? 'auto';

  let x = idx(viz.x);
  let ys = (viz.y ?? []).map(idx).filter((i) => i >= 0 && columns[i].type === 'number');

  if (want === 'table') return { type: 'table', x: 0, ys: [] };
  if (want === 'number') return numeric.length ? { type: 'number', x: -1, ys: [ys[0] ?? numeric[0]] } : { type: 'table', x: 0, ys: [] };

  if (x < 0) x = dateCol >= 0 ? dateCol : textCol >= 0 ? textCol : -1;
  if (!ys.length) ys = numeric.filter((i) => i !== x);

  if (want !== 'auto') {
    if (x < 0 || !ys.length) return { type: 'table', x: 0, ys: [] };
    if (want === 'pie' || want === 'funnel') return { type: want, x, ys: [ys[0]] };
    return { type: want, x, ys };
  }

  // Automático.
  if (rowCount === 1 && numeric.length === 1 && columns.length === 1) return { type: 'number', x: -1, ys: [numeric[0]] };
  if (rowCount === 1 && numeric.length >= 1 && columns.length <= 2 && x < 0) return { type: 'number', x: -1, ys: [numeric[0]] };
  if (x >= 0 && ys.length && rowCount > 1) {
    if (columns[x].type === 'date') return { type: 'line', x, ys: ys.slice(0, 4) };
    if (rowCount <= 30 && columns.length <= 3) return { type: 'bar', x, ys: ys.slice(0, 3) };
  }
  return { type: 'table', x: 0, ys: [] };
}

/** Tipos que se pueden ofrecer para un resultado (selector de visualización). */
export function vizOptions(columns: SchemaColumn[]): Array<Exclude<VizType, 'auto'>> {
  const hasNum = columns.some((c) => c.type === 'number');
  const hasDim = columns.some((c) => c.type !== 'number');
  const out: Array<Exclude<VizType, 'auto'>> = ['table'];
  if (hasNum) out.push('number');
  if (hasNum && hasDim) out.push('line', 'bar', 'area', 'pie', 'funnel');
  return out;
}

/** Valor legible para tablas y números (locale del navegador o del pedido). */
export function formatValue(v: unknown, locale = 'en', type?: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    const abs = Math.abs(v);
    return new Intl.NumberFormat(locale, { maximumFractionDigits: abs >= 100 ? 0 : abs >= 1 ? 2 : 4 }).format(v);
  }
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2} 00:00:00$/.test(v)) return v.slice(0, 10);
  return String(v);
}
