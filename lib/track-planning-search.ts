/**
 * Cmd+K: plans, initiatives y dashboards de Track por nombre, con el mismo
 * alcance que sus listas (dashboards personales solo para su dueño).
 */
import { getDb } from './db';
import { planningClosed, scopeWhere, type WorkspaceScope } from './track-plans';
import { likeContains } from './track-views';

export interface PlanningSearchItem {
  id: string;
  group: 'trackPlans' | 'trackInitiatives' | 'trackDashboards';
  label: string;
  meta: string;
  href: string;
}

export async function searchPlanning(scope: WorkspaceScope, userId: string, q: string, limit = 6): Promise<PlanningSearchItem[]> {
  const needle = q.trim();
  if (!needle) return [];
  const like = likeContains(needle);
  const s = scopeWhere(scope);
  const db = getDb();
  // Plans e iniciativas, con el alcance de sus listas (lib/track-plans planningClosed).
  const none: Array<{ id: string; name: string; meta: string }> = [];
  const closed = await planningClosed(scope);
  const [plans, initiatives, dashboards] = await Promise.all([
    closed
      ? none
      : (db
          .prepare(`SELECT id, name, summary AS meta FROM track_plans WHERE ${s.where} AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`)
          .all(s.arg, like, limit) as Promise<Array<{ id: string; name: string; meta: string }>>),
    closed
      ? none
      : (db
          .prepare(`SELECT id, name, '' AS meta FROM track_initiatives WHERE ${s.where} AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`)
          .all(s.arg, like, limit) as Promise<Array<{ id: string; name: string; meta: string }>>),
    db
      .prepare(
        `SELECT id, name, '' AS meta FROM track_dashboards WHERE ${s.where} AND (visibility = 'workspace' OR user_id = ?)
         AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(s.arg, userId, like, limit) as Promise<Array<{ id: string; name: string; meta: string }>>,
  ]);
  return [
    ...plans.map((r) => ({ id: r.id, group: 'trackPlans' as const, label: r.name, meta: r.meta ?? '', href: `/app/track/projects/${r.id}` })),
    ...initiatives.map((r) => ({ id: r.id, group: 'trackInitiatives' as const, label: r.name, meta: '', href: `/app/track/initiatives/${r.id}` })),
    ...dashboards.map((r) => ({ id: r.id, group: 'trackDashboards' as const, label: r.name, meta: '', href: `/app/track/dashboards/${r.id}` })),
  ];
}
