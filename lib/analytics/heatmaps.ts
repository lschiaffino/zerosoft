/**
 * Heatmaps, las lecturas: rutas vistas, clics y scroll de una ruta. Todo con
 * tope de filas; los valores se validan en lib/analytics/heatmap-core.ts.
 * Server-only.
 */
import { getDb } from '../db';
import { originAllowed } from './ingest-core';
import { parseDomainList, type ProjectRow } from './projects';
import { aggregateClicks, aggregateScroll, BUCKET_WIDTH, frameableUrl, HEATMAP_LIMITS, type ClickAggregate, type ScrollStep, type ViewportBucket } from './heatmap-core';

export interface HeatmapPath {
  path: string;
  views: number;
}

export interface HeatmapResult extends ClickAggregate {
  width: number;
  frameUrl: string | null;
  scroll: { views: number; steps: ScrollStep[] };
  capped: boolean;
}

/** Rutas vistas en el período (sobre los últimos 20.000 $pageview), las más vistas primero. */
export async function heatmapPaths(project: Pick<ProjectRow, 'id'>, from: number): Promise<HeatmapPath[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT pathname, COUNT(*) AS n FROM (
         SELECT pathname FROM analytics_events WHERE project_id = ? AND event = '$pageview' AND ts >= ? AND pathname IS NOT NULL ORDER BY ts DESC LIMIT ${HEATMAP_LIMITS.maxEvents}
       ) GROUP BY pathname ORDER BY n DESC, pathname LIMIT 200`,
    )
    .all(project.id, from)) as Array<{ pathname: string; n: number }>;
  return rows.map((r) => ({ path: String(r.pathname).slice(0, 500), views: Number(r.n) }));
}

function hostCheck(project: Pick<ProjectRow, 'allowed_domains'>) {
  const domains = parseDomainList(project.allowed_domains);
  return (host: string) => !domains.length || originAllowed(`https://${host}`, domains);
}

export async function heatmapData(project: Pick<ProjectRow, 'id' | 'allowed_domains'>, opts: { path: string; from: number; to: number; bucket: ViewportBucket }): Promise<HeatmapResult> {
  const db = getDb();
  const clicks = (await db
    .prepare(
      `SELECT json_extract(properties, '$."$click_x"') AS x, json_extract(properties, '$."$click_y"') AS y,
         json_extract(properties, '$."$viewport_width"') AS viewport, json_extract(properties, '$."$document_height"') AS docHeight,
         json_extract(properties, '$."$el_tag"') AS tag, json_extract(properties, '$."$el_text"') AS text, json_extract(properties, '$."$el_href"') AS href
       FROM analytics_events
       WHERE project_id = ? AND event = '$autocapture' AND ts >= ? AND ts <= ? AND pathname = ?
         AND json_extract(properties, '$."$click_x"') IS NOT NULL
       ORDER BY ts DESC LIMIT ${HEATMAP_LIMITS.maxEvents}`,
    )
    .all(project.id, opts.from, opts.to, opts.path)) as Array<Record<string, unknown>>;
  const leaves = (await db
    .prepare(
      `SELECT json_extract(properties, '$."$pageview_id"') AS viewId, json_extract(properties, '$."$max_scroll_pct"') AS depth,
         json_extract(properties, '$."$viewport_width"') AS viewport
       FROM analytics_events
       WHERE project_id = ? AND event = '$pageleave' AND ts >= ? AND ts <= ? AND pathname = ?
       ORDER BY ts DESC LIMIT ${HEATMAP_LIMITS.maxEvents}`,
    )
    .all(project.id, opts.from, opts.to, opts.path)) as Array<Record<string, unknown>>;
  const agg = aggregateClicks(clicks as never, opts.bucket);
  const scroll = aggregateScroll(leaves as never, opts.bucket);

  // La URL más vista de esta ruta. Viene del cliente: pasa por frameableUrl y la página la muestra tal cual.
  const urls = (await db
    .prepare(
      `SELECT url, COUNT(*) AS n FROM (
         SELECT url FROM analytics_events WHERE project_id = ? AND event = '$pageview' AND ts >= ? AND ts <= ? AND pathname = ? AND url IS NOT NULL ORDER BY ts DESC LIMIT 2000
       ) GROUP BY url ORDER BY n DESC LIMIT 20`,
    )
    .all(project.id, opts.from, opts.to, opts.path)) as Array<{ url: string }>;
  const ok = hostCheck(project);
  let frameUrl: string | null = null;
  for (const u of urls) {
    frameUrl = frameableUrl(u.url, opts.path, ok);
    if (frameUrl) break;
  }
  return { ...agg, width: BUCKET_WIDTH[opts.bucket], frameUrl, scroll, capped: clicks.length >= HEATMAP_LIMITS.maxEvents };
}

/** ¿Esta URL salió de los eventos del proyecto? Solo esas se consultan desde el servidor. */
export async function urlSeen(project: Pick<ProjectRow, 'id' | 'allowed_domains'>, url: string, since: number): Promise<boolean> {
  const row = await getDb()
    .prepare(`SELECT 1 AS x FROM analytics_events WHERE project_id = ? AND event = '$pageview' AND ts >= ? AND url = ? LIMIT 1`)
    .get(project.id, since, url);
  if (!row) return false;
  try {
    const u = new URL(url);
    return frameableUrl(url, u.pathname, hostCheck(project)) !== null;
  } catch {
    return false;
  }
}
