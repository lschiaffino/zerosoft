/**
 * Track — initiatives (como Linear): agrupan plans bajo un objetivo, con
 * responsable, estado, fecha objetivo y sub-initiatives. El progreso es el de
 * sus plans (incluidos los de las sub-initiatives) y la salud, la peor entre
 * sus plans en curso.
 */
import { getDb } from './db';
import { inScope, listPlans, listWorkspaceMembers, scopeWhere, type PlanSummary, type WorkspaceScope } from './track-plans';
import type { HealthState } from './track-planning-core';
import type { InitiativeCreatePayload, InitiativeStatus, InitiativeUpdatePayload } from './track-planning-schema';

export interface TrackInitiativeRow {
  id: string;
  team_id: string | null;
  owner_id: string | null;
  parent_id: string | null;
  name: string;
  icon: string | null;
  description: string;
  status: InitiativeStatus;
  lead_id: string | null;
  target_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InitiativeSummary extends TrackInitiativeRow {
  lead_name: string | null;
  parent_name: string | null;
  plan_ids: string[];
  child_ids: string[];
  /** Plans propios y de las sub-initiatives. */
  plans: PlanSummary[];
  percent: number;
  health: HealthState;
  start_date: string | null;
  end_date: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function inClause(n: number): string {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

const HEALTH_RANK: Record<HealthState, number> = { off_track: 0, at_risk: 1, missing: 2, on_track: 3, none: 4 };

/** La peor salud de los plans en curso, como el color de "Active projects" de Linear. */
export function worstHealth(plans: Array<{ status: string; health: HealthState }>): HealthState {
  const active = plans.filter((p) => p.status === 'in_progress');
  if (!active.length) return 'none';
  return active.reduce<HealthState>((w, p) => (HEALTH_RANK[p.health] < HEALTH_RANK[w] ? p.health : w), 'none');
}

export async function getInitiative(id: string): Promise<TrackInitiativeRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_initiatives WHERE id = ?').get(id)) as TrackInitiativeRow | undefined;
}

export async function getAccessibleInitiative(id: string, scope: WorkspaceScope): Promise<TrackInitiativeRow | undefined> {
  const row = await getInitiative(id);
  return row && inScope(row, scope) ? row : undefined;
}

async function validParent(scope: WorkspaceScope, id: string | null | undefined, self?: string): Promise<string | null> {
  if (!id || id === self) return null;
  const row = await getAccessibleInitiative(id, scope);
  if (!row) return null;
  // Sin ciclos: el padre no puede ser descendiente propio.
  let cur: TrackInitiativeRow | undefined = row;
  for (let i = 0; cur && i < 20; i++) {
    if (cur.id === self) return null;
    cur = cur.parent_id ? await getInitiative(cur.parent_id) : undefined;
  }
  return row.id;
}

async function setPlans(scope: WorkspaceScope, initiativeId: string, planIds: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM track_initiative_plans WHERE initiative_id = ?').run(initiativeId);
  if (!planIds.length) return;
  const s = scopeWhere(scope);
  const valid = (await db
    .prepare(`SELECT id FROM track_plans WHERE ${s.where} AND id IN ${inClause(planIds.length)}`)
    .all(s.arg, ...planIds)) as Array<{ id: string }>;
  for (const p of valid) {
    await db.prepare('INSERT OR IGNORE INTO track_initiative_plans (initiative_id, plan_id) VALUES (?, ?)').run(initiativeId, p.id);
  }
}

async function validLead(scope: WorkspaceScope, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await listWorkspaceMembers(scope)).some((m) => m.id === id) ? id : null;
}

export async function createInitiative(
  scope: WorkspaceScope,
  actorId: string,
  payload: InitiativeCreatePayload,
): Promise<TrackInitiativeRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO track_initiatives (id, team_id, owner_id, parent_id, name, icon, description, status, lead_id, target_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      scope.teamId,
      scope.ownerId,
      await validParent(scope, payload.parentId),
      payload.name.trim(),
      payload.icon?.trim() || null,
      payload.description ?? '',
      payload.status ?? 'planned',
      await validLead(scope, payload.leadId),
      payload.targetDate ?? null,
      actorId,
      now,
      now,
    );
  if (payload.planIds) await setPlans(scope, id, payload.planIds);
  return (await getInitiative(id)) as TrackInitiativeRow;
}

export async function updateInitiative(
  row: TrackInitiativeRow,
  scope: WorkspaceScope,
  payload: InitiativeUpdatePayload,
): Promise<TrackInitiativeRow> {
  const fields: string[] = [];
  const args: Array<string | null> = [];
  const set = (c: string, v: string | null) => {
    fields.push(`${c} = ?`);
    args.push(v);
  };
  if (payload.name !== undefined) set('name', payload.name.trim());
  if (payload.icon !== undefined) set('icon', payload.icon.trim() || null);
  if (payload.description !== undefined) set('description', payload.description);
  if (payload.status !== undefined) set('status', payload.status);
  if (payload.leadId !== undefined) set('lead_id', await validLead(scope, payload.leadId));
  if (payload.targetDate !== undefined) set('target_date', payload.targetDate ?? null);
  if (payload.parentId !== undefined) set('parent_id', await validParent(scope, payload.parentId, row.id));
  if (fields.length) {
    set('updated_at', nowIso());
    await getDb()
      .prepare(`UPDATE track_initiatives SET ${fields.join(', ')} WHERE id = ?`)
      .run(...args, row.id);
  }
  if (payload.planIds !== undefined) await setPlans(scope, row.id, payload.planIds);
  return (await getInitiative(row.id)) as TrackInitiativeRow;
}

export async function deleteInitiative(id: string): Promise<boolean> {
  const db = getDb();
  await db.prepare('UPDATE track_initiatives SET parent_id = NULL WHERE parent_id = ?').run(id);
  const res = await db.prepare('DELETE FROM track_initiatives WHERE id = ?').run(id);
  return res.changes > 0;
}

/** Initiatives del workspace con plans, progreso agregado y salud. */
export async function listInitiatives(scope: WorkspaceScope, opts: { ids?: string[]; q?: string } = {}): Promise<InitiativeSummary[]> {
  const db = getDb();
  const s = scopeWhere(scope, 'i');
  const rows = (await db
    .prepare(
      `SELECT i.*, u.name AS lead_name, pi.name AS parent_name FROM track_initiatives i
       LEFT JOIN users u ON u.id = i.lead_id
       LEFT JOIN track_initiatives pi ON pi.id = i.parent_id
       WHERE ${s.where}
       ORDER BY CASE i.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 WHEN 'proposed' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
         i.target_date IS NULL, i.target_date ASC, i.name ASC LIMIT 500`,
    )
    .all(s.arg)) as Array<TrackInitiativeRow & { lead_name: string | null; parent_name: string | null }>;
  if (!rows.length) return [];
  const links = (await db
    .prepare(`SELECT initiative_id, plan_id FROM track_initiative_plans WHERE initiative_id IN ${inClause(rows.length)}`)
    .all(...rows.map((r) => r.id))) as Array<{ initiative_id: string; plan_id: string }>;
  const plans = await listPlans(scope, { ids: [...new Set(links.map((l) => l.plan_id))] });
  const byId = new Map(plans.map((p) => [p.id, p]));
  const childrenOf = (id: string) => rows.filter((r) => r.parent_id === id).map((r) => r.id);
  const collect = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const own = links.filter((l) => l.initiative_id === id).map((l) => l.plan_id);
    return [...own, ...childrenOf(id).flatMap((c) => collect(c, seen))];
  };
  let out: InitiativeSummary[] = rows.map((r) => {
    const all = [...new Set(collect(r.id))].map((pid) => byId.get(pid)).filter((p): p is PlanSummary => Boolean(p));
    const points = all.reduce((a, p) => a + p.progress.points, 0);
    const done = all.reduce((a, p) => a + p.progress.donePoints, 0);
    const starts = all.map((p) => p.start_date ?? p.created_at.slice(0, 10)).sort();
    const ends = all.map((p) => p.target_date).filter((d): d is string => Boolean(d)).sort();
    return {
      ...r,
      plan_ids: links.filter((l) => l.initiative_id === r.id).map((l) => l.plan_id),
      child_ids: childrenOf(r.id),
      plans: all,
      percent: points > 0 ? Math.round((done / points) * 100) : 0,
      health: worstHealth(all),
      start_date: starts[0] ?? null,
      end_date: r.target_date ?? ends[ends.length - 1] ?? null,
    };
  });
  if (opts.ids) out = out.filter((r) => opts.ids!.includes(r.id));
  if (opts.q?.trim()) {
    const q = opts.q.trim().toLowerCase();
    out = out.filter((r) => r.name.toLowerCase().includes(q));
  }
  return out;
}
