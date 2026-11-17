/**
 * Bandeja de Track con filtros (leídos, tipo, project, team, quién), orden y
 * agrupado. Los avisos de una persona son pocos (se borran a los 30 días): se
 * leen de una vez, se les deduce el project (track_plans) del issue que
 * nombran y se filtran y paginan acá.
 */
import { getDb } from './db';
import type { NotificationRow } from './db';
import {
  compareInbox,
  inboxKind,
  matchesInboxFilter,
  type InboxFacts,
  type InboxFilter,
  type InboxKind,
} from './notification-inbox-filter';

/** Tope de avisos que se miran por pedido. */
const SCAN_LIMIT = 2000;

export interface InboxItem extends NotificationRow, InboxFacts {
  projectName: string | null;
  actorName: string | null;
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
export function issueIdOf(n: Pick<NotificationRow, 'source_type' | 'source_id' | 'href'>): string | null {
  if (n.source_type === 'track_issue' && n.source_id) return n.source_id;
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
  const args: Array<string | number> = [userId, now];
  let where = `user_id = ? AND ${opts.snoozed ? 'snoozed_until IS NOT NULL AND snoozed_until > ?' : '(snoozed_until IS NULL OR snoozed_until <= ?)'}`;
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
  const [issuePlans, directPlans] = await Promise.all([
    plansForIssues(userId, issueIds.filter((v): v is string => Boolean(v))),
    plansById(userId, planIds.filter((v): v is string => Boolean(v))),
  ]);

  const items: InboxItem[] = raw.map((n, i) => {
    const meta = metas[i];
    const viaIssue = issueIds[i] ? issuePlans.get(issueIds[i]!) : undefined;
    const planId = planIds[i];
    const direct = planId && directPlans.has(planId) ? { id: planId, name: directPlans.get(planId)! } : undefined;
    const plan = viaIssue ?? direct ?? null;
    return {
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
    };
  });

  const matching = items.filter((x) => matchesInboxFilter(x, opts.filter));
  // Pospuestos: por el momento en que vuelven, el más cercano primero.
  matching.sort(opts.snoozed ? (a, b) => a.at.localeCompare(b.at) : compareInbox<InboxItem>(opts.filter));
  const start = (page - 1) * limit;
  return {
    rows: matching.slice(start, start + limit),
    hasMore: matching.length > start + limit,
    total: matching.length,
    facets: facetsOf(items),
  };
}
