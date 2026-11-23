/**
 * Quién puede ver hoy lo que nombra un aviso guardado.
 *
 * Los avisos guardan el título del issue, project o iniciativa del momento en
 * que se crearon. Si la persona después pierde el acceso (dejó el workspace,
 * el team pasó a privado, es invitada de Track sin ese team), el aviso no se
 * muestra en ningún lado: la bandeja, la campana y su contador, la app de
 * escritorio, los emails de Track y las herramientas MCP (que usan las rutas).
 *
 * La regla es la de la bandeja (lib/notification-inbox.ts):
 * - issue: su team es de un workspace de la persona (dueña o miembro, o
 *   propio) y lo ve según lib/track-access (privado, invitado);
 * - project o iniciativa: la persona es del workspace y no es invitada (los
 *   invitados no ven projects ni iniciativas).
 * Un aviso de algo que ya no existe se deja como está.
 */
import { getDb } from './db';
import type { NotificationRow } from './db';
import { trackVisibleExpr } from './track-access';
import { countUnreadNotifications, hidePathsSql, listNotifications, type NotificationListOptions } from './notifications';

/** Lo que hace falta de un aviso para saber si se ve (source_* pueden faltar en filas viejas). */
export interface AccessRow {
  id: string;
  source_type: string | null;
  source_id: string | null;
  href: string | null;
}
type Source = Omit<AccessRow, 'id'>;

/** El issue que nombra el aviso, tal como está hoy (título y status actuales). */
export interface VisibleIssue {
  id: string;
  identifier: string;
  title: string;
  statusName: string | null;
  statusColor: string | null;
  statusCategory: string | null;
}

/** Id del issue de Track al que apunta un aviso (por su origen o por el link). */
const ISSUE_SOURCES = new Set(['track_issue', 'track_triage', 'track_sla', 'track_agent']);

export function issueIdOf(n: Source): string | null {
  if (n.source_type && ISSUE_SOURCES.has(n.source_type) && n.source_id) return n.source_id;
  const m = /\/app\/track\/issues\/([A-Za-z0-9_-]+)/.exec(n.href ?? '');
  return m ? m[1] : null;
}

/** Id del project (track_plans) que nombra el aviso, si no es de un issue. */
export function planIdOf(n: Source): string | null {
  if (n.source_type === 'track_plan' && n.source_id) return n.source_id;
  const m = /\/app\/track\/projects\/([A-Za-z0-9_-]+)/.exec(n.href ?? '');
  return m ? m[1] : null;
}

/** Id de la iniciativa que nombra el aviso. */
export function initiativeIdOf(n: Source): string | null {
  if (n.source_type === 'track_initiative' && n.source_id) return n.source_id;
  const m = /\/app\/track\/initiatives\/([A-Za-z0-9_-]+)/.exec(n.href ?? '');
  return m ? m[1] : null;
}

export function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Condición "la persona es del workspace de `alias`" (project o iniciativa):
 * dueña o miembro del team, o dueña si es personal, y no invitada (los
 * invitados de Track no ven projects ni iniciativas, lib/track-plans).
 * Usa los 4 argumentos de memberArgs.
 */
export function memberSql(alias: string): string {
  return `((${alias}.team_id IN (SELECT team_id FROM team_members WHERE user_id = ?)
      OR ${alias}.team_id IN (SELECT id FROM teams WHERE owner_id = ?)
      OR (${alias}.team_id IS NULL AND ${alias}.owner_id = ?))
    AND NOT EXISTS (SELECT 1 FROM track_guests g WHERE g.workspace_id = COALESCE(${alias}.team_id, ${alias}.owner_id)
      AND g.email = (SELECT lower(u0.email) FROM users u0 WHERE u0.id = ?)))`;
}

export function memberArgs(userId: string): string[] {
  return [userId, userId, userId, userId];
}

/** Ids de `table` (track_plans o track_initiatives) que existen y la persona hoy no ve. */
async function hiddenEntities(userId: string, table: 'track_plans' | 'track_initiatives', ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(ids)], 400)) {
    const rows = (await getDb()
      .prepare(`SELECT e.id FROM ${table} e WHERE e.id IN (${part.map(() => '?').join(', ')}) AND NOT ${memberSql('e')}`)
      .all(...part, ...memberArgs(userId))) as Array<{ id: string }>;
    for (const r of rows) out.add(r.id);
  }
  return out;
}

/**
 * Issues que nombran los avisos: los que la persona ve hoy (con título y
 * status) y el conjunto de los que existen pero no ve.
 */
export async function issuesFor(userId: string, issueIds: string[]): Promise<{ visible: Map<string, VisibleIssue>; hidden: Set<string> }> {
  const visible = new Map<string, VisibleIssue>();
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

export interface NotificationAccess {
  /** Avisos que la persona hoy no puede ver. */
  hidden: Set<string>;
  /** Issues que nombran los avisos y la persona ve hoy. */
  issues: Map<string, VisibleIssue>;
}

/** Qué avisos de `rows` (todos de `userId`) no se muestran y los issues que sí. */
export async function notificationAccess(userId: string, rows: readonly AccessRow[]): Promise<NotificationAccess> {
  const issueIds = rows.map(issueIdOf);
  const planIds = rows.map((n, i) => (issueIds[i] ? null : planIdOf(n)));
  const initiativeIds = rows.map((n, i) => (issueIds[i] || planIds[i] ? null : initiativeIdOf(n)));
  const present = (xs: Array<string | null>) => xs.filter((v): v is string => Boolean(v));
  const [issues, hiddenPlans, hiddenInitiatives] = await Promise.all([
    issuesFor(userId, present(issueIds)),
    hiddenEntities(userId, 'track_plans', present(planIds)),
    hiddenEntities(userId, 'track_initiatives', present(initiativeIds)),
  ]);
  const hidden = new Set<string>();
  rows.forEach((n, i) => {
    const issueId = issueIds[i];
    const planId = planIds[i];
    const initiativeId = initiativeIds[i];
    if ((issueId && issues.hidden.has(issueId)) || (planId && hiddenPlans.has(planId)) || (initiativeId && hiddenInitiatives.has(initiativeId))) {
      hidden.add(n.id);
    }
  });
  return { hidden, issues: issues.visible };
}

/** Solo los avisos que la persona puede ver hoy. */
export async function visibleNotifications<T extends AccessRow>(userId: string, rows: readonly T[]): Promise<T[]> {
  if (!rows.length) return [];
  const { hidden } = await notificationAccess(userId, rows);
  return rows.filter((n) => !hidden.has(n.id));
}

/** Avisos que pueden nombrar algo de Track (los únicos que se filtran por acceso). */
const TRACK_ROWS_SQL = "(source_type LIKE 'track\\_%' ESCAPE '\\' OR href LIKE '%/app/track/%')";

/** Tope de avisos que se miran para armar una página. */
const LIST_SCAN_LIMIT = 2000;

/**
 * listNotifications sin los avisos que la persona hoy no ve (y sin los que
 * `keep` descarta). Pagina sobre lo que queda: lee de a tandas desde el
 * principio hasta llenar la página pedida.
 */
export async function listVisibleNotifications(
  userId: string,
  options: NotificationListOptions = {},
  keep?: (n: NotificationRow) => boolean,
): Promise<NotificationRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  const want = page * limit;
  // Tandas chicas para la campana (5 avisos), de hasta 100 para páginas grandes.
  const size = Math.min(100, Math.max(want * 2, 20));
  const out: NotificationRow[] = [];
  for (let batch = 1; batch * size <= LIST_SCAN_LIMIT; batch++) {
    const rows = await listNotifications(userId, { ...options, limit: size, page: batch });
    const shown = await visibleNotifications(userId, keep ? rows.filter(keep) : rows);
    out.push(...shown);
    if (out.length >= want || rows.length < size) break;
  }
  return out.slice((page - 1) * limit, want);
}

/**
 * Sin leer para la campana: countUnreadNotifications menos los avisos sin leer
 * de cosas que la persona hoy no ve.
 */
export async function countVisibleUnread(userId: string, opts: { hidePaths?: readonly string[] } = {}): Promise<number> {
  const total = await countUnreadNotifications(userId, opts);
  if (!total) return 0;
  const hide = hidePathsSql(opts.hidePaths);
  const rows = (await getDb()
    .prepare(
      `SELECT id, source_type, source_id, href FROM notifications
        WHERE user_id = ? AND read_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?) AND ${TRACK_ROWS_SQL}${hide.sql}
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(userId, new Date().toISOString(), ...hide.args, LIST_SCAN_LIMIT)) as AccessRow[];
  if (!rows.length) return total;
  const { hidden } = await notificationAccess(userId, rows);
  return Math.max(total - hidden.size, 0);
}
