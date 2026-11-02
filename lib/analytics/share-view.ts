/**
 * Lo que ve un visitante de un link público de Analytics: el resultado de cada
 * insight, nunca su definición (los filtros pueden tener emails o claves) ni
 * ids de personas. Caché corta por token, para que un link muy visitado no
 * corra las consultas en cada visita. Server-only.
 */
import { getDb } from '../db';
import { applyDashboard, layoutOf } from './dashboard-core';
import { getDashboard, getInsight, listInsights } from './records';
import { runInsight } from './query';
import { shareByToken, shareOptions, type ShareOptions } from './records-more';
import type { ProjectRow } from './projects';
import { shareableQuery, type DashboardSettings, type InsightDto, type InsightResult, type TrendDisplay } from './types';

export interface PublicTile {
  name: string;
  display: TrendDisplay;
  result: InsightResult | null;
  error: boolean;
  /** Tarjeta de texto (Markdown) en lugar de un insight. */
  text?: string;
  size?: 's' | 'm' | 'l';
}

export interface PublicShareView {
  title: string;
  description: string;
  tiles: PublicTile[];
  options: ShareOptions;
}

const TTL_MS = 60_000;
const MAX_TILES = 12;
const cache = new Map<string, { at: number; view: PublicShareView }>();

/** Quita lo que identifica personas del resultado. */
export function publicResult(r: InsightResult): InsightResult {
  if (r.kind === 'retention') return { ...r, drillPersons: undefined };
  return r.kind === 'funnel' ? { ...r, droppedPersons: r.droppedPersons.map(() => []), reachedPersons: undefined } : r;
}

async function tile(project: ProjectRow, i: InsightDto, settings?: DashboardSettings): Promise<PublicTile> {
  const display: TrendDisplay = i.query.kind === 'trends' ? i.query.display : 'line';
  const t = settings?.tiles[i.id];
  try {
    return { name: i.name, display, result: publicResult(await runInsight(project, applyDashboard(i.query, settings, t))), error: false, size: t?.size };
  } catch {
    return { name: i.name, display, result: null, error: true };
  }
}

export async function publicShareView(token: string, fresh = false): Promise<PublicShareView | null> {
  const share = await shareByToken(token);
  if (!share) {
    // Revocado: no queda nada en caché.
    cache.delete(token);
    return null;
  }
  const hit = cache.get(token);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.view;
  const project = (await getDb().prepare('SELECT * FROM analytics_projects WHERE id = ? AND deleted_at IS NULL').get(share.project_id)) as ProjectRow | undefined;
  if (!project) return null;
  let view: PublicShareView | null = null;
  const options = shareOptions(share);
  if (share.insight_id) {
    const insight = await getInsight(project.id, share.insight_id);
    // Un resultado de SQL nunca sale por un link público.
    if (insight && shareableQuery(insight.query)) view = { title: insight.name, description: insight.description, tiles: [await tile(project, insight)], options };
  } else if (share.dashboard_id) {
    const dashboard = await getDashboard(project.id, share.dashboard_id);
    if (dashboard) {
      const all = await listInsights(project.id);
      const insights = dashboard.insightIds.map((id) => all.find((x) => x.id === id)).filter((x): x is InsightDto => Boolean(x) && shareableQuery((x as InsightDto).query)).slice(0, MAX_TILES);
      const tiles: PublicTile[] = [];
      const byId = new Map(insights.map((i) => [i.id, i]));
      for (const ref of layoutOf(insights.map((i) => i.id), dashboard.settings)) {
        if (ref.kind === 'text') {
          const text = dashboard.settings.texts.find((x) => x.id === ref.id);
          if (text) tiles.push({ name: '', display: 'line', result: null, error: false, text: text.body });
        } else {
          tiles.push(await tile(project, byId.get(ref.id)!, dashboard.settings));
        }
      }
      view = { title: dashboard.name, description: dashboard.description, tiles, options };
    }
  }
  if (!view) return null;
  // Sin leyenda: la decide quien comparte.
  if (options.legend === false) {
    for (const t of view.tiles) if (t.result?.kind === 'trends') t.result = { ...t.result, options: { ...t.result.options, hideLegend: true } };
  }
  if (cache.size > 500) cache.clear();
  cache.set(token, { at: Date.now(), view });
  return view;
}
