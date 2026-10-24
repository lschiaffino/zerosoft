/**
 * CRM — splits de deals (como HubSpot): el monto de un deal se reparte entre
 * varios dueños por porcentaje. Sin splits, el 100% es del owner del deal.
 * Los reportes por persona, las cuotas y el forecast filtrado por owner usan
 * splitShareSql() para contar a cada uno su parte. Server-only salvo lo puro.
 */
import { getDb, type CrmDealSplitRow, type Db } from './db';
import { isWorkspacePerson } from './crm-refs';

export interface DealSplit {
  ownerId: string;
  percent: number;
}

export const MAX_SPLITS = 10;

export type SplitsValidation = { ok: true; splits: DealSplit[] } | { ok: false; reason: 'invalid_percent' | 'sum_not_100' | 'duplicate_owner' | 'too_many' };

/** Puro: porcentajes > 0, dos decimales, sin dueños repetidos y que sumen 100. Lista vacía = sin splits. */
export function validateSplits(raw: DealSplit[]): SplitsValidation {
  if (raw.length > MAX_SPLITS) return { ok: false, reason: 'too_many' };
  const seen = new Set<string>();
  const splits: DealSplit[] = [];
  for (const s of raw) {
    const percent = Math.round(Number(s.percent) * 100) / 100;
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { ok: false, reason: 'invalid_percent' };
    if (seen.has(s.ownerId)) return { ok: false, reason: 'duplicate_owner' };
    seen.add(s.ownerId);
    splits.push({ ownerId: s.ownerId, percent });
  }
  if (splits.length) {
    const total = splits.reduce((a, s) => a + s.percent, 0);
    if (Math.abs(total - 100) > 0.01) return { ok: false, reason: 'sum_not_100' };
  }
  return { ok: true, splits };
}

/** Puro: monto de cada dueño según los splits (o 100% del owner sin splits). */
export function splitAmounts(amount: number, ownerId: string, splits: DealSplit[]): Array<{ ownerId: string; percent: number; amount: number }> {
  const list = splits.length ? splits : [{ ownerId, percent: 100 }];
  return list.map((s) => ({ ...s, amount: Math.round(amount * s.percent) / 100 }));
}

export async function getSplits(workspaceId: string, dealId: string, db: Db = getDb()): Promise<DealSplit[]> {
  const rows = (await db
    .prepare('SELECT * FROM crm_deal_splits WHERE deal_id = ? AND user_id = ? ORDER BY percent DESC, owner_id ASC')
    .all(dealId, workspaceId)) as CrmDealSplitRow[];
  return rows.map((r) => ({ ownerId: r.owner_id, percent: Number(r.percent) }));
}

export type SetSplitsResult =
  | { ok: true; splits: DealSplit[] }
  | { ok: false; reason: 'invalid_percent' | 'sum_not_100' | 'duplicate_owner' | 'too_many' | 'not_found' | 'invalid_owner' };

/** Reemplaza los splits del deal (vacío = vuelve al 100% del owner) y deja el cambio en el historial. */
export async function setSplits(
  workspaceId: string,
  dealId: string,
  raw: DealSplit[],
  actorEmail = '',
  /** Nombre de cada persona para el historial (si no, el id). */
  labelOf: (personId: string) => string = (id) => id,
  db: Db = getDb(),
): Promise<SetSplitsResult> {
  const deal = (await db.prepare('SELECT id FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, workspaceId)) as { id: string } | undefined;
  if (!deal) return { ok: false, reason: 'not_found' };
  const v = validateSplits(raw);
  if (!v.ok) return { ok: false, reason: v.reason };
  for (const s of v.splits) {
    if (!(await isWorkspacePerson(workspaceId, s.ownerId, db))) return { ok: false, reason: 'invalid_owner' };
  }
  const before = await getSplits(workspaceId, dealId, db);
  await db.prepare('DELETE FROM crm_deal_splits WHERE deal_id = ? AND user_id = ?').run(dealId, workspaceId);
  for (const s of v.splits) {
    await db
      .prepare('INSERT INTO crm_deal_splits (deal_id, user_id, owner_id, percent) VALUES (?, ?, ?, ?)')
      .run(dealId, workspaceId, s.ownerId, s.percent);
  }
  const fmt = (list: DealSplit[]) => list.map((s) => `${labelOf(s.ownerId)} ${s.percent}%`).join(', ');
  if (fmt(before) !== fmt(v.splits)) {
    await db
      .prepare(
        `INSERT INTO crm_property_events (id, user_id, entity, entity_id, field, old_value, new_value, actor_email)
         VALUES (?, ?, 'deal', ?, 'splits', ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), workspaceId, dealId, fmt(before), fmt(v.splits), actorEmail);
  }
  return { ok: true, splits: v.splits };
}

/**
 * Expresión SQL: parte (0..1) del deal `alias` que le toca a los dueños de
 * `ownerCount` placeholders. Consume 2 × ownerCount args (los ids, dos veces).
 */
export function splitShareSql(alias: string, ownerCount: number): string {
  const ph = Array.from({ length: Math.max(1, ownerCount) }, () => '?').join(',');
  return `(CASE WHEN EXISTS (SELECT 1 FROM crm_deal_splits xs WHERE xs.deal_id = ${alias}.id)
    THEN COALESCE((SELECT SUM(xs.percent) FROM crm_deal_splits xs WHERE xs.deal_id = ${alias}.id AND xs.owner_id IN (${ph})), 0) / 100.0
    ELSE CASE WHEN COALESCE(${alias}.owner_id, ${alias}.user_id) IN (${ph}) THEN 1.0 ELSE 0 END END)`;
}

/** Args de splitShareSql para esos dueños. */
export function splitShareArgs(ownerIds: string[]): string[] {
  const ids = ownerIds.length ? ownerIds : [''];
  return [...ids, ...ids];
}
