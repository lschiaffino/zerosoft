/**
 * Errores de Analytics: los $exception agrupados por huella (se calcula en la
 * ingesta), su estado y responsable en analytics_error_issues y las
 * regresiones (un resuelto con una aparición más nueva). Las lecturas agregan
 * en SQL sobre las últimas SCAN_CAP filas. Server-only.
 */
import { getDb } from '../db';
import { bucketList, bucketOf, resolveRange } from './compute';
import { localized } from '../notification-copy';
import { listOwnerSpacePeople } from '../workspace';
import type { ProjectRow } from './projects';
import { cleanFrames } from './errors-core';
import { issueRef, type IssueDetail, type IssueEffectiveStatus, type IssueFilter, type IssueListResult, type IssueOccurrence, type IssueRow, type IssueStatus } from './more-types';
import { projectTz } from './tz';

const SCAN_CAP = 200_000;
const LIST_CAP = 100;
const SPARK_BUCKETS = 24;

const FP = `json_extract(e.properties, '$."$exception_fingerprint"')`;
const TYPE = `json_extract(ev.properties, '$."$exception_type"')`;
const MESSAGE = `json_extract(ev.properties, '$."$exception_message"')`;

/** Estado efectivo: un resuelto con una aparición posterior es una regresión, aunque el cron todavía no haya pasado. */
const EFFECTIVE = `CASE WHEN s.status = 'resolved' AND agg.last_seen > COALESCE(s.resolved_at, 0) THEN 'regression' ELSE COALESCE(s.status, 'open') END`;

const asStatus = (v: unknown): IssueEffectiveStatus => (v === 'resolved' || v === 'ignored' || v === 'regression' ? v : 'open');
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');

const eventsCte = `ev AS (
  SELECT e.id, e.ts, e.distinct_id, e.properties, ${FP} AS fp FROM analytics_events e
  WHERE e.project_id = ? AND e.event = '$exception' AND e.ts >= ? AND e.ts <= ? ORDER BY e.ts DESC LIMIT ${SCAN_CAP}
)`;

export interface IssueQuery {
  from?: string;
  status?: IssueFilter;
  q?: string;
  sort?: 'last' | 'count';
}

export async function listIssues(project: ProjectRow, query: IssueQuery, now = Date.now()): Promise<IssueListResult> {
  const range = resolveRange({ from: query.from ?? '-30d' }, now, projectTz(project));
  const where: string[] = [];
  const args: Array<string | number> = [];
  switch (query.status ?? 'active') {
    case 'active':
      where.push(`(${EFFECTIVE}) IN ('open', 'regression')`);
      break;
    case 'regression':
    case 'resolved':
    case 'ignored':
      where.push(`(${EFFECTIVE}) = ?`);
      args.push(query.status as string);
      break;
    default:
      break;
  }
  const q = query.q?.trim().slice(0, 200);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(agg.type LIKE ? ESCAPE '\\' OR agg.message LIKE ? ESCAPE '\\')`);
    args.push(like, like);
  }
  const rows = (await getDb()
    .prepare(
      `WITH ${eventsCte}, agg AS (
         SELECT ev.fp AS fp, COUNT(*) AS occurrences, COUNT(DISTINCT COALESCE(m.person_id, ev.distinct_id)) AS people, MAX(ev.ts) AS last_seen,
                ${TYPE} AS type, ${MESSAGE} AS message
         FROM ev LEFT JOIN analytics_person_ids m ON m.project_id = ? AND m.distinct_id = ev.distinct_id
         WHERE ev.fp IS NOT NULL GROUP BY ev.fp
       )
       SELECT agg.*, (${EFFECTIVE}) AS effective, s.assignee_id AS assignee_id
       FROM agg LEFT JOIN analytics_error_issues s ON s.project_id = ? AND s.fingerprint = agg.fp
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${query.sort === 'count' ? 'agg.occurrences DESC, agg.last_seen DESC' : 'agg.last_seen DESC'} LIMIT ?`,
    )
    .all(project.id, range.from, range.to, project.id, project.id, ...args, LIST_CAP + 1)) as Array<Record<string, unknown>>;
  const page = rows.slice(0, LIST_CAP);
  const fps = page.map((r) => String(r.fp));
  const sparks = new Map<string, number[]>();
  const firsts = new Map<string, number>();
  if (fps.length) {
    const marks = fps.map(() => '?').join(',');
    const size = Math.max(1, Math.ceil((range.to - range.from + 1) / SPARK_BUCKETS));
    const [bucketRows, firstRows] = await Promise.all([
      getDb()
        .prepare(
          `WITH ${eventsCte}
           SELECT fp, CAST((ts - CAST(? AS INTEGER)) / CAST(? AS INTEGER) AS INTEGER) AS b, COUNT(*) AS n FROM ev WHERE fp IN (${marks}) GROUP BY fp, b`,
        )
        .all(project.id, range.from, range.to, range.from, size, ...fps) as Promise<unknown> as Promise<Array<{ fp: string; b: number; n: number }>>,
      // Primera vez de verdad (no la del rango): desde lo más viejo que queda.
      getDb()
        .prepare(
          `SELECT fp, MIN(ts) AS first FROM (
             SELECT e.ts AS ts, ${FP} AS fp FROM analytics_events e WHERE e.project_id = ? AND e.event = '$exception' ORDER BY e.ts ASC LIMIT ${SCAN_CAP}
           ) WHERE fp IN (${marks}) GROUP BY fp`,
        )
        .all(project.id, ...fps) as Promise<unknown> as Promise<Array<{ fp: string; first: number }>>,
    ]);
    for (const r of bucketRows) {
      const list = sparks.get(String(r.fp)) ?? Array.from({ length: SPARK_BUCKETS }, () => 0);
      const b = Math.min(SPARK_BUCKETS - 1, Math.max(0, Number(r.b)));
      list[b] += Number(r.n);
      sparks.set(String(r.fp), list);
    }
    for (const r of firstRows) firsts.set(String(r.fp), Number(r.first));
  }
  const issues: IssueRow[] = page.map((r) => {
    const fp = String(r.fp);
    const last = Number(r.last_seen);
    return {
      fingerprint: fp,
      type: str(r.type, 200) || 'Error',
      message: str(r.message, 1000),
      occurrences: Number(r.occurrences),
      people: Number(r.people),
      firstSeen: firsts.get(fp) ?? last,
      lastSeen: last,
      status: asStatus(r.effective),
      assigneeId: (r.assignee_id as string | null) ?? null,
      spark: sparks.get(fp) ?? Array.from({ length: SPARK_BUCKETS }, () => 0),
    };
  });
  return { issues, truncated: rows.length > LIST_CAP };
}

/** ¿Hay alguna aparición de esta huella? (entre las últimas SCAN_CAP). */
export async function issueExists(projectId: string, fingerprint: string): Promise<boolean> {
  const r = await getDb()
    .prepare(
      `SELECT 1 AS ok FROM (
         SELECT e.properties FROM analytics_events e WHERE e.project_id = ? AND e.event = '$exception' ORDER BY e.ts DESC LIMIT ${SCAN_CAP}
       ) e WHERE ${FP} = ? LIMIT 1`,
    )
    .get(projectId, fingerprint);
  return !!r;
}

export async function issueDetail(project: ProjectRow, fingerprint: string, query: { from?: string }, now = Date.now()): Promise<IssueDetail | null> {
  const tz = projectTz(project);
  const range = resolveRange({ from: query.from ?? '-30d' }, now, tz);
  const db = getDb();
  const [status, summary, latestAny, first, recent, people, tsRows] = await Promise.all([
    db.prepare('SELECT status, assignee_id, resolved_at FROM analytics_error_issues WHERE project_id = ? AND fingerprint = ?').get(project.id, fingerprint) as Promise<
      { status: string; assignee_id: string | null; resolved_at: number | null } | undefined
    >,
    db
      .prepare(
        `WITH ${eventsCte}
         SELECT COUNT(*) AS n, COUNT(DISTINCT COALESCE(m.person_id, ev.distinct_id)) AS people, MAX(ev.ts) AS last_seen
         FROM ev LEFT JOIN analytics_person_ids m ON m.project_id = ? AND m.distinct_id = ev.distinct_id WHERE ev.fp = ?`,
      )
      .get(project.id, range.from, range.to, project.id, fingerprint) as Promise<{ n: number; people: number; last_seen: number | null } | undefined>,
    // La última aparición, aunque sea de antes del rango: de ahí salen el título y el stack.
    db
      .prepare(
        `SELECT properties, ts FROM (
           SELECT e.properties AS properties, e.ts AS ts, ${FP} AS fp FROM analytics_events e WHERE e.project_id = ? AND e.event = '$exception' ORDER BY e.ts DESC LIMIT ${SCAN_CAP}
         ) WHERE fp = ? LIMIT 1`,
      )
      .get(project.id, fingerprint) as Promise<{ properties: string; ts: number } | undefined>,
    db
      .prepare(
        `SELECT MIN(ts) AS first FROM (
           SELECT e.ts AS ts, ${FP} AS fp FROM analytics_events e WHERE e.project_id = ? AND e.event = '$exception' ORDER BY e.ts ASC LIMIT ${SCAN_CAP}
         ) WHERE fp = ?`,
      )
      .get(project.id, fingerprint) as Promise<{ first: number | null } | undefined>,
    db
      .prepare(
        `SELECT e.id, e.ts, e.distinct_id, m.person_id, e.url, e.browser, e.os FROM (
           SELECT e.id, e.ts, e.distinct_id, e.url, e.browser, e.os, e.project_id, ${FP} AS fp FROM analytics_events e
           WHERE e.project_id = ? AND e.event = '$exception' AND e.ts >= ? AND e.ts <= ? ORDER BY e.ts DESC LIMIT ${SCAN_CAP}
         ) e LEFT JOIN analytics_person_ids m ON m.project_id = e.project_id AND m.distinct_id = e.distinct_id WHERE e.fp = ? ORDER BY e.ts DESC LIMIT 50`,
      )
      .all(project.id, range.from, range.to, fingerprint) as Promise<unknown> as Promise<Array<Record<string, unknown>>>,
    db
      .prepare(
        `WITH ${eventsCte}
         SELECT COALESCE(m.person_id, ev.distinct_id) AS person, m.person_id AS person_id, COUNT(*) AS n
         FROM ev LEFT JOIN analytics_person_ids m ON m.project_id = ? AND m.distinct_id = ev.distinct_id WHERE ev.fp = ? GROUP BY person ORDER BY n DESC LIMIT 50`,
      )
      .all(project.id, range.from, range.to, project.id, fingerprint) as Promise<unknown> as Promise<Array<Record<string, unknown>>>,
    db
      .prepare(`WITH ${eventsCte} SELECT ts FROM ev WHERE fp = ?`)
      .all(project.id, range.from, range.to, fingerprint) as Promise<unknown> as Promise<Array<{ ts: number }>>,
  ]);
  if (!latestAny && !status) return null;
  let props: Record<string, unknown> = {};
  try {
    props = JSON.parse(latestAny?.properties ?? '{}');
  } catch {
    props = {};
  }
  const interval = range.to - range.from <= 2 * 86_400_000 ? 'hour' : 'day';
  const list = bucketList(range.from, range.to, interval, tz);
  const index = new Map(list.map((b, i) => [b, i]));
  const series = list.map(() => 0);
  for (const r of tsRows) {
    const i = index.get(bucketOf(Number(r.ts), interval, tz));
    if (i !== undefined) series[i]++;
  }
  const lastAny = latestAny ? Number(latestAny.ts) : null;
  const stored = status?.status;
  const effective: IssueEffectiveStatus = stored === 'resolved' && lastAny !== null && lastAny > Number(status?.resolved_at ?? 0) ? 'regression' : asStatus(stored);
  return {
    fingerprint,
    type: str(props.$exception_type, 200) || 'Error',
    message: str(props.$exception_message, 1000),
    frames: cleanFrames(props.$exception_stack),
    occurrences: Number(summary?.n ?? 0),
    people: Number(summary?.people ?? 0),
    firstSeen: first?.first != null ? Number(first.first) : null,
    lastSeen: lastAny,
    status: effective,
    assigneeId: status?.assignee_id ?? null,
    buckets: list,
    series,
    recent: recent.map(
      (r): IssueOccurrence => ({
        id: Number(r.id),
        ts: Number(r.ts),
        distinctId: String(r.distinct_id),
        personId: (r.person_id as string | null) ?? null,
        url: (r.url as string | null) ?? null,
        browser: (r.browser as string | null) ?? null,
        os: (r.os as string | null) ?? null,
      }),
    ),
    topPeople: people.map((r) => ({ key: String(r.person), personId: (r.person_id as string | null) ?? null, count: Number(r.n) })),
    truncated: tsRows.length >= SCAN_CAP,
  };
}

/** Personas que pueden ser responsables: gente del workspace con la app Analytics, sin guests. */
export async function issueAssignees(workspaceId: string): Promise<Array<{ id: string; label: string }>> {
  const people = await listOwnerSpacePeople(workspaceId, { app: 'analytics' });
  return people.filter((p) => p.role !== 'guest').map((p) => ({ id: p.id, label: p.name || p.email }));
}

export async function updateIssue(project: ProjectRow, fingerprint: string, patch: { status?: IssueStatus; assigneeId?: string | null }, now = Date.now()): Promise<void> {
  const ts = new Date(now).toISOString();
  const db = getDb();
  await db
    .prepare(`INSERT OR IGNORE INTO analytics_error_issues (project_id, fingerprint, status, updated_at) VALUES (?, ?, 'open', ?)`)
    .run(project.id, fingerprint, ts);
  if (patch.status !== undefined) {
    await db
      .prepare('UPDATE analytics_error_issues SET status = ?, resolved_at = ?, regressed_at = NULL, checked_at = NULL, updated_at = ? WHERE project_id = ? AND fingerprint = ?')
      .run(patch.status, patch.status === 'resolved' ? now : null, ts, project.id, fingerprint);
  }
  if (patch.assigneeId !== undefined) {
    await db.prepare('UPDATE analytics_error_issues SET assignee_id = ?, updated_at = ? WHERE project_id = ? AND fingerprint = ?').run(patch.assigneeId, ts, project.id, fingerprint);
  }
}

// ---------- Cron: regresiones ----------

const RECHECK_MS = 50 * 60_000;
/** Cada resuelto mira solo lo nuevo desde su último chequeo, con margen para eventos atrasados. */
const OVERLAP_MS = 2 * 3_600_000;

/**
 * Resueltos con una aparición más nueva pasan a regresión y le avisan al
 * responsable. El que lleva más tiempo sin chequear va primero (ningún
 * workspace tapa a otro). Cada fila se reclama con compare-and-set en
 * checked_at y el cambio de estado con otro: el aviso sale una sola vez.
 */
export async function runErrorRegressions(opts: { left: () => number; now: number }): Promise<{ regressions: number; checked: number }> {
  const db = getDb();
  const out = { regressions: 0, checked: 0 };
  const rows = (await db
    .prepare(
      `SELECT s.project_id, s.fingerprint, s.resolved_at, s.checked_at, s.assignee_id, p.workspace_id FROM analytics_error_issues s
       JOIN analytics_projects p ON p.id = s.project_id AND p.deleted_at IS NULL
       WHERE s.status = 'resolved' AND (s.checked_at IS NULL OR s.checked_at < ?)
       ORDER BY s.checked_at IS NOT NULL, s.checked_at ASC LIMIT 200`,
    )
    .all(opts.now - RECHECK_MS)) as Array<{ project_id: string; fingerprint: string; resolved_at: number | null; checked_at: number | null; assignee_id: string | null; workspace_id: string }>;
  for (const r of rows) {
    if (opts.left() <= 0) break;
    try {
      const claim = await db
        .prepare('UPDATE analytics_error_issues SET checked_at = ? WHERE project_id = ? AND fingerprint = ? AND checked_at IS ?')
        .run(opts.now, r.project_id, r.fingerprint, r.checked_at);
      if (claim.changes !== 1) continue;
      out.checked++;
      const resolvedAt = Number(r.resolved_at ?? 0);
      const since = r.checked_at === null ? resolvedAt : Math.max(resolvedAt, Number(r.checked_at) - OVERLAP_MS);
      const hit = (await db
        .prepare(
          `SELECT e.ts FROM analytics_events e WHERE e.project_id = ? AND e.event = '$exception' AND e.ts > ? AND ${FP} = ? ORDER BY e.ts DESC LIMIT 1`,
        )
        .get(r.project_id, since, r.fingerprint)) as { ts: number } | undefined;
      if (!hit) continue;
      const moved = await db
        .prepare(`UPDATE analytics_error_issues SET status = 'regression', regressed_at = ?, updated_at = ? WHERE project_id = ? AND fingerprint = ? AND status = 'resolved' AND resolved_at IS ?`)
        .run(opts.now, new Date(opts.now).toISOString(), r.project_id, r.fingerprint, r.resolved_at);
      if (moved.changes !== 1) continue;
      out.regressions++;
      if (r.assignee_id) await notifyAssignee(r);
    } catch (err) {
      console.error('[analytics cron] regression', r.project_id, err);
    }
  }
  return out;
}

async function notifyAssignee(r: { project_id: string; fingerprint: string; assignee_id: string | null; workspace_id: string }): Promise<void> {
  if (!r.assignee_id) return;
  // Sigue en el workspace y con la app: si no, nada le llega.
  const people = await issueAssignees(r.workspace_id);
  if (!people.some((p) => p.id === r.assignee_id)) return;
  const latest = (await getDb()
    .prepare(`SELECT e.properties FROM analytics_events e WHERE e.project_id = ? AND e.event = '$exception' AND ${FP} = ? ORDER BY e.ts DESC LIMIT 1`)
    .get(r.project_id, r.fingerprint)) as { properties: string } | undefined;
  let title = 'Error';
  try {
    title = str(JSON.parse(latest?.properties ?? '{}').$exception_type, 100) || 'Error';
  } catch {
    title = 'Error';
  }
  const { createNotification } = await import('../notifications');
  await createNotification({
    userId: r.assignee_id,
    type: 'analytics_regression',
    title: localized('analyticsRegression', { title }),
    href: `/app/analytics/errors/${issueRef(r.project_id, r.fingerprint)}`,
    sourceType: 'analytics_error',
    sourceId: `${r.project_id}:${r.fingerprint}`,
  });
}
