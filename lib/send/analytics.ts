/**
 * Send: números por documento, link, versión y visitante. Server-only. Todo sale de
 * los avisos que mandó el navegador (send_page_stats); nada se estima.
 */
import { csvLine } from '../form-engine';
import { getDb } from '../db';
import { completionPct, LIVE_WINDOW_MS } from './types';

export interface VisitDto {
  id: string;
  linkId: string;
  linkName: string;
  versionId: string;
  versionN: number;
  visitorKey: string;
  email: string | null;
  emailVerified: boolean;
  forwarded: boolean;
  startedAt: string;
  lastPingAt: string;
  seconds: number;
  pagesSeen: number;
  pageTotal: number;
  completion: number;
  downloads: number;
  device: string;
  os: string;
  browser: string;
  country: string | null;
  city: string | null;
  live: boolean;
  pages: Array<{ page: number; seconds: number }>;
  returning: boolean;
}

export interface PageStat {
  page: number;
  /** Segundos promedio entre las visitas que llegaron a la página. */
  avgSeconds: number;
  totalSeconds: number;
  visits: number;
  /** % de las visitas que llegaron a esta página. */
  reach: number;
}

export interface VisitorDto {
  key: string;
  email: string | null;
  verified: boolean;
  forwarded: boolean;
  visits: number;
  seconds: number;
  bestCompletion: number;
  lastSeenAt: string;
  downloads: number;
  contactId: string | null;
}

export interface VersionStat {
  versionId: string;
  n: number;
  visits: number;
  avgCompletion: number;
  avgSeconds: number;
}

export interface DocumentAnalytics {
  totals: { visits: number; visitors: number; seconds: number; avgSeconds: number; avgCompletion: number; downloads: number; live: number };
  pages: PageStat[];
  visits: VisitDto[];
  visitors: VisitorDto[];
  versions: VersionStat[];
  denied: Array<{ email: string | null; at: string; linkName: string }>;
}

interface VisitRow {
  id: string;
  link_id: string;
  link_name: string | null;
  version_id: string;
  version_n: number;
  visitor_id: string | null;
  session_id: string;
  email: string | null;
  email_verified: number;
  forwarded: number;
  started_at: string;
  last_ping_at: string;
  seconds: number;
  pages_seen: number;
  page_total: number;
  downloads: number;
  device: string;
  os: string;
  browser: string;
  country: string | null;
  city: string | null;
  contact_id: string | null;
}

const VISIT_LIMIT = 500;

export async function documentAnalytics(documentId: string, opts: { versionId?: string; linkId?: string } = {}): Promise<DocumentAnalytics> {
  const db = getDb();
  const where = ['s.document_id = ?'];
  const args: string[] = [documentId];
  if (opts.versionId) {
    where.push('s.version_id = ?');
    args.push(opts.versionId);
  }
  if (opts.linkId) {
    where.push('s.link_id = ?');
    args.push(opts.linkId);
  }
  const rows = (await db
    .prepare(
      `SELECT s.*, l.name AS link_name, v.n AS version_n, r.contact_id AS contact_id
       FROM send_visits s
       LEFT JOIN send_links l ON l.id = s.link_id
       LEFT JOIN send_versions v ON v.id = s.version_id
       LEFT JOIN send_visitors r ON r.id = s.visitor_id
       WHERE ${where.join(' AND ')} ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(...args, VISIT_LIMIT)) as VisitRow[];
  const ids = rows.map((r) => r.id);
  const byVisit = new Map<string, Array<{ page: number; seconds: number }>>();
  // De a 100 ids: libsql limita los parámetros por consulta.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const stats = (await db
      .prepare(`SELECT visit_id, page, seconds FROM send_page_stats WHERE visit_id IN (${chunk.map(() => '?').join(',')}) ORDER BY page`)
      .all(...chunk)) as Array<{ visit_id: string; page: number; seconds: number }>;
    for (const s of stats) {
      const list = byVisit.get(s.visit_id) ?? [];
      list.push({ page: Number(s.page), seconds: Math.round(Number(s.seconds) * 10) / 10 });
      byVisit.set(s.visit_id, list);
    }
  }
  const liveSince = Date.now() - LIVE_WINDOW_MS;
  const firstOfVisitor = new Map<string, string>();
  for (const r of [...rows].reverse()) {
    const key = r.visitor_id ?? r.session_id;
    if (!firstOfVisitor.has(key)) firstOfVisitor.set(key, r.id);
  }
  const visits: VisitDto[] = rows.map((r) => {
    const key = r.visitor_id ?? r.session_id;
    return {
      id: r.id,
      linkId: r.link_id,
      linkName: r.link_name ?? '',
      versionId: r.version_id,
      versionN: Number(r.version_n ?? 1),
      visitorKey: key,
      email: r.email,
      emailVerified: !!r.email_verified,
      forwarded: !!r.forwarded,
      startedAt: r.started_at,
      lastPingAt: r.last_ping_at,
      seconds: Math.round(Number(r.seconds) * 10) / 10,
      pagesSeen: Number(r.pages_seen),
      pageTotal: Number(r.page_total),
      completion: completionPct(Number(r.pages_seen), Number(r.page_total)),
      downloads: Number(r.downloads),
      device: r.device,
      os: r.os,
      browser: r.browser,
      country: r.country,
      city: r.city,
      live: new Date(r.last_ping_at).getTime() >= liveSince,
      pages: byVisit.get(r.id) ?? [],
      returning: firstOfVisitor.get(key) !== r.id,
    };
  });

  // Por página: sobre las visitas que pasaron por ella.
  const perPage = new Map<number, { total: number; visits: number }>();
  for (const v of visits) {
    for (const p of v.pages) {
      if (p.seconds < 1) continue;
      const cur = perPage.get(p.page) ?? { total: 0, visits: 0 };
      cur.total += p.seconds;
      cur.visits++;
      perPage.set(p.page, cur);
    }
  }
  const pageTotal = visits.reduce((m, v) => Math.max(m, v.pageTotal), 0);
  const pages: PageStat[] = [];
  for (let page = 1; page <= pageTotal; page++) {
    const s = perPage.get(page);
    pages.push({
      page,
      totalSeconds: Math.round((s?.total ?? 0) * 10) / 10,
      visits: s?.visits ?? 0,
      avgSeconds: s ? Math.round((s.total / s.visits) * 10) / 10 : 0,
      reach: visits.length ? Math.round(((s?.visits ?? 0) / visits.length) * 100) : 0,
    });
  }

  const people = new Map<string, VisitorDto>();
  for (const v of visits) {
    const cur = people.get(v.visitorKey) ?? {
      key: v.visitorKey,
      email: v.email,
      verified: false,
      forwarded: false,
      visits: 0,
      seconds: 0,
      bestCompletion: 0,
      lastSeenAt: v.lastPingAt,
      downloads: 0,
      contactId: rows.find((r) => r.id === v.id)?.contact_id ?? null,
    };
    cur.verified ||= v.emailVerified;
    cur.forwarded ||= v.forwarded;
    cur.visits++;
    cur.seconds = Math.round((cur.seconds + v.seconds) * 10) / 10;
    cur.bestCompletion = Math.max(cur.bestCompletion, v.completion);
    cur.downloads += v.downloads;
    if (v.lastPingAt > cur.lastSeenAt) cur.lastSeenAt = v.lastPingAt;
    people.set(v.visitorKey, cur);
  }

  const versionRows = (await db
    .prepare(
      `SELECT v.id, v.n, COUNT(s.id) AS visits, AVG(s.seconds) AS avg_seconds,
         AVG(CASE WHEN s.page_total > 0 THEN MIN(100.0, s.pages_seen * 100.0 / s.page_total) END) AS avg_completion
       FROM send_versions v LEFT JOIN send_visits s ON s.version_id = v.id
       WHERE v.document_id = ? GROUP BY v.id, v.n ORDER BY v.n DESC`,
    )
    .all(documentId)) as Array<{ id: string; n: number; visits: number; avg_seconds: number | null; avg_completion: number | null }>;

  const seconds = visits.reduce((n, v) => n + v.seconds, 0);
  const denied = (await db
    .prepare(
      `SELECT e.email, e.created_at, l.name AS link_name FROM send_events e LEFT JOIN send_links l ON l.id = e.link_id
       WHERE e.document_id = ? AND e.type = 'denied' ORDER BY e.created_at DESC LIMIT 50`,
    )
    .all(documentId)) as Array<{ email: string | null; created_at: string; link_name: string | null }>;
  return {
    totals: {
      visits: visits.length,
      visitors: people.size,
      seconds: Math.round(seconds * 10) / 10,
      avgSeconds: visits.length ? Math.round((seconds / visits.length) * 10) / 10 : 0,
      avgCompletion: visits.length ? Math.round(visits.reduce((n, v) => n + v.completion, 0) / visits.length) : 0,
      downloads: visits.reduce((n, v) => n + v.downloads, 0),
      live: new Set(visits.filter((v) => v.live).map((v) => v.visitorKey)).size,
    },
    pages,
    visits,
    visitors: [...people.values()].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1)),
    versions: versionRows.map((v) => ({
      versionId: v.id,
      n: Number(v.n),
      visits: Number(v.visits),
      avgCompletion: Math.round(Number(v.avg_completion ?? 0)),
      avgSeconds: Math.round(Number(v.avg_seconds ?? 0) * 10) / 10,
    })),
    denied: denied.map((d) => ({ email: d.email, at: d.created_at, linkName: d.link_name ?? '' })),
  };
}

/** Quién está leyendo ahora: lo que mira el panel cada pocos segundos. */
export async function liveReaders(documentId: string): Promise<Array<{ email: string | null; emailVerified: boolean; country: string | null; city: string | null; linkName: string }>> {
  const since = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT s.session_id, s.email, s.email_verified, s.country, s.city, l.name AS link_name FROM send_visits s LEFT JOIN send_links l ON l.id = s.link_id
       WHERE s.document_id = ? AND s.last_ping_at >= ? ORDER BY s.last_ping_at DESC LIMIT 50`,
    )
    .all(documentId, since)) as Array<{ session_id: string; email: string | null; email_verified: number; country: string | null; city: string | null; link_name: string | null }>;
  const seen = new Set<string>();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.session_id)) continue;
    seen.add(r.session_id);
    out.push({ email: r.email, emailVerified: !!r.email_verified, country: r.country, city: r.city, linkName: r.link_name ?? '' });
  }
  return out;
}

/** CSV de todas las visitas del documento, con una columna por página. */
export function analyticsCsv(a: DocumentAnalytics): string {
  const pageCount = a.pages.length;
  const head = [
    'visit_id',
    'started_at',
    'last_seen_at',
    'link',
    'version',
    'email',
    'email_status',
    'forwarded',
    'returning_visit',
    'device',
    'os',
    'browser',
    'country',
    'city',
    'seconds',
    'pages_seen',
    'pages_total',
    'completion_pct',
    'downloads',
    ...Array.from({ length: pageCount }, (_, i) => `page_${i + 1}_seconds`),
  ];
  const lines = [csvLine(head)];
  for (const v of a.visits) {
    const byPage = new Map(v.pages.map((p) => [p.page, p.seconds]));
    lines.push(
      csvLine([
        v.id,
        v.startedAt,
        v.lastPingAt,
        v.linkName,
        v.versionN,
        v.email ?? '',
        v.email ? (v.emailVerified ? 'verified' : 'unverified') : '',
        v.forwarded ? 'yes' : 'no',
        v.returning ? 'yes' : 'no',
        v.device,
        v.os,
        v.browser,
        v.country ?? '',
        v.city ?? '',
        v.seconds,
        v.pagesSeen,
        v.pageTotal,
        v.completion,
        v.downloads,
        ...Array.from({ length: pageCount }, (_, i) => byPage.get(i + 1) ?? 0),
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
