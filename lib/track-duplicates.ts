/**
 * Track — estado Duplicado, como "Mark as duplicate" de Linear.
 *
 * Marcar un issue como duplicado de otro (el original):
 * - lo pasa al estado "Duplicate" de su team (de tipo cancelado; se crea la
 *   primera vez y después se puede renombrar), y lo saca de triage;
 * - deja la relación "duplicates" entre los dos;
 * - suscribe al original a los suscriptos del duplicado que lo pueden ver;
 * - pasa los pedidos de clientes al original;
 * - deja en el original una entrada con el resumen del duplicado.
 *
 * Lo que se copia (título y extracto, pedidos) solo se copia si todo el que ve
 * el original ve también el duplicado (projectAudienceWithin): un issue de un
 * team privado no deja su texto en uno abierto.
 *
 * Cada marca queda en track_issue_duplicates con lo que movió, así
 * unmarkIssueDuplicate (⌘Z, "Quitar duplicado") vuelve todo atrás sin tocar
 * lo que no era de la marca.
 */
import { getDb } from './db';
import type { TrackProjectRow, TrackStatusRow } from './db';
import {
  createIssueActivity,
  createIssueRelation,
  DEFAULT_STATUS_NAMES,
  deleteIssueRelation,
  getIssue,
  getProject,
  listStatuses,
  updateIssue,
  type IssueChangeVia,
  type TrackIssueWithStatus,
} from './track-data';
import { currentTrackViewer, projectAudienceWithin, projectVisibleTo } from './track-access';
import { listIssueSubscriberIds } from './track-subscriptions';
import { projectWorkspaceId } from './track-labels';
import { descriptionToText } from './track-api';
import { STATUS_CATEGORY_COLORS } from './track-color';

export const DUPLICATE_STATUS_NAMES: Record<'en' | 'es' | 'pt', string> = { en: 'Duplicate', es: 'Duplicado', pt: 'Duplicado' };

export type DuplicateError = 'invalid_duplicate' | 'not_found';

export type DuplicateResult =
  | { ok: true; issue: TrackIssueWithStatus; original: TrackIssueWithStatus; moved: { subscribers: number; requests: number } }
  | { ok: false; reason: DuplicateError };

interface MarkRow {
  issue_id: string;
  original_id: string;
  relation_id: string | null;
  relation_prev_type: string | null;
  prev_status_id: string | null;
  prev_triage: number;
  moved_subscribers: string;
  moved_requests: string;
  summary_activity_id: string | null;
  created_by: string | null;
  created_at: string;
}

function ids(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Texto corto del duplicado para el resumen: sin markdown pesado, 280 caracteres. */
export function duplicateExcerpt(description: string): string {
  const text = descriptionToText(description)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 280 ? `${text.slice(0, 279).trimEnd()}…` : text;
}

/** Idioma de los estados del team (por los nombres con los que nació), para nombrar el nuevo. */
function teamLocale(statuses: TrackStatusRow[]): 'en' | 'es' | 'pt' {
  const names = new Set(statuses.map((s) => s.name));
  for (const loc of ['es', 'pt'] as const) {
    const d = DEFAULT_STATUS_NAMES[loc];
    if (names.has(d.todo) || names.has(d.in_progress) || names.has(d.done)) return loc;
  }
  return 'en';
}

/**
 * Estado al que van los duplicados del team: el guardado si sigue siendo un
 * cancelado del team; si no, se crea "Duplicate" después del último cancelado.
 * Dos marcas a la vez no crean dos: gana la primera (compare-and-set).
 */
export async function ensureDuplicateStatus(projectId: string): Promise<string | null> {
  const db = getDb();
  const project = (await db.prepare('SELECT duplicate_status_id FROM track_projects WHERE id = ?').get(projectId)) as
    | { duplicate_status_id: string | null }
    | undefined;
  if (!project) return null;
  const statuses = await listStatuses(projectId);
  const saved = statuses.find((s) => s.id === project.duplicate_status_id && s.category === 'cancelled');
  if (saved) return saved.id;

  const loc = teamLocale(statuses);
  const wanted = DUPLICATE_STATUS_NAMES[loc].toLowerCase();
  // Un "Duplicate" cancelado que ya existía (creado a mano o importado de Linear) se adopta.
  const existing = statuses.find((s) => s.category === 'cancelled' && s.name.trim().toLowerCase() === wanted);
  let statusId = existing?.id ?? null;
  let created = false;
  if (!statusId) {
    const lastCancelled = [...statuses].reverse().find((s) => s.category === 'cancelled');
    const position = lastCancelled ? lastCancelled.position + 1 : (statuses[statuses.length - 1]?.position ?? 0) + 1;
    // Lo que venía después del cancelado se corre un lugar.
    await db.prepare('UPDATE track_statuses SET position = position + 1 WHERE project_id = ? AND position >= ?').run(projectId, position);
    statusId = crypto.randomUUID();
    await db
      .prepare('INSERT INTO track_statuses (id, project_id, name, color, position, category) VALUES (?, ?, ?, ?, ?, ?)')
      .run(statusId, projectId, DUPLICATE_STATUS_NAMES[loc], STATUS_CATEGORY_COLORS.cancelled, position, 'cancelled');
    created = true;
  }
  const res = await db
    .prepare(
      `UPDATE track_projects SET duplicate_status_id = ?
       WHERE id = ? AND (duplicate_status_id IS NULL OR duplicate_status_id NOT IN (SELECT id FROM track_statuses WHERE project_id = ? AND category = 'cancelled'))`,
    )
    .run(statusId, projectId, projectId);
  if (res.changes > 0) return statusId;
  // Otra marca lo creó a la vez: se usa el suyo y se borra el nuestro (ningún issue lo usa todavía).
  if (created) await db.prepare('DELETE FROM track_statuses WHERE id = ? AND NOT EXISTS (SELECT 1 FROM track_issues WHERE status_id = ?)').run(statusId, statusId);
  const again = (await db.prepare('SELECT duplicate_status_id FROM track_projects WHERE id = ?').get(projectId)) as
    | { duplicate_status_id: string | null }
    | undefined;
  return again?.duplicate_status_id ?? null;
}

async function getMark(issueId: string): Promise<MarkRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_issue_duplicates WHERE issue_id = ?').get(issueId)) as MarkRow | undefined;
}

/** ¿`originalId` termina, siguiendo sus propias marcas, en `issueId`? (A dup de B dup de A). */
async function leadsBackTo(originalId: string, issueId: string): Promise<boolean> {
  let cur: string | null = originalId;
  for (let hop = 0; cur && hop < 20; hop++) {
    if (cur === issueId) return true;
    const next = (await getDb().prepare('SELECT original_id FROM track_issue_duplicates WHERE issue_id = ?').get(cur)) as
      | { original_id: string }
      | undefined;
    cur = next?.original_id ?? null;
  }
  return false;
}

/**
 * Marca `issueId` como duplicado de `originalId`. El llamador ya validó que la
 * persona ve `issueId`; acá se valida el original: mismo workspace, visible
 * para quien mira (privados e invitados), distinto, fuera de triage y sin
 * cerrar un ciclo de duplicados.
 */
export async function markIssueDuplicate(
  issueId: string,
  originalId: string,
  actorId: string,
  opts: { via?: IssueChangeVia } = {},
): Promise<DuplicateResult> {
  const db = getDb();
  const [issue, original] = await Promise.all([getIssue(issueId), getIssue(originalId)]);
  if (!issue) return { ok: false, reason: 'not_found' };
  if (!original || original.id === issue.id || original.triage === 1) return { ok: false, reason: 'invalid_duplicate' };
  const [a, b] = await Promise.all([getProject(issue.project_id), getProject(original.project_id)]);
  if (!a || !b || projectWorkspaceId(a) !== projectWorkspaceId(b)) return { ok: false, reason: 'invalid_duplicate' };
  const viewer = await currentTrackViewer();
  if (viewer && !(await projectVisibleTo(b.id, viewer))) return { ok: false, reason: 'invalid_duplicate' };
  if (await leadsBackTo(original.id, issue.id)) return { ok: false, reason: 'invalid_duplicate' };

  const current = await getMark(issue.id);
  if (current?.original_id === original.id) {
    return { ok: true, issue, original, moved: { subscribers: ids(current.moved_subscribers).length, requests: ids(current.moved_requests).length } };
  }
  // Ya era duplicado de otro: como Linear, la marca pasa al nuevo original.
  if (current) await unmarkIssueDuplicate(issue.id, actorId);

  const statusId = await ensureDuplicateStatus(issue.project_id);
  if (!statusId) return { ok: false, reason: 'invalid_duplicate' };

  // La fila se toma primero (PRIMARY KEY): dos marcas a la vez no mueven dos veces.
  const fresh = (await getIssue(issue.id)) as TrackIssueWithStatus;
  const claim = await db
    .prepare(
      'INSERT OR IGNORE INTO track_issue_duplicates (issue_id, original_id, prev_status_id, prev_triage, created_by) VALUES (?, ?, ?, ?, ?)',
    )
    .run(issue.id, original.id, fresh.status_id, fresh.triage === 1 ? 1 : 0, actorId);
  if (claim.changes === 0) {
    const other = await getMark(issue.id);
    if (other?.original_id === original.id) return { ok: true, issue: fresh, original, moved: { subscribers: 0, requests: 0 } };
    return { ok: false, reason: 'invalid_duplicate' };
  }

  // Relación: se reusa la que hubiera (y se recuerda su tipo) o se crea.
  const rel = (await db
    .prepare('SELECT id, type FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?')
    .get(issue.id, original.id)) as { id: string; type: string } | undefined;
  let relationId: string | null = rel?.id ?? null;
  const relationPrevType = rel?.type ?? null;
  if (rel && rel.type !== 'duplicates') {
    await db.prepare("UPDATE track_issue_relations SET type = 'duplicates' WHERE id = ?").run(rel.id);
  } else if (!rel) {
    await createIssueRelation(issue.id, actorId, original.id, 'duplicates').catch(() => undefined);
    const row = (await db
      .prepare('SELECT id FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?')
      .get(issue.id, original.id)) as { id: string } | undefined;
    relationId = row?.id ?? null;
  }

  // Estado Duplicado (sale de triage). updateIssue deja la actividad y los avisos de siempre.
  if (fresh.triage === 1) {
    await db.prepare("UPDATE track_issues SET triage = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(issue.id);
  }
  if (fresh.status_id !== statusId) await updateIssue(issue.id, { statusId }, actorId, opts.via ? { via: opts.via } : {});

  // Suscriptos: los del duplicado que ven el original y no estaban (ni se dieron de baja ahí).
  const [dupSubs, origSubs] = await Promise.all([listIssueSubscriberIds(issue.id), listIssueSubscriberIds(original.id)]);
  const explicit = new Set(
    ((await db.prepare('SELECT user_id FROM track_issue_subscriptions WHERE issue_id = ?').all(original.id)) as Array<{ user_id: string }>).map(
      (r) => r.user_id,
    ),
  );
  const movedSubscribers: string[] = [];
  const now = new Date().toISOString();
  for (const uid of dupSubs) {
    if (origSubs.includes(uid) || explicit.has(uid)) continue;
    if (!(await projectVisibleTo(original.project_id, uid))) continue;
    const res = await db
      .prepare('INSERT OR IGNORE INTO track_issue_subscriptions (issue_id, user_id, subscribed, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
      .run(original.id, uid, now, now);
    if (res.changes > 0) movedSubscribers.push(uid);
  }

  // Pedidos de clientes y resumen: solo si quien ve el original ve también el duplicado.
  const canCopy = await projectAudienceWithin(original.project_id, issue.project_id);
  let movedRequests: string[] = [];
  if (canCopy) {
    movedRequests = ((await db.prepare('SELECT id FROM track_customer_requests WHERE issue_id = ?').all(issue.id)) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    if (movedRequests.length) {
      await db
        .prepare(`UPDATE track_customer_requests SET issue_id = ?, updated_at = ? WHERE issue_id = ? AND id IN (${movedRequests.map(() => '?').join(', ')})`)
        .run(original.id, now, issue.id, ...movedRequests);
    }
  }
  const counts = (await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM track_issue_comments WHERE issue_id = ?) AS comments,
              (SELECT COUNT(*) FROM track_issue_attachments WHERE issue_id = ?) AS attachments`,
    )
    .get(issue.id, issue.id)) as { comments: number; attachments: number };
  const summary = await createIssueActivity(original.id, actorId, 'relation_added', {
    relatedIssueId: issue.id,
    type: 'duplicates',
    direction: 'incoming',
    merged: true,
    identifier: issue.identifier,
    title: canCopy ? issue.title : '',
    excerpt: canCopy ? duplicateExcerpt(issue.description) : '',
    comments: canCopy ? Number(counts.comments) : 0,
    attachments: canCopy ? Number(counts.attachments) : 0,
    subscribers: movedSubscribers.length,
    requests: movedRequests.length,
    ...(opts.via ? { via: opts.via.source, viaAuthor: opts.via.author ?? null } : {}),
  });

  await db
    .prepare(
      `UPDATE track_issue_duplicates SET relation_id = ?, relation_prev_type = ?, moved_subscribers = ?, moved_requests = ?, summary_activity_id = ?
       WHERE issue_id = ?`,
    )
    .run(relationId, relationPrevType, JSON.stringify(movedSubscribers), JSON.stringify(movedRequests), summary.id, issue.id);

  return {
    ok: true,
    issue: (await getIssue(issue.id)) as TrackIssueWithStatus,
    original,
    moved: { subscribers: movedSubscribers.length, requests: movedRequests.length },
  };
}

/**
 * Deshace la marca: relación, estado (si nadie lo cambió después), triage,
 * suscriptos y pedidos movidos, y la entrada del resumen en el original.
 * Devuelve false si el issue no estaba marcado (otro ya lo deshizo).
 */
export async function unmarkIssueDuplicate(issueId: string, actorId: string): Promise<boolean> {
  const db = getDb();
  const mark = (await db.prepare('DELETE FROM track_issue_duplicates WHERE issue_id = ? RETURNING *').get(issueId)) as MarkRow | undefined;
  if (!mark) return false;
  const issue = await getIssue(issueId);
  if (!issue) return true;

  if (mark.relation_id) {
    if (mark.relation_prev_type === null) {
      await deleteIssueRelation(mark.relation_id, issueId, actorId).catch(() => false);
    } else if (mark.relation_prev_type !== 'duplicates') {
      await db.prepare('UPDATE track_issue_relations SET type = ? WHERE id = ?').run(mark.relation_prev_type, mark.relation_id);
    }
  }

  const project = (await getProject(issue.project_id)) as (TrackProjectRow & { duplicate_status_id?: string | null }) | undefined;
  const dupStatus = project?.duplicate_status_id ?? null;
  if (dupStatus && issue.status_id === dupStatus) {
    const prev = mark.prev_status_id
      ? ((await db.prepare('SELECT id FROM track_statuses WHERE id = ? AND project_id = ?').get(mark.prev_status_id, issue.project_id)) as
          | { id: string }
          | undefined)
      : undefined;
    if (prev && prev.id !== issue.status_id) await updateIssue(issueId, { statusId: prev.id }, actorId);
    if (mark.prev_triage === 1) {
      await db.prepare("UPDATE track_issues SET triage = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(issueId);
    }
  }

  const subs = ids(mark.moved_subscribers);
  if (subs.length) {
    await db
      .prepare(`DELETE FROM track_issue_subscriptions WHERE issue_id = ? AND subscribed = 1 AND user_id IN (${subs.map(() => '?').join(', ')})`)
      .run(mark.original_id, ...subs);
  }
  const reqs = ids(mark.moved_requests);
  if (reqs.length) {
    await db
      .prepare(`UPDATE track_customer_requests SET issue_id = ?, updated_at = ? WHERE issue_id = ? AND id IN (${reqs.map(() => '?').join(', ')})`)
      .run(issueId, new Date().toISOString(), mark.original_id, ...reqs);
  }
  if (mark.summary_activity_id) {
    await db.prepare('DELETE FROM track_issue_activities WHERE id = ? AND issue_id = ?').run(mark.summary_activity_id, mark.original_id);
  }
  return true;
}

export interface DuplicateMarkView {
  /** null si quien mira no ve el original (team privado o invitado). */
  original: { id: string; identifier: string; title: string; status_category: string | null; status_color: string | null } | null;
  markedAt: string;
}

/** La marca de un issue, vista por quien mira ahora (el original solo si lo ve). */
export async function getDuplicateMark(issueId: string): Promise<DuplicateMarkView | null> {
  const mark = await getMark(issueId);
  if (!mark) return null;
  const original = await getIssue(mark.original_id);
  const viewer = await currentTrackViewer();
  const visible = original && (!viewer || (await projectVisibleTo(original.project_id, viewer)));
  return {
    original: visible && original
      ? { id: original.id, identifier: original.identifier, title: original.title, status_category: original.status_category, status_color: original.status_color }
      : null,
    markedAt: mark.created_at,
  };
}
