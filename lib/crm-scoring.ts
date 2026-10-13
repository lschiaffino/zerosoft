/**
 * Lead scoring — reglas por workspace, recálculo por contacto y nocturno.
 * Server-only. La evaluación pura vive en lib/crm-scoring-schema.ts.
 *
 * Se recalcula en eventos relevantes (contacto creado/editado, email abierto o
 * clickeado, reunión agendada, form enviado, actividad registrada) y una vez
 * por día desde el cron (las ventanas "últimos N días" vencen solas). Si el
 * score cambia: workflow trigger `score_changed` (con umbral opcional) y
 * evento de Flow `contact.score_changed`.
 */
import { getDb, type CrmContactRow, type CrmScoreRuleRow, type Db } from './db';
import { emitEvent } from './events';
import {
  activityKey,
  activityRuleSchema,
  evaluateScore,
  propertyRuleSchema,
  type ActivityRuleConfig,
  type PropertyRuleConfig,
  type ScoreActivity,
  type ScoreBreakdownItem,
  type ScoreRule,
  type ScoreRuleInput,
} from './crm-scoring-schema';

function nowDb(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function rowToRule(row: CrmScoreRuleRow): ScoreRule | null {
  let cfg: unknown = {};
  try {
    cfg = JSON.parse(row.config);
  } catch {
    return null;
  }
  const parsed = row.kind === 'property' ? propertyRuleSchema.safeParse(cfg) : activityRuleSchema.safeParse(cfg);
  if (!parsed.success) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    config: parsed.data as PropertyRuleConfig | ActivityRuleConfig,
    points: row.points,
    enabled: !!row.enabled,
    position: row.position,
  };
}

export async function listScoreRules(workspaceId: string, db: Db = getDb()): Promise<ScoreRule[]> {
  const rows = (await db
    .prepare('SELECT * FROM crm_score_rules WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(workspaceId)) as CrmScoreRuleRow[];
  return rows.map(rowToRule).filter((r): r is ScoreRule => r !== null);
}

export async function createScoreRule(workspaceId: string, input: ScoreRuleInput, db: Db = getDb()): Promise<ScoreRule> {
  const id = crypto.randomUUID();
  const pos = (await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM crm_score_rules WHERE user_id = ?')
    .get(workspaceId)) as { p: number };
  await db
    .prepare(
      'INSERT INTO crm_score_rules (id, user_id, name, kind, config, points, enabled, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, workspaceId, input.name ?? '', input.kind, JSON.stringify(input.config), input.points, input.enabled === false ? 0 : 1, pos.p);
  const row = (await db.prepare('SELECT * FROM crm_score_rules WHERE id = ?').get(id)) as CrmScoreRuleRow;
  return rowToRule(row)!;
}

export async function updateScoreRule(
  workspaceId: string,
  id: string,
  input: ScoreRuleInput,
  db: Db = getDb(),
): Promise<ScoreRule | null> {
  const res = await db
    .prepare(
      `UPDATE crm_score_rules SET name = ?, kind = ?, config = ?, points = ?, enabled = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(input.name ?? '', input.kind, JSON.stringify(input.config), input.points, input.enabled === false ? 0 : 1, id, workspaceId);
  if (!res.changes) return null;
  const row = (await db.prepare('SELECT * FROM crm_score_rules WHERE id = ?').get(id)) as CrmScoreRuleRow;
  return rowToRule(row);
}

export async function deleteScoreRule(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  return (await db.prepare('DELETE FROM crm_score_rules WHERE id = ? AND user_id = ?').run(id, workspaceId)).changes > 0;
}

// ---------- Conteo de actividad ----------

function countSql(activity: ScoreActivity): string {
  switch (activity) {
    case 'email_opened':
      return `SELECT COUNT(DISTINCT e.email_id) AS c FROM crm_email_events e
              JOIN crm_email_contacts ec ON ec.email_id = e.email_id
              WHERE e.user_id = ? AND ec.contact_id = ? AND e.kind = 'open' AND e.created_at >= ?`;
    case 'email_clicked':
      return `SELECT COUNT(*) AS c FROM crm_email_events e
              JOIN crm_email_contacts ec ON ec.email_id = e.email_id
              WHERE e.user_id = ? AND ec.contact_id = ? AND e.kind = 'click' AND e.created_at >= ?`;
    case 'email_replied':
      return `SELECT COUNT(*) AS c FROM crm_emails m
              JOIN crm_email_contacts ec ON ec.email_id = m.id
              WHERE m.user_id = ? AND ec.contact_id = ? AND m.direction = 'in'
                AND COALESCE(NULLIF(m.sent_at, ''), m.created_at) >= ?`;
    case 'meeting_booked':
      return `SELECT COUNT(*) AS c FROM crm_activities a
              WHERE a.user_id = ? AND a.contact_id = ? AND a.type = 'meeting' AND a.created_at >= ?`;
    case 'call_logged':
      return `SELECT COUNT(*) AS c FROM crm_activities a
              WHERE a.user_id = ? AND a.contact_id = ? AND a.type = 'call' AND a.created_at >= ?`;
    case 'note_logged':
      return `SELECT COUNT(*) AS c FROM crm_activities a
              WHERE a.user_id = ? AND a.contact_id = ? AND a.type = 'note' AND a.created_at >= ?`;
    case 'form_submitted':
      return `SELECT COUNT(*) AS c FROM crm_form_submissions s
              WHERE s.user_id = ? AND s.contact_id = ? AND s.created_at >= ?`;
  }
}

async function activityCounts(
  workspaceId: string,
  contactId: string,
  rules: ScoreRule[],
  now: Date,
  db: Db,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const rule of rules) {
    if (rule.kind !== 'activity' || !rule.enabled) continue;
    const cfg = rule.config as ActivityRuleConfig;
    const key = activityKey(cfg);
    if (key in out) continue;
    const since = nowDb(new Date(now.getTime() - cfg.days * 86_400_000));
    const row = (await db.prepare(countSql(cfg.activity)).get(workspaceId, contactId, since)) as { c: number } | undefined;
    out[key] = Number(row?.c ?? 0);
  }
  return out;
}

// ---------- Recálculo ----------

export interface ScoreResult {
  contactId: string;
  oldScore: number;
  score: number;
  changed: boolean;
  breakdown: ScoreBreakdownItem[];
}

/**
 * Recalcula y guarda el score de un contacto. Si cambió y `fire` (default),
 * dispara workflows `score_changed` y el evento de Flow `contact.score_changed`.
 */
export async function recalcContactScore(
  workspaceId: string,
  contactId: string,
  opts: { fire?: boolean; now?: Date; rules?: ScoreRule[]; db?: Db } = {},
): Promise<ScoreResult | null> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const contact = (await db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(contactId, workspaceId)) as CrmContactRow | undefined;
  if (!contact) return null;
  const rules = opts.rules ?? (await listScoreRules(workspaceId, db));
  const oldScore = Number(contact.score ?? 0);
  if (!rules.length && oldScore === 0 && (contact.score_breakdown ?? '[]') === '[]') {
    return { contactId, oldScore, score: 0, changed: false, breakdown: [] };
  }
  const counts = await activityCounts(workspaceId, contactId, rules, now, db);
  const { score, breakdown } = evaluateScore(rules, contact as unknown as Record<string, unknown>, counts);
  const breakdownJson = JSON.stringify(breakdown);
  if (score !== oldScore || breakdownJson !== contact.score_breakdown) {
    await db
      .prepare('UPDATE crm_contacts SET score = ?, score_breakdown = ?, score_updated_at = ? WHERE id = ?')
      .run(score, breakdownJson, nowDb(now), contactId);
  }
  const changed = score !== oldScore;
  if (changed && opts.fire !== false) {
    const payload = { oldScore, newScore: score };
    try {
      const { runWorkflowsForEvent } = await import('./crm-workflows');
      await runWorkflowsForEvent(workspaceId, {
        type: 'score_changed',
        entity: 'contact',
        entityId: contactId,
        payload,
      });
    } catch {
      /* un workflow nunca rompe el recálculo */
    }
    await emitEvent(workspaceId, 'contact.score_changed', {
      id: contactId,
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      ...payload,
      breakdown,
    });
  }
  return { contactId, oldScore, score, changed, breakdown };
}

/** Recalcula sin propagar errores (hooks de eventos). */
export async function recalcContactScoreSafe(workspaceId: string, contactId: string | null | undefined): Promise<void> {
  if (!contactId) return;
  try {
    await recalcContactScore(workspaceId, contactId);
  } catch {
    /* el scoring nunca rompe la operación que lo disparó */
  }
}

/** Recalcula todo el workspace (acotado). Devuelve cuántos cambiaron. */
export async function recalcWorkspaceScores(
  workspaceId: string,
  opts: { fire?: boolean; now?: Date; limit?: number } = {},
): Promise<{ processed: number; changed: number }> {
  const db = getDb();
  const rules = await listScoreRules(workspaceId, db);
  const ids = (await db
    .prepare(
      `SELECT id FROM crm_contacts WHERE user_id = ? AND (? > 0 OR score != 0 OR score_breakdown != '[]')
       ORDER BY score_updated_at IS NOT NULL, score_updated_at ASC LIMIT ?`,
    )
    .all(workspaceId, rules.length, Math.min(opts.limit ?? 5000, 20000))) as Array<{ id: string }>;
  let changed = 0;
  for (const { id } of ids) {
    const r = await recalcContactScore(workspaceId, id, { fire: opts.fire, now: opts.now, rules, db });
    if (r?.changed) changed++;
  }
  return { processed: ids.length, changed };
}

/**
 * Recálculo nocturno (cron horario): cada workspace con reglas se recalcula
 * una vez por día UTC. Acotado por cantidad de workspaces por tick.
 */
export async function runNightlyScoring(now: Date = new Date(), maxWorkspaces = 10): Promise<{ workspaces: number; changed: number }> {
  const db = getDb();
  const today = now.toISOString().slice(0, 10);
  const due = (await db
    .prepare(
      `SELECT DISTINCT r.user_id FROM crm_score_rules r
       LEFT JOIN crm_score_state s ON s.user_id = r.user_id
       WHERE r.enabled = 1 AND (s.last_full_run IS NULL OR s.last_full_run < ?)
       LIMIT ?`,
    )
    .all(today, maxWorkspaces)) as Array<{ user_id: string }>;
  let changed = 0;
  for (const { user_id } of due) {
    // Se marca antes de correr: dos ticks simultáneos no recalculan dos veces.
    const claim = await db
      .prepare(
        `INSERT INTO crm_score_state (user_id, last_full_run) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_full_run = excluded.last_full_run
         WHERE crm_score_state.last_full_run IS NULL OR crm_score_state.last_full_run < excluded.last_full_run`,
      )
      .run(user_id, today);
    if (!claim.changes) continue;
    changed += (await recalcWorkspaceScores(user_id, { now })).changed;
  }
  return { workspaces: due.length, changed };
}
