/**
 * Bandeja de Track con filtros (leídos, tipo, project, team, quién), orden y
 * agrupado, y las pestañas Priority / Other (regla en
 * lib/notification-inbox-filter.ts, inboxTab). Los avisos de una persona son
 * pocos (se borran a los 30 días): se leen de una vez, se les deduce el
 * project (track_plans) y el issue que nombran, y se filtran y paginan acá.
 *
 * Privacidad: un aviso de algo que hoy la persona no puede ver (dejó el
 * workspace, el team pasó a privado, es invitada sin ese team) no se muestra:
 * ni el título ni el aviso. La regla vive en lib/notification-access.ts.
 */
import { getDb } from './db';
import type { NotificationRow } from './db';
import { chunks, issueIdOf, memberArgs, memberSql, notificationAccess, type VisibleIssue } from './notification-access';
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
export type InboxIssue = VisibleIssue;

export { issueIdOf };

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
            AND ${memberSql('p')}`,
      )
      .all(...part, ...memberArgs(userId))) as Array<{ issue_id: string; plan_id: string; plan_name: string }>;
    for (const r of rows) out.set(r.issue_id, { id: r.plan_id, name: r.plan_name });
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
            AND ${memberSql('p')}`,
      )
      .all(...part, ...memberArgs(userId))) as Array<{ id: string; name: string }>;
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
  const [issuePlans, directPlans, access] = await Promise.all([
    plansForIssues(userId, presentIssues),
    plansById(userId, presentPlans),
    // Privacidad (lib/notification-access): lo que hoy no ve no se muestra.
    notificationAccess(userId, raw),
  ]);

  const all: InboxItem[] = [];
  const snoozedNow = new Set<string>();
  raw.forEach((n, i) => {
    if (access.hidden.has(n.id)) return;
    const issueId = issueIds[i];
    const meta = metas[i];
    const viaIssue = issueId ? issuePlans.get(issueId) : undefined;
    const planId = planIds[i];
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
      issue: issueId ? (access.issues.get(issueId) ?? null) : null,
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
