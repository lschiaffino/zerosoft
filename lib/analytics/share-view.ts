/**
 * Lo que ve un visitante de un link público de Analytics: el resultado de cada
 * insight, nunca su definición (los filtros pueden tener emails o claves) ni
 * ids de personas. Caché corta por token, para que un link muy visitado no
 * corra las consultas en cada visita. Server-only.
 */
import { getDb } from '../db';
import { getDashboard, getInsight, listInsights } from './records';
import { runInsight } from './query';
import { shareByToken } from './records-more';
import type { ProjectRow } from './projects';
import type { InsightDto, InsightResult, TrendDisplay } from './types';

export interface PublicTile {
  name: string;
  display: TrendDisplay;
  result: InsightResult | null;
  error: boolean;
}

export interface PublicShareView {
  title: string;
  description: string;
  tiles: PublicTile[];
}

const TTL_MS = 60_000;
const MAX_TILES = 12;
const cache = new Map<string, { at: number; view: PublicShareView }>();

/** Quita lo que identifica personas del resultado. */
export function publicResult(r: InsightResult): InsightResult {
  return r.kind === 'funnel' ? { ...r, droppedPersons: r.droppedPersons.map(() => []) } : r;
}

async function tile(project: ProjectRow, i: InsightDto): Promise<PublicTile> {
  const display: TrendDisplay = i.query.kind === 'trends' ? i.query.display : 'line';
  try {
    return { name: i.name, display, result: publicResult(await runInsight(project, i.query)), error: false };
  } catch {
    return { name: i.name, display, result: null, error: true };
  }
}

export async function publicShareView(token: string): Promise<PublicShareView | null> {
  const share = await shareByToken(token);
  if (!share) {
    // Revocado: no queda nada en caché.
    cache.delete(token);
    return null;
  }
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.view;
  const project = (await getDb().prepare('SELECT * FROM analytics_projects WHERE id = ? AND deleted_at IS NULL').get(share.project_id)) as ProjectRow | undefined;
  if (!project) return null;
  let view: PublicShareView | null = null;
  if (share.insight_id) {
    const insight = await getInsight(project.id, share.insight_id);
    // Un resultado de SQL nunca sale por un link público.
    if (insight && insight.kind !== 'sql') view = { title: insight.name, description: insight.description, tiles: [await tile(project, insight)] };
  } else if (share.dashboard_id) {
    const dashboard = await getDashboard(project.id, share.dashboard_id);
    if (dashboard) {
      const all = await listInsights(project.id);
      const insights = dashboard.insightIds.map((id) => all.find((x) => x.id === id)).filter((x): x is InsightDto => Boolean(x) && x?.kind !== 'sql').slice(0, MAX_TILES);
      const tiles: PublicTile[] = [];
      for (const i of insights) tiles.push(await tile(project, i));
      view = { title: dashboard.name, description: dashboard.description, tiles };
    }
  }
  if (!view) return null;
  if (cache.size > 500) cache.clear();
  cache.set(token, { at: Date.now(), view });
  return view;
}
