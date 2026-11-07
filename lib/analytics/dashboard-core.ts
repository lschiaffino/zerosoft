/**
 * Cómo un tablero cambia las consultas de sus insights y en qué orden van sus
 * tarjetas. Sin base de datos: lo usan la pantalla y los links públicos, así
 * ven lo mismo.
 */

import type { DashboardSettings, DashboardTile, InsightQuery } from './types';

export const EMPTY_DASHBOARD_SETTINGS: DashboardSettings = { filters: [], texts: [], order: [], tiles: {} };

/** Lo guardado puede venir incompleto o de antes: siempre un objeto entero. */
export function normalizeSettings(raw: Partial<DashboardSettings> | null | undefined): DashboardSettings {
  return {
    ...raw,
    filters: raw?.filters ?? [],
    texts: raw?.texts ?? [],
    order: raw?.order ?? [],
    tiles: raw?.tiles ?? {},
  };
}

/**
 * La consulta que corre una tarjeta. La fecha: primero la de la tarjeta, después
 * la del tablero, después la del insight. Retención y SQL van con la suya.
 * Una tarjeta que ignora los filtros del tablero no toma ni sus fechas ni sus filtros.
 */
export function applyDashboard(q: InsightQuery, settings: DashboardSettings | null | undefined, tile?: DashboardTile | null): InsightQuery {
  if (q.kind === 'sql') return q;
  const s = settings ?? EMPTY_DASHBOARD_SETTINGS;
  const board = !tile?.ignoreFilters;
  const out = { ...q } as InsightQuery & Record<string, unknown>;
  const range = tile?.dateRange ?? (board ? s.dateRange : null);
  if (range && 'dateRange' in q) (out as { dateRange: unknown }).dateRange = range;
  if (tile?.interval && (q.kind === 'trends' || q.kind === 'funnel' || q.kind === 'stickiness' || q.kind === 'lifecycle')) (out as { interval: unknown }).interval = tile.interval;
  if ('filters' in q) {
    const extra = [...(board ? s.filters : []), ...(tile?.filters ?? [])];
    if (extra.length) (out as { filters: unknown[] }).filters = [...q.filters, ...extra];
  }
  if (board && s.cohortId && q.kind !== 'paths') (out as { cohortId: unknown }).cohortId = s.cohortId;
  if (board && s.internal && s.internal !== 'inherit' && q.kind !== 'paths') (out as { excludeInternal: unknown }).excludeInternal = s.internal === 'on';
  if (q.kind === 'trends' && tile?.options) (out as { options: unknown }).options = { ...q.options, ...tile.options };
  return out;
}

export type TileRef = { kind: 'insight' | 'text'; id: string };

/** Insights y textos en el orden guardado; lo que no está en el orden va al final. */
export function layoutOf(insightIds: string[], settings: DashboardSettings): TileRef[] {
  const known = new Map<string, TileRef>();
  for (const id of insightIds) known.set(id, { kind: 'insight', id });
  for (const t of settings.texts) known.set(t.id, { kind: 'text', id: t.id });
  const out: TileRef[] = [];
  for (const id of settings.order) {
    const r = known.get(id);
    if (r) {
      out.push(r);
      known.delete(id);
    }
  }
  return [...out, ...known.values()];
}

/** El orden con una tarjeta corrida un lugar. */
export function moveInLayout(layout: TileRef[], id: string, delta: -1 | 1): string[] {
  const ids = layout.map((r) => r.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}

/** Copia o mueve una tarjeta de un tablero a otro: devuelve los dos estados nuevos. */
export function transferTile(
  from: { insightIds: string[]; settings: DashboardSettings },
  to: { insightIds: string[]; settings: DashboardSettings },
  ref: TileRef,
  move: boolean,
  newTextId: () => string,
): { from: { insightIds: string[]; settings: DashboardSettings }; to: { insightIds: string[]; settings: DashboardSettings } } {
  const toSettings: DashboardSettings = { ...to.settings, texts: [...to.settings.texts], tiles: { ...to.settings.tiles } };
  const toIds = [...to.insightIds];
  const fromSettings: DashboardSettings = { ...from.settings, texts: [...from.settings.texts], tiles: { ...from.settings.tiles }, order: from.settings.order.filter((x) => !move || x !== ref.id) };
  let fromIds = [...from.insightIds];
  if (ref.kind === 'insight') {
    if (!toIds.includes(ref.id)) toIds.push(ref.id);
    const tile = from.settings.tiles[ref.id];
    if (tile) toSettings.tiles[ref.id] = tile;
    if (move) {
      fromIds = fromIds.filter((x) => x !== ref.id);
      delete fromSettings.tiles[ref.id];
    }
  } else {
    const text = from.settings.texts.find((t) => t.id === ref.id);
    if (text) toSettings.texts.push({ id: newTextId(), body: text.body });
    if (move) fromSettings.texts = fromSettings.texts.filter((t) => t.id !== ref.id);
  }
  return { from: { insightIds: fromIds, settings: fromSettings }, to: { insightIds: toIds, settings: toSettings } };
}
