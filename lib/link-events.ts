/**
 * Stream de eventos de Link (como la pestaña Events de Dub): clicks,
 * escaneos, leads y ventas de los links que quien mira puede ver, lo más
 * nuevo primero. La UI pide lo nuevo cada pocos segundos con dos cursores
 * (id de clicks e id de conversiones: ambas tablas son autoincrementales),
 * así cada consulta es un range scan por clave primaria. Server-only.
 */
import { getDb } from './db';
import { visibleLinksSql, type LinkViewer } from './link-folders';
import { shortUrl } from './utils';

export interface LinkEvent {
  /** 'c<id>' (click) o 'v<id>' (conversión): único entre las dos tablas. */
  key: string;
  type: 'click' | 'scan' | 'lead' | 'sale';
  ts: string;
  linkId: string;
  shortUrl: string;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  referrer: string | null;
  eventName: string | null;
  amount: number | null;
  currency: string | null;
}

export interface LinkEventsCursor {
  click: number;
  conv: number;
}

export interface LinkEventsPage {
  events: LinkEvent[];
  cursor: LinkEventsCursor;
}

export interface LinkEventsOptions {
  viewer?: LinkViewer;
  linkId?: string;
  /** Sin cursor: los últimos `limit`. Con cursor: lo posterior (hasta `limit`). */
  after?: LinkEventsCursor | null;
  limit?: number;
}

export function parseEventsCursor(click: string | null, conv: string | null): LinkEventsCursor | null {
  const c = Number(click);
  const v = Number(conv);
  if (!Number.isFinite(c) || !Number.isFinite(v) || click === null || conv === null) return null;
  return { click: Math.max(0, Math.floor(c)), conv: Math.max(0, Math.floor(v)) };
}

export async function listLinkEvents(userId: string, opts: LinkEventsOptions = {}): Promise<LinkEventsPage> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const vis = visibleLinksSql(opts.viewer);
  // Sin cursor: el punto de partida son los ids máximos de ahora (también con la lista vacía);
  // se leen antes, así nada de lo que entre después queda debajo del cursor sin mostrarse.
  const maxRow = opts.after
    ? null
    : ((await db
        .prepare('SELECT (SELECT COALESCE(MAX(id), 0) FROM clicks) AS c, (SELECT COALESCE(MAX(id), 0) FROM link_conversions) AS v')
        .get()) as { c: number; v: number });
  const where = (alias: string) => {
    const parts = ['l.user_id = ?'];
    const args: Array<string | number> = [userId];
    if (opts.linkId) {
      parts.push('l.id = ?');
      args.push(opts.linkId);
    }
    if (vis.sql) {
      parts.push(vis.sql);
      args.push(...vis.args);
    }
    if (opts.after) {
      parts.push(`${alias}.id > ?`);
      args.push(alias === 'c' ? opts.after.click : opts.after.conv);
    } else if (maxRow) {
      parts.push(`${alias}.id <= ?`);
      args.push(alias === 'c' ? Number(maxRow.c) : Number(maxRow.v));
    }
    return { sql: parts.join(' AND '), args };
  };
  const wc = where('c');
  const wv = where('v');
  // Con cursor: lo más viejo primero dentro de lo nuevo (para no saltear si hay más de `limit`).
  const order = opts.after ? 'ASC' : 'DESC';
  const [clicks, convs] = await Promise.all([
    db
      .prepare(
        `SELECT c.id, c.ts, c.source, c.country, c.city, c.device, c.browser, c.referrer, l.id AS link_id, l.slug, d.hostname AS host
         FROM clicks c JOIN links l ON l.id = c.link_id LEFT JOIN link_domains d ON d.id = l.domain_id
         WHERE ${wc.sql} ORDER BY c.id ${order} LIMIT ?`,
      )
      .all(...wc.args, limit) as Promise<
      Array<{
        id: number;
        ts: string;
        source: string;
        country: string | null;
        city: string | null;
        device: string | null;
        browser: string | null;
        referrer: string | null;
        link_id: string;
        slug: string;
        host: string | null;
      }>
    >,
    db
      .prepare(
        `SELECT v.id, v.ts, v.type, v.event_name, v.amount, v.currency, v.country, v.device, l.id AS link_id, l.slug, d.hostname AS host
         FROM link_conversions v JOIN links l ON l.id = v.link_id LEFT JOIN link_domains d ON d.id = l.domain_id
         WHERE ${wv.sql} ORDER BY v.id ${order} LIMIT ?`,
      )
      .all(...wv.args, limit) as Promise<
      Array<{
        id: number;
        ts: string;
        type: 'lead' | 'sale';
        event_name: string;
        amount: number;
        currency: string | null;
        country: string | null;
        device: string | null;
        link_id: string;
        slug: string;
        host: string | null;
      }>
    >,
  ]);
  const events: LinkEvent[] = [
    ...clicks.map((r) => ({
      key: `c${r.id}`,
      type: (r.source === 'qr' ? 'scan' : 'click') as LinkEvent['type'],
      ts: r.ts,
      linkId: r.link_id,
      shortUrl: shortUrl(r.slug, r.host),
      country: r.country,
      city: r.city,
      device: r.device,
      browser: r.browser,
      referrer: r.referrer,
      eventName: null,
      amount: null,
      currency: null,
    })),
    ...convs.map((r) => ({
      key: `v${r.id}`,
      type: r.type,
      ts: r.ts,
      linkId: r.link_id,
      shortUrl: shortUrl(r.slug, r.host),
      country: r.country,
      city: null,
      device: r.device,
      browser: null,
      referrer: null,
      eventName: r.event_name,
      amount: r.type === 'sale' ? Number(r.amount) : null,
      currency: r.type === 'sale' ? r.currency : null,
    })),
  ].sort((a, b) => (a.ts === b.ts ? b.key.localeCompare(a.key) : b.ts.localeCompare(a.ts)));

  const cursor: LinkEventsCursor = opts.after
    ? {
        click: clicks.length ? Math.max(...clicks.map((r) => Number(r.id))) : opts.after.click,
        conv: convs.length ? Math.max(...convs.map((r) => Number(r.id))) : opts.after.conv,
      }
    : { click: Number(maxRow?.c ?? 0), conv: Number(maxRow?.v ?? 0) };
  return { events: events.slice(0, opts.after ? limit * 2 : limit), cursor };
}
