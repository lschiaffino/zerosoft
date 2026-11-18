/**
 * Docs, analítica con el kit (el formato de Lines): páginas creadas y
 * editadas, quién edita y cuándo, vistas, lectores y comentarios de las
 * páginas que la persona ve (sin las de teamspaces cerrados o privados de los
 * que no es miembro), en un período contra el anterior. Y, para los admins,
 * el sitio publicado (lo que antes estaba en Ajustes › Sitio).
 *
 * - Ediciones: una por persona, página y hora (docs_edit_marks, más las
 *   versiones de antes de que existieran las marcas).
 * - Vistas: docs_page_views y docs_site_views guardan el día UTC, no la hora:
 *   cuentan por ese día.
 */
import { getDb } from './db';
import { teamspaceFilterSql } from './docs-access';
import { markHour, markHourMs } from './edit-marks';
import { analyticsRange, daySeries, localDay, rangeInfo, sumOf, tzOffsetSec, type AnalyticsRange, type Kpi, type RangeInfo, type RangeInput } from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

/** Un instante guardado como ISO o como datetime('now') de SQLite, en ms (NaN si no se lee). */
export function stampMs(v: string | null | undefined): number {
  if (!v) return NaN;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  return Date.parse(s);
}

/** Grilla 7 × 24 con un instante sumado en su día de la semana (0 = lunes) y hora local. */
export function heatAdd(heat: number[][], ms: number, tz: string, n = 1): void {
  const local = new Date(ms + tzOffsetSec(ms, tz) * 1000);
  heat[(local.getUTCDay() + 6) % 7][local.getUTCHours()] += n;
}

export interface DocsPageIn {
  id: string;
  title: string;
  icon: string | null;
  teamspace_id: string | null;
  created_at: string;
}

export interface DocsEditIn {
  page_id: string;
  person_id: string;
  /** Comienzo de la hora (ms). */
  at: number;
}

export interface DocsViewIn {
  page_id: string;
  viewer_id: string;
  day: string;
  views: number;
}

export interface DocsCommentIn {
  page_id: string;
  user_id: string;
  created_at: string;
}

export interface DocsDay {
  day: string;
  created: number;
  edits: number;
  views: number;
}

export interface DocsPersonStat {
  id: string;
  name: string;
  edits: number;
  pages: number;
  prevEdits: number;
}

export interface DocsSpaceStat {
  /** '' = páginas del workspace (sin teamspace). */
  id: string;
  name: string;
  edits: number;
  views: number;
  created: number;
}

export interface DocsPageStat {
  id: string;
  title: string;
  icon: string | null;
  views: number;
  readers: number;
  edits: number;
  editors: number;
  comments: number;
  lastEditAt: number | null;
}

export interface DocsAnalytics {
  range: RangeInfo;
  kpis: { created: Kpi; edited: Kpi; edits: Kpi; views: Kpi; readers: Kpi; comments: Kpi };
  perDay: DocsDay[];
  /** Vistas por día del período anterior (alineadas por posición). */
  prevViews: number[];
  /** Ediciones por día de la semana (0 = lunes) y hora local. */
  heat: number[][];
  people: DocsPersonStat[];
  spaces: DocsSpaceStat[];
  pages: DocsPageStat[];
  /** Teamspaces que ve (para el filtro). */
  spaceList: Array<{ id: string; name: string }>;
  pageCount: number;
}

export interface DocsAnalyticsInput {
  pages: DocsPageIn[];
  edits: DocsEditIn[];
  views: DocsViewIn[];
  comments: DocsCommentIn[];
  names: Map<string, string>;
  spaces: Array<{ id: string; name: string }>;
}

/** El filtro de teamspace: un id, o 'none' para las páginas del workspace. */
const inSpace = (p: Pick<DocsPageIn, 'teamspace_id'>, space: string | undefined) => !space || (space === 'none' ? !p.teamspace_id : p.teamspace_id === space);

/** Agrega lo leído (puro: lo prueban los tests). */
export function aggregateDocs(range: AnalyticsRange, input: DocsAnalyticsInput, space?: string): DocsAnalytics {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const prevSince = Date.parse(range.prevSince);
  const spaceNames = new Map(input.spaces.map((s) => [s.id, s.name]));
  const pages = new Map(input.pages.filter((p) => inSpace(p, space)).map((p) => [p.id, p]));
  const byDay = new Map<string, Omit<DocsDay, 'day'>>();
  const bump = (day: string, k: keyof Omit<DocsDay, 'day'>, n = 1) => {
    const v = byDay.get(day) ?? { created: 0, edits: 0, views: 0 };
    v[k] += n;
    byDay.set(day, v);
  };
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const pageStats = new Map<string, DocsPageStat & { editorSet: Set<string>; readerSet: Set<string> }>();
  const pageStat = (id: string) => {
    let s = pageStats.get(id);
    if (!s) {
      const p = pages.get(id)!;
      pageStats.set(id, (s = { id, title: p.title, icon: p.icon, views: 0, readers: 0, edits: 0, editors: 0, comments: 0, lastEditAt: null, editorSet: new Set(), readerSet: new Set() }));
    }
    return s;
  };
  const spaceStats = new Map<string, DocsSpaceStat>();
  const spaceStat = (p: DocsPageIn) => {
    const id = p.teamspace_id && spaceNames.has(p.teamspace_id) ? p.teamspace_id : '';
    let s = spaceStats.get(id);
    if (!s) spaceStats.set(id, (s = { id, name: spaceNames.get(id) ?? '', edits: 0, views: 0, created: 0 }));
    return s;
  };
  const people = new Map<string, DocsPersonStat & { pageSet: Set<string> }>();
  const person = (id: string) => {
    let s = people.get(id);
    if (!s) people.set(id, (s = { id, name: input.names.get(id) ?? '', edits: 0, pages: 0, prevEdits: 0, pageSet: new Set() }));
    return s;
  };

  const created = { cur: 0, prev: 0 };
  for (const p of pages.values()) {
    const ms = stampMs(p.created_at);
    if (!(ms >= prevSince && ms < until)) continue;
    bump(localDay(ms, range.tz), 'created');
    if (ms < since) created.prev += 1;
    else {
      created.cur += 1;
      spaceStat(p).created += 1;
    }
  }

  const edited = { cur: new Set<string>(), prev: new Set<string>() };
  const edits = { cur: 0, prev: 0 };
  for (const e of input.edits) {
    const p = pages.get(e.page_id);
    if (!p || !(e.at >= prevSince && e.at < until)) continue;
    bump(localDay(e.at, range.tz), 'edits');
    if (e.at < since) {
      edits.prev += 1;
      edited.prev.add(e.page_id);
      if (e.person_id) person(e.person_id).prevEdits += 1;
      continue;
    }
    edits.cur += 1;
    edited.cur.add(e.page_id);
    heatAdd(heat, e.at, range.tz);
    const s = pageStat(e.page_id);
    s.edits += 1;
    if (e.person_id) s.editorSet.add(e.person_id);
    s.lastEditAt = Math.max(s.lastEditAt ?? 0, e.at);
    spaceStat(p).edits += 1;
    const who = person(e.person_id);
    who.edits += 1;
    who.pageSet.add(e.page_id);
  }

  const views = { cur: 0, prev: 0 };
  const readers = { cur: new Set<string>(), prev: new Set<string>() };
  for (const v of input.views) {
    const p = pages.get(v.page_id);
    if (!p || v.day < range.prevFrom || v.day > range.to) continue;
    const n = Number(v.views) || 0;
    bump(v.day, 'views', n);
    if (v.day < range.from) {
      views.prev += n;
      readers.prev.add(v.viewer_id);
      continue;
    }
    views.cur += n;
    readers.cur.add(v.viewer_id);
    const s = pageStat(v.page_id);
    s.views += n;
    s.readerSet.add(v.viewer_id);
    spaceStat(p).views += n;
  }

  const comments = { cur: 0, prev: 0 };
  for (const c of input.comments) {
    if (!pages.has(c.page_id)) continue;
    const ms = stampMs(c.created_at);
    if (!(ms >= prevSince && ms < until)) continue;
    if (ms < since) comments.prev += 1;
    else {
      comments.cur += 1;
      pageStat(c.page_id).comments += 1;
    }
  }

  const { cur: perDay, prev } = daySeries(range, byDay, () => ({ created: 0, edits: 0, views: 0 }));
  return {
    range: rangeInfo(range),
    kpis: {
      created: { value: created.cur, prev: created.prev },
      edited: { value: edited.cur.size, prev: edited.prev.size },
      edits: { value: edits.cur, prev: edits.prev },
      views: { value: views.cur, prev: views.prev },
      readers: { value: readers.cur.size, prev: readers.prev.size },
      comments: { value: comments.cur, prev: comments.prev },
    },
    perDay,
    prevViews: prev.map((p) => p.views),
    heat,
    people: [...people.values()]
      .filter((p) => p.edits + p.prevEdits > 0)
      .map(({ pageSet, ...p }) => ({ ...p, pages: pageSet.size }))
      .sort((a, b) => b.edits - a.edits || b.pages - a.pages || a.name.localeCompare(b.name)),
    spaces: [...spaceStats.values()].filter((s) => s.edits + s.views + s.created > 0).sort((a, b) => b.edits - a.edits || b.views - a.views || a.name.localeCompare(b.name)),
    pages: [...pageStats.values()]
      .map(({ editorSet, readerSet, ...s }) => ({ ...s, editors: editorSet.size, readers: readerSet.size }))
      .sort((a, b) => b.views + b.edits - (a.views + a.edits) || b.comments - a.comments || a.title.localeCompare(b.title))
      .slice(0, 50),
    spaceList: input.spaces,
    pageCount: pages.size,
  };
}

/** Marcas de edición sin repetir (página, persona y hora). */
export function dedupeEdits(rows: Array<{ page_id: string; person_id: string | null; hour: string }>): DocsEditIn[] {
  const seen = new Map<string, DocsEditIn>();
  for (const r of rows) {
    const at = markHourMs(r.hour);
    if (!Number.isFinite(at)) continue;
    const key = `${r.page_id}|${r.person_id ?? ''}|${r.hour}`;
    if (!seen.has(key)) seen.set(key, { page_id: r.page_id, person_id: r.person_id ?? '', at });
  }
  return [...seen.values()];
}

export interface DocsViewer {
  workspaceId: string;
  /** Teamspaces cuyas páginas no ve. */
  hidden: string[];
}

/** La analítica de Docs de las páginas que ve quien mira (o de un teamspace). */
export async function docsAnalytics(viewer: DocsViewer, space: string | undefined, query: RangeInput = {}, now = new Date()): Promise<DocsAnalytics> {
  const range = analyticsRange(query, now);
  const db = getDb();
  const ws = viewer.workspaceId;
  const ts = teamspaceFilterSql(viewer.hidden, 'p.teamspace_id');
  // Un día de margen: las fechas viejas se guardaron como datetime('now') (con espacio, no "T").
  const from = new Date(Date.parse(range.prevSince) - 86_400_000).toISOString();
  const fromHour = markHour(new Date(from));
  const visible = `SELECT p.id FROM docs_pages p WHERE p.user_id = ? AND p.archived = 0${ts.sql}`;
  const [pages, marks, versions, views, comments, spaces] = await Promise.all([
    db.prepare(`SELECT p.id, p.title, p.icon, p.teamspace_id, p.created_at FROM docs_pages p WHERE p.user_id = ? AND p.archived = 0${ts.sql}`).all(ws, ...ts.args) as Promise<DocsPageIn[]>,
    db
      .prepare(`SELECT page_id, person_id, hour FROM docs_edit_marks WHERE workspace_id = ? AND hour >= ? AND page_id IN (${visible}) LIMIT 100000`)
      .all(ws, fromHour, ws, ...ts.args) as Promise<Array<{ page_id: string; person_id: string; hour: string }>>,
    db
      .prepare(`SELECT page_id, author_id AS person_id, created_at FROM docs_versions WHERE user_id = ? AND author_id IS NOT NULL AND kind != 'restore' AND created_at >= ? AND page_id IN (${visible}) LIMIT 100000`)
      .all(ws, from, ws, ...ts.args) as Promise<Array<{ page_id: string; person_id: string; created_at: string }>>,
    db
      .prepare(`SELECT page_id, viewer_id, day, views FROM docs_page_views WHERE day >= ? AND page_id IN (${visible}) LIMIT 200000`)
      .all(range.prevFrom, ws, ...ts.args) as Promise<DocsViewIn[]>,
    db
      .prepare(`SELECT page_id, user_id, created_at FROM docs_comments WHERE created_at >= ? AND page_id IN (${visible}) LIMIT 100000`)
      .all(from.slice(0, 10), ws, ...ts.args) as Promise<DocsCommentIn[]>,
    db
      .prepare(`SELECT id, name FROM docs_teamspaces WHERE workspace_id = ? AND deleted_at IS NULL${teamspaceFilterSql(viewer.hidden, 'id').sql} ORDER BY name`)
      .all(ws, ...teamspaceFilterSql(viewer.hidden, 'id').args) as Promise<Array<{ id: string; name: string }>>,
  ]);
  const edits = dedupeEdits([
    ...marks,
    ...versions.map((v) => {
      const ms = stampMs(v.created_at);
      return { page_id: v.page_id, person_id: v.person_id, hour: Number.isFinite(ms) ? markHour(new Date(ms)) : '' };
    }),
  ]);
  const ids = [...new Set(edits.map((e) => e.person_id).filter(Boolean))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await db.prepare(`SELECT id, name, email FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) as Array<{ id: string; name: string | null; email: string }>;
    for (const r of rows) names.set(r.id, r.name?.trim() || r.email);
  }
  const spaceId = space && (space === 'none' || spaces.some((s) => s.id === space)) ? space : undefined;
  return aggregateDocs(range, { pages, edits, views, comments, names, spaces }, spaceId);
}

export function isDocsAnalyticsEmpty(d: DocsAnalytics): boolean {
  const k = d.kpis;
  return d.pageCount === 0 || !(k.created.value || k.edits.value || k.views.value || k.comments.value || k.created.prev || k.edits.prev || k.views.prev);
}

const cache = shortCache<DocsAnalytics>();

/** Con la caché corta del kit. La clave lleva el workspace, lo que no ve, el teamspace y el rango. */
export function cachedDocsAnalytics(viewer: DocsViewer, space: string | undefined, query: RangeInput = {}): Promise<DocsAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([viewer.workspaceId, [...viewer.hidden].sort(), space ?? '', r.since, r.until, r.tz]), () => docsAnalytics(viewer, space, query, now));
}

// ---------- Sitio publicado (admins) ----------

export interface DocsSiteViewIn {
  page_id: string;
  day: string;
  visitor: string;
  views: number;
  referrer: string | null;
}

export interface DocsSiteAnalytics {
  range: RangeInfo;
  kpis: { views: Kpi; visitors: Kpi; pages: Kpi; helpful: Kpi };
  perDay: Array<{ day: string; views: number; visitors: number }>;
  prevViews: number[];
  pages: Array<{ id: string; title: string; views: number; visitors: number; helpful: number; notHelpful: number }>;
  referrers: Array<{ host: string; visitors: number }>;
  /** Hay páginas publicadas. */
  published: number;
}

/** Agrega las visitas del sitio (puro). La portada es page_id ''. */
export function aggregateDocsSite(
  range: AnalyticsRange,
  rows: DocsSiteViewIn[],
  titles: Map<string, string>,
  feedback: Array<{ page_id: string; helpful: number; created_at: string }>,
  published: number,
): DocsSiteAnalytics {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const prevSince = Date.parse(range.prevSince);
  const byDay = new Map<string, { views: number; visitors: Set<string> }>();
  const pages = new Map<string, { id: string; title: string; views: number; visitors: Set<string>; helpful: number; notHelpful: number }>();
  const refs = new Map<string, number>();
  const totals = { cur: { views: 0, visitors: new Set<string>(), pages: new Set<string>() }, prev: { views: 0, visitors: new Set<string>(), pages: new Set<string>() } };
  for (const r of rows) {
    if (r.day < range.prevFrom || r.day > range.to) continue;
    const n = Number(r.views) || 0;
    const d = byDay.get(r.day) ?? { views: 0, visitors: new Set<string>() };
    d.views += n;
    d.visitors.add(r.visitor);
    byDay.set(r.day, d);
    const side = r.day < range.from ? totals.prev : totals.cur;
    side.views += n;
    // El hash del visitante cambia cada día: un visitante por día.
    side.visitors.add(`${r.day}|${r.visitor}`);
    if (r.page_id) side.pages.add(r.page_id);
    if (side === totals.prev) continue;
    if (r.page_id && titles.has(r.page_id)) {
      const p = pages.get(r.page_id) ?? { id: r.page_id, title: titles.get(r.page_id) ?? '', views: 0, visitors: new Set<string>(), helpful: 0, notHelpful: 0 };
      p.views += n;
      p.visitors.add(`${r.day}|${r.visitor}`);
      pages.set(r.page_id, p);
    }
    if (r.referrer) refs.set(r.referrer, (refs.get(r.referrer) ?? 0) + 1);
  }
  const fb = { cur: { yes: 0, all: 0 }, prev: { yes: 0, all: 0 } };
  for (const f of feedback) {
    const ms = stampMs(f.created_at);
    if (!(ms >= prevSince && ms < until)) continue;
    const side = ms < since ? fb.prev : fb.cur;
    side.all += 1;
    if (Number(f.helpful) === 1) side.yes += 1;
    if (ms >= since && pages.has(f.page_id)) {
      const p = pages.get(f.page_id)!;
      if (Number(f.helpful) === 1) p.helpful += 1;
      else p.notHelpful += 1;
    }
  }
  const series = daySeries(range, new Map([...byDay].map(([day, v]) => [day, { views: v.views, visitors: v.visitors.size }])), () => ({ views: 0, visitors: 0 }));
  return {
    range: rangeInfo(range),
    kpis: {
      views: { value: totals.cur.views, prev: totals.prev.views },
      visitors: { value: totals.cur.visitors.size, prev: totals.prev.visitors.size },
      pages: { value: totals.cur.pages.size, prev: totals.prev.pages.size },
      helpful: { value: fb.cur.all ? fb.cur.yes / fb.cur.all : null, prev: fb.prev.all ? fb.prev.yes / fb.prev.all : null },
    },
    perDay: series.cur,
    prevViews: series.prev.map((p) => p.views),
    pages: [...pages.values()]
      .map((p) => ({ ...p, visitors: p.visitors.size }))
      .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title))
      .slice(0, 50),
    referrers: [...refs].map(([host, visitors]) => ({ host, visitors })).sort((a, b) => b.visitors - a.visitors || a.host.localeCompare(b.host)).slice(0, 10),
    published,
  };
}

/** Las visitas del sitio publicado del workspace (solo para admins: quien llama lo chequea). */
export async function docsSiteAnalytics(workspaceId: string, query: RangeInput = {}, now = new Date()): Promise<DocsSiteAnalytics> {
  const range = analyticsRange(query, now);
  const db = getDb();
  const [rows, pages, feedback] = await Promise.all([
    db
      .prepare('SELECT page_id, day, visitor, views, referrer FROM docs_site_views WHERE workspace_id = ? AND day >= ? AND day <= ? LIMIT 200000')
      .all(workspaceId, range.prevFrom, range.to) as Promise<DocsSiteViewIn[]>,
    db.prepare('SELECT id, title FROM docs_pages WHERE user_id = ? AND published = 1 AND archived = 0').all(workspaceId) as Promise<Array<{ id: string; title: string }>>,
    db
      .prepare(
        `SELECT f.page_id, f.helpful, f.created_at FROM docs_feedback f JOIN docs_pages p ON p.id = f.page_id
         WHERE p.user_id = ? AND p.published = 1 AND f.created_at >= ? LIMIT 100000`,
      )
      .all(workspaceId, range.prevFrom) as Promise<Array<{ page_id: string; helpful: number; created_at: string }>>,
  ]);
  return aggregateDocsSite(range, rows, new Map(pages.map((p) => [p.id, p.title])), feedback, pages.length);
}

const siteCache = shortCache<DocsSiteAnalytics>();

export function cachedDocsSiteAnalytics(workspaceId: string, query: RangeInput = {}): Promise<DocsSiteAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return siteCache.get(JSON.stringify([workspaceId, r.since, r.until, r.tz]), () => docsSiteAnalytics(workspaceId, query, now));
}

export function isDocsSiteEmpty(d: DocsSiteAnalytics): boolean {
  return !(d.kpis.views.value || d.kpis.views.prev);
}

export function clearDocsAnalyticsCache(): void {
  cache.clear();
  siteCache.clear();
}
