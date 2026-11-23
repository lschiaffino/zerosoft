/**
 * Bandeja de Track con filtros (leídos, tipo, project, team, quién), orden y
 * agrupado, y las pestañas Priority / Other (regla en
 * lib/notification-inbox-filter.ts, inboxTab). Los avisos de una persona son
 * pocos (se borran a los 30 días): se leen de una vez, se les deduce el
 * project (track_plans) y el issue que nombran, y se filtran y paginan acá.
 *
 * Privacidad: un aviso de un issue que hoy la persona no puede ver (dejó el
 * workspace, el team pasó a privado, es invitada sin ese team) no se muestra:
 * ni el título del issue ni el aviso.
 */
import { getDb } from './db';
import type { NotificationRow } from './db';
import { trackVisibleExpr } from './track-access';
import {
  compareInbox,
  inboxKind,
  inboxReason,
  inboxTab,
  matchesInboxFilter,
  type InboxFacts,
  type InboxFilter,
  type InboxKind,
  type InboxReason,
  type InboxTab,
} from './notification-inbox-filter';

/** Tope de avisos que se miran por pedido. */
const SCAN_LIMIT = 2000;

/** El issue que nombra el aviso, tal como está hoy (título y status actuales). */
export interface InboxIssue {
  id: string;
  identifier: string;
  title: string;
  statusName: string | null;
  statusColor: string | null;
  statusCategory: string | null;
}

export interface InboxItem extends NotificationRow, InboxFacts {
  projectName: string | null;
  actorName: string | null;
  tab: InboxTab;
  reason: InboxReason;
  issue: InboxIssue | null;
}

/** Sin leer por pestaña (con el resto del filtro puesto). */
export interface InboxCounts {
  priority: number;
  other: number;
}

export interface InboxFacets {
  kinds: Array<{ value: InboxKind; count: number }>;
  projects: Array<{ value: string; label: string; count: number }>;
  teams: Array<{ value: string; label: string; count: number }>;
  actors: Array<{ value: string; label: string; count: number }>;
  /** Avisos sin project o sin team (para ofrecer "Sin project" / "Sin team"). */
  noProject: number;
  noTeam: number;
}

export interface InboxPage {
  rows: InboxItem[];
  hasMore: boolean;
  /** Avisos que cumplen el filtro. */
  total: number;
  facets: InboxFacets;
  counts: InboxCounts;
}

function parseMeta(meta: string): Record<string, unknown> {
  try {
    const v = JSON.parse(meta);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Id del issue de Track al que apunta un aviso (por su origen o por el link). */
const ISSUE_SOURCES = new Set(['track_issue', 'track_triage', 'track_sla', 'track_agent']);

export function issueIdOf(n: Pick<NotificationRow, 'source_type' | 'source_id' | 'href'>): string | null {
  if (n.source_type && ISSUE_SOURCES.has(n.source_type) && n.source_id) return n.source_id;
  const m = /\/app\/track\/issues\/([A-Za-z0-9_-]+)/.exec(n.href ?? '');
  return m ? m[1] : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Project de cada issue, solo de los projects que la persona puede ver (de un
 * workspace del que es dueña o miembro, o propios).
 */
async function plansForIssues(userId: string, issueIds: string[]): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  if (!issueIds.length) return out;
  const db = getDb();
  for (const part of chunks([...new Set(issueIds)], 400)) {
    const rows = (await db
      .prepare(
        `SELECT i.id AS issue_id, p.id AS plan_id, p.name AS plan_name
           FROM track_issues i JOIN track_plans p ON p.id = i.plan_id
          WHERE i.id IN (${part.map(() => '?').join(', ')})
            AND (p.owner_id = ? OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?) OR p.team_id IN (SELECT id FROM teams WHERE owner_id = ?))`,
      )
      .all(...part, userId, userId, userId)) as Array<{ issue_id: string; plan_id: string; plan_name: string }>;
    for (const r of rows) out.set(r.issue_id, { id: r.plan_id, name: r.plan_name });
  }
  return out;
}

/**
 * Issues que nombran los avisos: los que la persona ve hoy (con título y
 * status) y el conjunto de los que existen pero no ve. Un issue se ve si su
 * team es de un workspace de la persona (dueña o miembro, o propio) y, si es
 * privado o ella es invitada, si tiene acceso (lib/track-access).
 */
async function issuesFor(userId: string, issueIds: string[]): Promise<{ visible: Map<string, InboxIssue>; hidden: Set<string> }> {
  const visible = new Map<string, InboxIssue>();
  const hidden = new Set<string>();
  if (!issueIds.length) return { visible, hidden };
  const db = getDb();
  for (const part of chunks([...new Set(issueIds)], 300)) {
    const marks = part.map(() => '?').join(', ');
    const rows = (await db
      .prepare(
        `SELECT i.id, i.identifier, i.title, s.name AS status_name, s.color AS status_color, s.category AS status_category,
                CASE WHEN (p.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
                        OR p.team_id IN (SELECT id FROM teams WHERE owner_id = ?)
                        OR (p.team_id IS NULL AND p.owner_id = ?))
                      AND ${trackVisibleExpr('p', '?')} THEN 1 ELSE 0 END AS can_see
           FROM track_issues i
           JOIN track_projects p ON p.id = i.project_id
           LEFT JOIN track_statuses s ON s.id = i.status_id
          WHERE i.id IN (${marks})`,
      )
      .all(userId, userId, userId, userId, userId, userId, ...part)) as Array<{
      id: string;
      identifier: string;
      title: string;
      status_name: string | null;
      status_color: string | null;
      status_category: string | null;
      can_see: number;
    }>;
    for (const r of rows) {
      if (!r.can_see) {
        hidden.add(r.id);
        continue;
      }
      visible.set(r.id, {
        id: r.id,
        identifier: r.identifier,
        title: r.title,
        statusName: r.status_name,
        statusColor: r.status_color,
        statusCategory: r.status_category,
      });
    }
  }
  return { visible, hidden };
}

/** Projects (track_plans) que existen entre `ids`: los que no están en el mapa visible son ajenos. */
async function existingPlans(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(ids)], 400)) {
    const rows = (await getDb()
      .prepare(`SELECT id FROM track_plans WHERE id IN (${part.map(() => '?').join(', ')})`)
      .all(...part)) as Array<{ id: string }>;
    for (const r of rows) out.add(r.id);
  }
  return out;
}

async function plansById(userId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const db = getDb();
  for (const part of chunks([...new Set(ids)], 400)) {
    const rows = (await db
      .prepare(
        `SELECT p.id, p.name FROM track_plans p
          WHERE p.id IN (${part.map(() => '?').join(', ')})
            AND (p.owner_id = ? OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?) OR p.team_id IN (SELECT id FROM teams WHERE owner_id = ?))`,
      )
      .all(...part, userId, userId, userId)) as Array<{ id: string; name: string }>;
    for (const r of rows) out.set(r.id, r.name);
  }
  return out;
}

function facetsOf(items: InboxItem[]): InboxFacets {
  const kinds = new Map<InboxKind, number>();
  const projects = new Map<string, { label: string; count: number }>();
  const teams = new Map<string, number>();
  const actors = new Map<string, { label: string; count: number }>();
  let noProject = 0;
  let noTeam = 0;
  for (const x of items) {
    kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
    if (x.projectId) {
      const p = projects.get(x.projectId) ?? { label: x.projectName ?? '', count: 0 };
      p.count += 1;
      projects.set(x.projectId, p);
    } else noProject += 1;
    if (x.team) teams.set(x.team, (teams.get(x.team) ?? 0) + 1);
    else noTeam += 1;
    if (x.actorId) {
      const a = actors.get(x.actorId) ?? { label: x.actorName ?? '', count: 0 };
      a.count += 1;
      actors.set(x.actorId, a);
    }
  }
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return {
    kinds: [...kinds].map(([value, count]) => ({ value, count })),
    projects: [...projects].map(([value, p]) => ({ value, ...p })).sort(byLabel),
    teams: [...teams].map(([value, count]) => ({ value, label: value, count })).sort(byLabel),
    actors: [...actors].map(([value, a]) => ({ value, ...a })).sort(byLabel),
    noProject,
    noTeam,
  };
}

export async function listInboxNotifications(
  userId: string,
  opts: {
    filter: InboxFilter;
    /** Pestaña: tipos de `notifications.type` (vacío = todos). */
    types?: string[];
    /** Pestaña Priority u Other (sin esto, las dos). */
    tab?: InboxTab;
    /** true = la pestaña de pospuestos. */
    snoozed?: boolean;
    page?: number;
    limit?: number;
    /** Avisos que la persona puede ver (apps del workspace activo). */
    visible?: (n: NotificationRow) => boolean;
    now?: Date;
  },
): Promise<InboxPage> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 1, 1);
  const now = (opts.now ?? new Date()).toISOString();
  // Pospuestos y no pospuestos juntos: los contadores de las pestañas salen de los segundos.
  const args: Array<string | number> = [userId];
  let where = 'user_id = ?';
  const types = (opts.types ?? []).filter(Boolean);
  if (types.length) {
    where += ` AND type IN (${types.map(() => '?').join(', ')})`;
    args.push(...types);
  }
  const raw = ((await db
    .prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...args, SCAN_LIMIT)) as NotificationRow[]).filter((n) => !opts.visible || opts.visible(n));

  const metas = raw.map((n) => parseMeta(n.meta));
  const issueIds = raw.map(issueIdOf);
  const planIds = raw.map((n, i) => (n.source_type === 'track_plan' && n.source_id ? n.source_id : str(metas[i].planId)));
  const presentIssues = issueIds.filter((v): v is string => Boolean(v));
  const presentPlans = planIds.filter((v): v is string => Boolean(v));
  const [issuePlans, directPlans, issues, plansThatExist] = await Promise.all([
    plansForIssues(userId, presentIssues),
    plansById(userId, presentPlans),
    issuesFor(userId, presentIssues),
    existingPlans(presentPlans),
  ]);

  const all: InboxItem[] = [];
  const snoozedNow = new Set<string>();
  raw.forEach((n, i) => {
    const issueId = issueIds[i];
    // Privacidad: el issue existe y hoy no lo ve (o es de un workspace ajeno).
    if (issueId && issues.hidden.has(issueId)) return;
    const meta = metas[i];
    const viaIssue = issueId ? issuePlans.get(issueId) : undefined;
    const planId = planIds[i];
    // Lo mismo con un aviso de un project (update, comentario) que existe y no ve.
    if (!issueId && n.source_type === 'track_plan' && planId && plansThatExist.has(planId) && !directPlans.has(planId)) return;
    const direct = planId && directPlans.has(planId) ? { id: planId, name: directPlans.get(planId)! } : undefined;
    const plan = viaIssue ?? direct ?? null;
    const facts = { type: n.type, source_type: n.source_type, meta };
    all.push({
      ...n,
      kind: inboxKind(n.type),
      projectId: plan?.id ?? null,
      projectName: plan?.name ?? null,
      team: str(meta.projectName),
      actorId: str(meta.actorId),
      actorName: str(meta.actorName),
      read: Boolean(n.read_at),
      // Uno que volvió de posponer se ordena por ese momento (como uno nuevo).
      at: n.snoozed_until ?? n.created_at,
      tab: inboxTab(facts),
      reason: inboxReason(facts),
      issue: issueId ? (issues.visible.get(issueId) ?? null) : null,
    });
    if (n.snoozed_until && n.snoozed_until > now) snoozedNow.add(n.id);
  });

  const live = all.filter((x) => !snoozedNow.has(x.id));
  const items = opts.snoozed ? all.filter((x) => snoozedNow.has(x.id)) : live;
  const unreadFilter = { ...opts.filter, read: 'all' as const };
  const counts: InboxCounts = { priority: 0, other: 0 };
  for (const x of live) if (!x.read && matchesInboxFilter(x, unreadFilter)) counts[x.tab] += 1;

  const matching = items.filter((x) => (!opts.tab || opts.snoozed || x.tab === opts.tab) && matchesInboxFilter(x, opts.filter));
  // Pospuestos: por el momento en que vuelven, el más cercano primero.
  matching.sort(opts.snoozed ? (a, b) => a.at.localeCompare(b.at) : compareInbox<InboxItem>(opts.filter));
  const start = (page - 1) * limit;
  return {
    rows: matching.slice(start, start + limit),
    hasMore: matching.length > start + limit,
    total: matching.length,
    facets: facetsOf(items),
    counts,
  };
}
