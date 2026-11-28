/**
 * Track — Updates (Pulse de Linear): un feed con los updates de projects e
 * initiatives del workspace, del más nuevo al más viejo.
 *
 * - "Para mí": projects donde la persona es lead, miembro o seguidora (y no
 *   dejó de seguir), e initiatives que lidera o que contienen uno de esos
 *   projects.
 * - "Todos": todo el workspace.
 *
 * Los invitados no ven planificación (planningClosed): el feed queda vacío.
 * Paginado por fecha (cursor `before` = created_at del último que se vio).
 */
import { getDb } from './db';
import { planningClosed, scopeWhere, type WorkspaceScope } from './track-plans';
import type { PlanHealth } from './track-planning-schema';

export type PulseTab = 'for_me' | 'all';

export interface PulseItem {
  kind: 'project' | 'initiative';
  id: string;
  parent_id: string;
  parent_name: string;
  parent_icon: string | null;
  user_id: string;
  user_name: string | null;
  user_email: string;
  health: PlanHealth;
  body: string;
  progress: number | null;
  meta: string;
  created_at: string;
  updated_at: string | null;
  comment_count: number;
}

export const PULSE_PAGE = 30;

/** Cursor "<created_at>|<id>" del último que se vio; cualquier otra cosa no corta. */
export function parseCursor(raw: string | null | undefined): { at: string; id: string } | null {
  if (!raw || raw.length > 120) return null;
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\|([A-Za-z0-9_-]{1,64})$/.exec(raw);
  return m ? { at: m[1], id: m[2] } : null;
}

export function cursorOf(item: Pick<PulseItem, 'created_at' | 'id'>): string {
  return `${item.created_at}|${item.id}`;
}

const FOR_ME_PLAN = `(
  p.lead_id = :me
  OR EXISTS (SELECT 1 FROM track_plan_members m WHERE m.plan_id = p.id AND m.user_id = :me)
  OR EXISTS (SELECT 1 FROM track_plan_followers f WHERE f.plan_id = p.id AND f.user_id = :me AND f.following = 1)
) AND NOT EXISTS (SELECT 1 FROM track_plan_followers f WHERE f.plan_id = p.id AND f.user_id = :me AND f.following = 0)`;

export async function listPulse(
  scope: WorkspaceScope,
  me: string,
  opts: { tab?: PulseTab; before?: string | null; limit?: number } = {},
): Promise<{ items: PulseItem[]; nextBefore: string | null }> {
  if (await planningClosed(scope)) return { items: [], nextBefore: null };
  const limit = Math.min(Math.max(opts.limit ?? PULSE_PAGE, 1), 100);
  const before = parseCursor(opts.before);
  const forMe = opts.tab === 'for_me';
  const sp = scopeWhere(scope, 'p');
  const si = scopeWhere(scope, 'i');
  const planFilter = forMe ? FOR_ME_PLAN.replace(/:me/g, '?') : '1 = 1';
  const planFilterArgs = forMe ? [me, me, me, me] : [];
  // Una initiative es "para mí" si la lidero o tiene uno de mis projects.
  const iniFilter = forMe
    ? `(i.lead_id = ? OR EXISTS (SELECT 1 FROM track_initiative_plans ip JOIN track_plans p ON p.id = ip.plan_id WHERE ip.initiative_id = i.id AND ${FOR_ME_PLAN.replace(/:me/g, '?')}))`
    : '1 = 1';
  const iniFilterArgs = forMe ? [me, me, me, me, me] : [];
  // Mismo orden que el ORDER BY de afuera: (created_at, id) descendente.
  const cursor = before ? 'AND (x.created_at < ? OR (x.created_at = ? AND x.id < ?))' : '';
  const cursorArgs = before ? [before.at, before.at, before.id] : [];

  const rows = (await getDb()
    .prepare(
      `SELECT * FROM (
         SELECT 'project' AS kind, x.id, p.id AS parent_id, p.name AS parent_name, p.icon AS parent_icon,
           x.user_id, u.name AS user_name, u.email AS user_email, x.health, x.body, x.progress, x.meta, x.created_at, x.updated_at,
           (SELECT COUNT(*) FROM track_plan_update_comments c WHERE c.update_id = x.id) AS comment_count
         FROM track_plan_updates x
         JOIN track_plans p ON p.id = x.plan_id
         JOIN users u ON u.id = x.user_id
         WHERE ${sp.where} AND p.archived_at IS NULL AND ${planFilter} ${cursor}
         UNION ALL
         SELECT 'initiative' AS kind, x.id, i.id AS parent_id, i.name AS parent_name, i.icon AS parent_icon,
           x.user_id, u.name AS user_name, u.email AS user_email, x.health, x.body, NULL AS progress, '{}' AS meta, x.created_at, x.updated_at,
           0 AS comment_count
         FROM track_initiative_updates x
         JOIN track_initiatives i ON i.id = x.initiative_id
         JOIN users u ON u.id = x.user_id
         WHERE ${si.where} AND ${iniFilter} ${cursor}
       ) ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(sp.arg, ...planFilterArgs, ...cursorArgs, si.arg, ...iniFilterArgs, ...cursorArgs, limit + 1)) as PulseItem[];
  const items = rows.slice(0, limit).map((r) => ({ ...r, comment_count: Number(r.comment_count) || 0, progress: r.progress === null ? null : Number(r.progress) }));
  return { items, nextBefore: rows.length > limit ? cursorOf(items[items.length - 1]) : null };
}
