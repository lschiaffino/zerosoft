/**
 * CRM — aprobaciones de pipeline (como HubSpot): reglas que piden la
 * aprobación de ciertas personas para entrar a una etapa, siempre o cuando el
 * deal supera un monto (en moneda base) o un descuento. Server-only.
 *
 * moveDeal() consulta checkApproval() en todo cambio de etapa iniciado por
 * una persona o una automatización (tablero, select, API, edición en masa,
 * workflows, Flow); el import y los presupuestos aceptados no lo exigen.
 * Quien figura como aprobador mueve sin pedir. Un pedido aprobado habilita un
 * solo movimiento a esa etapa: al aprobar se intenta mover el deal y, si la
 * etapa pide propiedades que faltan, el pedido queda aprobado hasta que quien
 * lo pidió mueva el deal.
 */
import { getDb, type CrmApprovalRuleRow, type CrmDealApprovalRow, type CrmDealRow, type Db } from './db';
import { isWorkspacePerson } from './crm-refs';
import { getCurrencyContext } from './crm-currency';
import { toBase } from './crm-money';
import { z } from 'zod';

/** Cuerpo de alta/edición de una regla (rutas de Ajustes). */
export const approvalRuleSchema = z.object({
  pipelineId: z.string().trim().min(1).max(100),
  stageId: z.string().trim().min(1).max(100),
  minAmount: z.number().min(0).max(1e12).nullable().optional(),
  minDiscount: z.number().min(0).max(100).nullable().optional(),
  approverIds: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  enabled: z.boolean().optional(),
});

export interface ApprovalRule {
  id: string;
  pipelineId: string;
  stageId: string;
  minAmount: number | null;
  minDiscount: number | null;
  approverIds: string[];
  enabled: boolean;
}

export interface ApprovalRuleInput {
  pipelineId: string;
  stageId: string;
  minAmount?: number | null;
  minDiscount?: number | null;
  approverIds: string[];
  enabled?: boolean;
}

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function parseIds(json: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(json || '[]');
    return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];
  } catch {
    return [];
  }
}

function toRule(row: CrmApprovalRuleRow): ApprovalRule {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    minAmount: row.min_amount ?? null,
    minDiscount: row.min_discount ?? null,
    approverIds: parseIds(row.approver_ids),
    enabled: !!row.enabled,
  };
}

// ---------- Reglas ----------

export async function listApprovalRules(workspaceId: string, db: Db = getDb()): Promise<ApprovalRule[]> {
  const rows = (await db
    .prepare('SELECT * FROM crm_approval_rules WHERE user_id = ? ORDER BY created_at ASC')
    .all(workspaceId)) as CrmApprovalRuleRow[];
  return rows.map(toRule);
}

export type RuleSaveResult = { ok: true; rule: ApprovalRule } | { ok: false; reason: 'invalid_stage' | 'invalid_approver' | 'not_found' };

async function validateRule(workspaceId: string, input: ApprovalRuleInput, db: Db): Promise<RuleSaveResult | null> {
  const stage = await db
    .prepare(
      `SELECT s.id FROM crm_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id
       WHERE s.id = ? AND s.pipeline_id = ? AND p.user_id = ?`,
    )
    .get(input.stageId, input.pipelineId, workspaceId);
  if (!stage) return { ok: false, reason: 'invalid_stage' };
  if (!input.approverIds.length) return { ok: false, reason: 'invalid_approver' };
  for (const id of input.approverIds) {
    if (!(await isWorkspacePerson(workspaceId, id, db))) return { ok: false, reason: 'invalid_approver' };
  }
  return null;
}

export async function createApprovalRule(workspaceId: string, input: ApprovalRuleInput, db: Db = getDb()): Promise<RuleSaveResult> {
  const invalid = await validateRule(workspaceId, input, db);
  if (invalid) return invalid;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_approval_rules (id, user_id, pipeline_id, stage_id, min_amount, min_discount, approver_ids, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      input.pipelineId,
      input.stageId,
      input.minAmount ?? null,
      input.minDiscount ?? null,
      JSON.stringify([...new Set(input.approverIds)]),
      input.enabled === false ? 0 : 1,
    );
  const row = (await db.prepare('SELECT * FROM crm_approval_rules WHERE id = ?').get(id)) as CrmApprovalRuleRow;
  return { ok: true, rule: toRule(row) };
}

export async function updateApprovalRule(
  workspaceId: string,
  id: string,
  input: ApprovalRuleInput,
  db: Db = getDb(),
): Promise<RuleSaveResult> {
  const invalid = await validateRule(workspaceId, input, db);
  if (invalid) return invalid;
  const res = await db
    .prepare(
      `UPDATE crm_approval_rules SET pipeline_id = ?, stage_id = ?, min_amount = ?, min_discount = ?, approver_ids = ?, enabled = ?,
         updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    )
    .run(
      input.pipelineId,
      input.stageId,
      input.minAmount ?? null,
      input.minDiscount ?? null,
      JSON.stringify([...new Set(input.approverIds)]),
      input.enabled === false ? 0 : 1,
      id,
      workspaceId,
    );
  if (!res.changes) return { ok: false, reason: 'not_found' };
  const row = (await db.prepare('SELECT * FROM crm_approval_rules WHERE id = ?').get(id)) as CrmApprovalRuleRow;
  return { ok: true, rule: toRule(row) };
}

export async function deleteApprovalRule(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_approval_rules WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
}

// ---------- Condiciones ----------

/** Descuento total de los line items del deal, en % del subtotal (0 sin items). */
export async function dealDiscountPct(dealId: string, db: Db = getDb()): Promise<number> {
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(quantity * unit_price), 0) AS sub,
         COALESCE(SUM(quantity * unit_price * discount_pct / 100.0), 0) AS disc
       FROM crm_line_items WHERE deal_id = ?`,
    )
    .get(dealId)) as { sub: number; disc: number } | undefined;
  const sub = Number(row?.sub ?? 0);
  return sub > 0 ? Math.round((Number(row?.disc ?? 0) / sub) * 10000) / 100 : 0;
}

/** ¿La regla aplica a este deal? Sin condiciones aplica siempre; con varias, todas. */
export function ruleApplies(rule: Pick<ApprovalRule, 'minAmount' | 'minDiscount' | 'enabled'>, facts: { amountBase: number; discountPct: number }): boolean {
  if (!rule.enabled) return false;
  if (rule.minAmount !== null && !(facts.amountBase >= rule.minAmount)) return false;
  if (rule.minDiscount !== null && !(facts.discountPct >= rule.minDiscount)) return false;
  return true;
}

export interface ApprovalNeed {
  /** Aprobadores (unión de las reglas que aplican). */
  approverIds: string[];
  ruleId: string;
  pending: CrmDealApprovalRow | null;
}

export type ApprovalCheck = { needed: false; approvedId?: string } | ({ needed: true } & ApprovalNeed);

/**
 * ¿Mover `deal` a `stageId` necesita aprobación? `actorId` = quien mueve (si
 * es aprobador, no). Un pedido aprobado y sin usar habilita el movimiento.
 */
export async function checkApproval(
  workspaceId: string,
  deal: Pick<CrmDealRow, 'id' | 'amount' | 'currency' | 'pipeline_id'>,
  stageId: string,
  actorId: string | null,
  db: Db = getDb(),
): Promise<ApprovalCheck> {
  const rules = ((await db
    .prepare('SELECT * FROM crm_approval_rules WHERE user_id = ? AND stage_id = ? AND enabled = 1')
    .all(workspaceId, stageId)) as CrmApprovalRuleRow[]).map(toRule);
  if (!rules.length) return { needed: false };
  const ctx = await getCurrencyContext(workspaceId, db);
  const facts = {
    amountBase: toBase(Number(deal.amount ?? 0), deal.currency, ctx),
    discountPct: rules.some((r) => r.minDiscount !== null) ? await dealDiscountPct(deal.id, db) : 0,
  };
  const applying = rules.filter((r) => ruleApplies(r, facts));
  if (!applying.length) return { needed: false };
  const approverIds = [...new Set(applying.flatMap((r) => r.approverIds))];
  if (actorId && approverIds.includes(actorId)) return { needed: false };
  const approved = (await db
    .prepare(
      `SELECT id FROM crm_deal_approvals WHERE deal_id = ? AND stage_id = ? AND status = 'approved' AND consumed_at IS NULL
       ORDER BY decided_at DESC LIMIT 1`,
    )
    .get(deal.id, stageId)) as { id: string } | undefined;
  if (approved) return { needed: false, approvedId: approved.id };
  const pending = (await db
    .prepare("SELECT * FROM crm_deal_approvals WHERE deal_id = ? AND stage_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
    .get(deal.id, stageId)) as CrmDealApprovalRow | undefined;
  return { needed: true, approverIds, ruleId: applying[0].id, pending: pending ?? null };
}

/** Marca usado el pedido aprobado (después de mover). */
export async function consumeApproval(approvalId: string, db: Db = getDb()): Promise<void> {
  await db.prepare('UPDATE crm_deal_approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(nowDb(), approvalId);
}

// ---------- Pedidos ----------

export interface ApprovalView extends CrmDealApprovalRow {
  deal_name: string;
  deal_amount: number;
  deal_currency: string;
  stage_name: string;
  from_stage_name: string | null;
  approvers: string[];
}

const VIEW_SELECT = `
  SELECT a.*, d.name AS deal_name, d.amount AS deal_amount, d.currency AS deal_currency,
    s.name AS stage_name, fs.name AS from_stage_name
  FROM crm_deal_approvals a
  JOIN crm_deals d ON d.id = a.deal_id
  LEFT JOIN crm_stages s ON s.id = a.stage_id
  LEFT JOIN crm_stages fs ON fs.id = a.from_stage_id`;

function toView(row: Omit<ApprovalView, 'approvers'>): ApprovalView {
  return { ...row, approvers: parseIds(row.approver_ids) };
}

export async function getApproval(workspaceId: string, id: string, db: Db = getDb()): Promise<ApprovalView | null> {
  const row = (await db.prepare(`${VIEW_SELECT} WHERE a.id = ? AND a.user_id = ?`).get(id, workspaceId)) as
    | Omit<ApprovalView, 'approvers'>
    | undefined;
  return row ? toView(row) : null;
}

export async function listApprovals(
  workspaceId: string,
  filter: { status?: CrmDealApprovalRow['status'] | 'decided'; approverId?: string; requestedBy?: string; dealId?: string; limit?: number } = {},
  db: Db = getDb(),
): Promise<ApprovalView[]> {
  const where = ['a.user_id = ?'];
  const args: Array<string | number> = [workspaceId];
  if (filter.status === 'decided') where.push("a.status IN ('approved', 'rejected')");
  else if (filter.status) {
    where.push('a.status = ?');
    args.push(filter.status);
  }
  if (filter.approverId) {
    where.push('EXISTS (SELECT 1 FROM json_each(a.approver_ids) WHERE value = ?)');
    args.push(filter.approverId);
  }
  if (filter.requestedBy) {
    where.push('a.requested_by = ?');
    args.push(filter.requestedBy);
  }
  if (filter.dealId) {
    where.push('a.deal_id = ?');
    args.push(filter.dealId);
  }
  args.push(Math.min(filter.limit ?? 100, 500));
  const rows = (await db
    .prepare(`${VIEW_SELECT} WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ?`)
    .all(...args)) as Array<Omit<ApprovalView, 'approvers'>>;
  return rows.map(toView);
}

export async function countPendingFor(workspaceId: string, approverId: string, db: Db = getDb()): Promise<number> {
  const row = (await db
    .prepare(
      `SELECT COUNT(*) AS c FROM crm_deal_approvals a
       WHERE a.user_id = ? AND a.status = 'pending' AND EXISTS (SELECT 1 FROM json_each(a.approver_ids) WHERE value = ?)`,
    )
    .get(workspaceId, approverId)) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

export type RequestResult =
  | { ok: true; approval: ApprovalView; created: boolean }
  | { ok: false; reason: 'not_found' | 'not_needed' };

/** Pide aprobación para mover el deal a la etapa (si ya hay un pedido abierto, lo devuelve). */
export async function requestApproval(
  workspaceId: string,
  dealId: string,
  stageId: string,
  requester: { id: string; name: string },
  note = '',
  db: Db = getDb(),
): Promise<RequestResult> {
  const deal = (await db.prepare('SELECT * FROM crm_deals WHERE id = ? AND user_id = ?').get(dealId, workspaceId)) as CrmDealRow | undefined;
  if (!deal) return { ok: false, reason: 'not_found' };
  const stage = await db.prepare('SELECT id FROM crm_stages WHERE id = ? AND pipeline_id = ?').get(stageId, deal.pipeline_id);
  if (!stage) return { ok: false, reason: 'not_found' };
  const check = await checkApproval(workspaceId, deal, stageId, requester.id, db);
  if (!check.needed) return { ok: false, reason: 'not_needed' };
  if (check.pending) return { ok: true, approval: (await getApproval(workspaceId, check.pending.id, db))!, created: false };
  const id = crypto.randomUUID();
  const ts = nowDb();
  await db
    .prepare(
      `INSERT INTO crm_deal_approvals (id, user_id, deal_id, rule_id, stage_id, from_stage_id, status, requested_by, note, approver_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, dealId, check.ruleId, stageId, deal.stage_id, requester.id, note.slice(0, 2000), JSON.stringify(check.approverIds), ts, ts);
  const approval = (await getApproval(workspaceId, id, db))!;
  const { createNotification } = await import('./notifications');
  for (const approverId of check.approverIds) {
    await createNotification({
      userId: approverId,
      type: 'crm_approval',
      title: `${requester.name || 'Someone'} asks to move ${deal.name} to ${approval.stage_name}`,
      body: note.slice(0, 140) || undefined,
      href: `/app/crm/deals/${dealId}`,
      sourceType: 'crm_deal',
      sourceId: dealId,
      meta: { approvalId: id },
    }).catch(() => null);
  }
  return { ok: true, approval, created: true };
}

export type DecideResult =
  | { ok: true; approval: ApprovalView; moved: boolean; missing?: string[] }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'not_pending' };

/**
 * Aprobar o rechazar (solo quienes figuran como aprobadores). Al aprobar se
 * intenta mover el deal; si la etapa pide propiedades, queda aprobado y lo
 * mueve quien lo pidió.
 */
export async function decideApproval(
  workspaceId: string,
  id: string,
  actor: { id: string; name: string; email: string },
  decision: 'approve' | 'reject',
  note = '',
  db: Db = getDb(),
): Promise<DecideResult> {
  const approval = await getApproval(workspaceId, id, db);
  if (!approval) return { ok: false, reason: 'not_found' };
  if (!approval.approvers.includes(actor.id)) return { ok: false, reason: 'forbidden' };
  // Compare-and-set: dos decisiones simultáneas no pisan una a la otra.
  const res = await db
    .prepare(
      `UPDATE crm_deal_approvals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(decision === 'approve' ? 'approved' : 'rejected', actor.id, note.slice(0, 2000), nowDb(), nowDb(), id);
  if (!res.changes) return { ok: false, reason: 'not_pending' };
  let moved = false;
  let missing: string[] | undefined;
  if (decision === 'approve') {
    const { moveDeal } = await import('./crm');
    const r = await moveDeal(workspaceId, approval.deal_id, approval.stage_id, null, undefined, actor.email, { actorId: approval.requested_by });
    moved = r.ok;
    if (!r.ok && r.reason === 'missing_required') missing = r.missing;
    // Igual que "Close as won": ganar fija la fecha de cierre en hoy (zona de quien aprueba).
    if (r.ok) {
      const stage = (await db.prepare('SELECT is_won FROM crm_stages WHERE id = ?').get(approval.stage_id)) as { is_won: number } | undefined;
      if (stage?.is_won) {
        const [{ updateDeal }, { getUserTimeZone }] = await Promise.all([import('./crm'), import('./user-tz')]);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: await getUserTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        await updateDeal(workspaceId, approval.deal_id, { closeDate: today }, actor.email);
      }
    }
  }
  if (approval.requested_by) {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: approval.requested_by,
      type: 'crm_approval',
      title:
        decision === 'approve'
          ? `${actor.name || actor.email} approved moving ${approval.deal_name} to ${approval.stage_name}`
          : `${actor.name || actor.email} rejected moving ${approval.deal_name} to ${approval.stage_name}`,
      body: note.slice(0, 140) || undefined,
      href: `/app/crm/deals/${approval.deal_id}`,
      sourceType: 'crm_deal',
      sourceId: approval.deal_id,
      meta: { approvalId: id, decision },
    }).catch(() => null);
  }
  return { ok: true, approval: (await getApproval(workspaceId, id, db))!, moved, ...(missing ? { missing } : {}) };
}

/** Quien pidió (o un aprobador) cancela un pedido pendiente. */
export async function cancelApproval(workspaceId: string, id: string, actorId: string, db: Db = getDb()): Promise<boolean> {
  const approval = await getApproval(workspaceId, id, db);
  if (!approval) return false;
  if (approval.requested_by !== actorId && !approval.approvers.includes(actorId)) return false;
  const res = await db
    .prepare("UPDATE crm_deal_approvals SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(nowDb(), id);
  return res.changes > 0;
}
