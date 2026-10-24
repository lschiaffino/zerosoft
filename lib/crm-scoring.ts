/**
 * Lead scoring — varios scores por workspace (como HubSpot), cada uno con sus
 * reglas, umbrales (Hot/Warm/Cold) y decaimiento opcional de la actividad.
 * Server-only. La evaluación pura vive en lib/crm-scoring-schema.ts.
 *
 * El score principal se guarda en crm_contacts.score (columna, orden, filtros
 * y workflows de siempre); los demás en crm_contact_scores. Se recalcula en
 * eventos relevantes (contacto creado/editado, email abierto o clickeado,
 * reunión agendada, form enviado, actividad registrada) y una vez por día
 * desde el cron (las ventanas "últimos N días" y el decaimiento vencen
 * solos), con claim por workspace. Si un score cambia: workflow trigger
 * `score_changed` (con umbral opcional y el score elegido) y evento de Flow
 * `contact.score_changed`.
 */
import { getDb, type CrmContactRow, type CrmScoreRow, type CrmScoreRuleRow, type Db } from './db';
import { emitEvent } from './events';
import {
  activityKey,
  activityRuleSchema,
  evaluateScore,
  MAX_SCORES,
  normalizeThresholds,
  parseThresholds,
  propertyRuleSchema,
  type ActivityRuleConfig,
  type PropertyRuleConfig,
  type ScoreActivity,
  type ScoreBreakdownItem,
  type ScoreDef,
  type ScoreDefInput,
  type ScoreRule,
  type ScoreRuleInput,
} from './crm-scoring-schema';

function nowDb(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ---------- Scores (definiciones) ----------

function rowToScore(row: CrmScoreRow): ScoreDef {
  return {
    id: row.id,
    name: row.name,
    isPrimary: !!row.is_primary,
    thresholds: parseThresholds(row.thresholds),
    decayDays: row.decay_days ?? null,
    decayPct: Number(row.decay_pct ?? 0),
    position: row.position,
  };
}

/**
 * El score principal del workspace (lo crea si falta) y le asigna las reglas
 * viejas sin score. Idempotente.
 */
export async function ensurePrimaryScore(workspaceId: string, db: Db = getDb()): Promise<ScoreDef> {
  let row = (await db
    .prepare('SELECT * FROM crm_scores WHERE user_id = ? AND is_primary = 1 ORDER BY created_at ASC LIMIT 1')
    .get(workspaceId)) as CrmScoreRow | undefined;
  if (!row) {
    const id = crypto.randomUUID();
    await db
      .prepare("INSERT INTO crm_scores (id, user_id, name, is_primary, thresholds, position) VALUES (?, ?, 'Lead score', 1, '[]', 0)")
      .run(id, workspaceId);
    row = (await db.prepare('SELECT * FROM crm_scores WHERE id = ?').get(id)) as CrmScoreRow;
  }
  await db.prepare('UPDATE crm_score_rules SET score_id = ? WHERE user_id = ? AND score_id IS NULL').run(row.id, workspaceId);
  return rowToScore(row);
}

export async function listScores(workspaceId: string, db: Db = getDb()): Promise<ScoreDef[]> {
  await ensurePrimaryScore(workspaceId, db);
  const rows = (await db
    .prepare('SELECT * FROM crm_scores WHERE user_id = ? ORDER BY is_primary DESC, position ASC, created_at ASC')
    .all(workspaceId)) as CrmScoreRow[];
  return rows.map(rowToScore);
}

export async function getScore(workspaceId: string, id: string, db: Db = getDb()): Promise<ScoreDef | null> {
  const row = (await db.prepare('SELECT * FROM crm_scores WHERE id = ? AND user_id = ?').get(id, workspaceId)) as CrmScoreRow | undefined;
  return row ? rowToScore(row) : null;
}

export type ScoreSaveResult = { ok: true; score: ScoreDef } | { ok: false; reason: 'limit' | 'not_found' };

export async function createScore(workspaceId: string, input: ScoreDefInput, db: Db = getDb()): Promise<ScoreSaveResult> {
  const existing = await listScores(workspaceId, db);
  if (existing.length >= MAX_SCORES) return { ok: false, reason: 'limit' };
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_scores (id, user_id, name, is_primary, thresholds, decay_days, decay_pct, position)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      input.name,
      JSON.stringify(normalizeThresholds(input.thresholds ?? [])),
      input.decayDays ?? null,
      input.decayPct ?? 0,
      existing.length,
    );
  return { ok: true, score: (await getScore(workspaceId, id, db))! };
}

export async function updateScore(
  workspaceId: string,
  id: string,
  input: Partial<ScoreDefInput>,
  db: Db = getDb(),
): Promise<ScoreSaveResult> {
  const sets: Array<[string, string | number | null]> = [];
  if (input.name !== undefined) sets.push(['name', input.name]);
  if (input.thresholds !== undefined) sets.push(['thresholds', JSON.stringify(normalizeThresholds(input.thresholds))]);
  if (input.decayDays !== undefined) sets.push(['decay_days', input.decayDays]);
  if (input.decayPct !== undefined) sets.push(['decay_pct', input.decayPct]);
  if (sets.length) {
    const res = await db
      .prepare(`UPDATE crm_scores SET ${sets.map(([c]) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(...sets.map(([, v]) => v), id, workspaceId);
    if (!res.changes) return { ok: false, reason: 'not_found' };
  }
  const score = await getScore(workspaceId, id, db);
  return score ? { ok: true, score } : { ok: false, reason: 'not_found' };
}

/** Borra un score que no es el principal, con sus reglas y valores. */
export async function deleteScore(workspaceId: string, id: string, db: Db = getDb()): Promise<boolean> {
  const score = await getScore(workspaceId, id, db);
  if (!score || score.isPrimary) return false;
  await db.prepare('DELETE FROM crm_score_rules WHERE user_id = ? AND score_id = ?').run(workspaceId, id);
  await db.prepare('DELETE FROM crm_contact_scores WHERE score_id = ?').run(id);
  await db.prepare('DELETE FROM crm_scores WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return true;
}

// ---------- Reglas ----------

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
    scoreId: row.score_id ?? null,
    name: row.name,
    kind: row.kind,
    config: parsed.data as PropertyRuleConfig | ActivityRuleConfig,
    points: row.points,
    enabled: !!row.enabled,
    position: row.position,
  };
}

/** Reglas del workspace (todas, o las de un score). */
export async function listScoreRules(workspaceId: string, db: Db = getDb(), scoreId?: string): Promise<ScoreRule[]> {
  const primary = await ensurePrimaryScore(workspaceId, db);
  const rows = (await db
    .prepare('SELECT * FROM crm_score_rules WHERE user_id = ? ORDER BY position ASC, created_at ASC')
    .all(workspaceId)) as CrmScoreRuleRow[];
  const rules = rows.map(rowToRule).filter((r): r is ScoreRule => r !== null).map((r) => ({ ...r, scoreId: r.scoreId ?? primary.id }));
  return scoreId ? rules.filter((r) => r.scoreId === scoreId) : rules;
}

export async function createScoreRule(workspaceId: string, input: ScoreRuleInput, db: Db = getDb()): Promise<ScoreRule | null> {
  const primary = await ensurePrimaryScore(workspaceId, db);
  const scoreId = input.scoreId || primary.id;
  if (scoreId !== primary.id && !(await getScore(workspaceId, scoreId, db))) return null;
  const id = crypto.randomUUID();
  const pos = (await db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM crm_score_rules WHERE user_id = ?')
    .get(workspaceId)) as { p: number };
  await db
    .prepare(
      'INSERT INTO crm_score_rules (id, user_id, score_id, name, kind, config, points, enabled, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, workspaceId, scoreId, input.name ?? '', input.kind, JSON.stringify(input.config), input.points, input.enabled === false ? 0 : 1, pos.p);
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

/**
 * Conteos por activityKey() para las reglas de actividad. Con `withinDays`,
 * la ventana es min(días de la regla, withinDays): sirve para el decaimiento.
 */
async function activityCounts(
  workspaceId: string,
  contactId: string,
  rules: ScoreRule[],
  now: Date,
  db: Db,
  withinDays?: number,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const cache = new Map<string, number>();
  for (const rule of rules) {
    if (rule.kind !== 'activity' || !rule.enabled) continue;
    const cfg = rule.config as ActivityRuleConfig;
    const key = activityKey(cfg);
    if (key in out) continue;
    const days = withinDays ? Math.min(cfg.days, withinDays) : cfg.days;
    const cacheKey = `${cfg.activity}:${days}`;
    if (!cache.has(cacheKey)) {
      const since = nowDb(new Date(now.getTime() - days * 86_400_000));
      const row = (await db.prepare(countSql(cfg.activity)).get(workspaceId, contactId, since)) as { c: number } | undefined;
      cache.set(cacheKey, Number(row?.c ?? 0));
    }
    out[key] = cache.get(cacheKey)!;
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
  /** Los otros scores del workspace (no el principal). */
  others: Array<{ scoreId: string; oldScore: number; score: number; changed: boolean }>;
}

async function evaluateFor(
  workspaceId: string,
  contact: CrmContactRow,
  def: ScoreDef,
  rules: ScoreRule[],
  now: Date,
  db: Db,
): Promise<{ score: number; breakdown: ScoreBreakdownItem[] }> {
  const counts = await activityCounts(workspaceId, contact.id, rules, now, db);
  const decay =
    def.decayDays && def.decayPct > 0
      ? { pct: def.decayPct, recent: await activityCounts(workspaceId, contact.id, rules, now, db, def.decayDays) }
      : undefined;
  return evaluateScore(rules, contact as unknown as Record<string, unknown>, counts, decay);
}

async function fireScoreChanged(
  workspaceId: string,
  contact: CrmContactRow,
  payload: { scoreId: string; scoreName: string; primary: boolean; oldScore: number; newScore: number },
  breakdown: ScoreBreakdownItem[],
): Promise<void> {
  try {
    const { runWorkflowsForEvent } = await import('./crm-workflows');
    await runWorkflowsForEvent(workspaceId, { type: 'score_changed', entity: 'contact', entityId: contact.id, payload });
  } catch {
    /* un workflow nunca rompe el recálculo */
  }
  await emitEvent(workspaceId, 'contact.score_changed', {
    id: contact.id,
    first_name: contact.first_name,
    last_name: contact.last_name,
    email: contact.email,
    ...payload,
    breakdown,
  });
}

/**
 * Recalcula y guarda los scores de un contacto. Si alguno cambió y `fire`
 * (default), dispara workflows `score_changed` y el evento de Flow.
 */
export async function recalcContactScore(
  workspaceId: string,
  contactId: string,
  opts: { fire?: boolean; now?: Date; rules?: ScoreRule[]; scores?: ScoreDef[]; db?: Db } = {},
): Promise<ScoreResult | null> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const contact = (await db
    .prepare('SELECT * FROM crm_contacts WHERE id = ? AND user_id = ?')
    .get(contactId, workspaceId)) as CrmContactRow | undefined;
  if (!contact) return null;
  const scores = opts.scores ?? (await listScores(workspaceId, db));
  const allRules = opts.rules ?? (await listScoreRules(workspaceId, db));
  const primary = scores.find((s) => s.isPrimary) ?? scores[0];
  const fire = opts.fire !== false;

  // Principal: columnas de crm_contacts.
  const primaryRules = allRules.filter((r) => !r.scoreId || r.scoreId === primary?.id);
  const oldScore = Number(contact.score ?? 0);
  let result = { score: 0, breakdown: [] as ScoreBreakdownItem[] };
  if (primaryRules.length || oldScore !== 0 || (contact.score_breakdown ?? '[]') !== '[]') {
    result = primary ? await evaluateFor(workspaceId, contact, primary, primaryRules, now, db) : result;
    const breakdownJson = JSON.stringify(result.breakdown);
    if (result.score !== oldScore || breakdownJson !== contact.score_breakdown) {
      await db
        .prepare('UPDATE crm_contacts SET score = ?, score_breakdown = ?, score_updated_at = ? WHERE id = ?')
        .run(result.score, breakdownJson, nowDb(now), contactId);
    } else if (primaryRules.length) {
      await db.prepare('UPDATE crm_contacts SET score_updated_at = ? WHERE id = ?').run(nowDb(now), contactId);
    }
  }
  const changed = result.score !== oldScore;
  if (changed && fire && primary) {
    await fireScoreChanged(
      workspaceId,
      contact,
      { scoreId: primary.id, scoreName: primary.name, primary: true, oldScore, newScore: result.score },
      result.breakdown,
    );
  }

  // Los demás: crm_contact_scores.
  const others: ScoreResult['others'] = [];
  for (const def of scores) {
    if (def.isPrimary) continue;
    const rules = allRules.filter((r) => r.scoreId === def.id);
    const prev = (await db
      .prepare('SELECT score, breakdown FROM crm_contact_scores WHERE contact_id = ? AND score_id = ?')
      .get(contactId, def.id)) as { score: number; breakdown: string } | undefined;
    if (!rules.length && !prev) continue;
    const r = await evaluateFor(workspaceId, contact, def, rules, now, db);
    const json = JSON.stringify(r.breakdown);
    const before = Number(prev?.score ?? 0);
    if (!prev || prev.score !== r.score || prev.breakdown !== json) {
      await db
        .prepare(
          `INSERT INTO crm_contact_scores (contact_id, score_id, user_id, score, breakdown, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(contact_id, score_id) DO UPDATE SET score = excluded.score, breakdown = excluded.breakdown, updated_at = excluded.updated_at`,
        )
        .run(contactId, def.id, workspaceId, r.score, json, nowDb(now));
    }
    const ch = r.score !== before;
    others.push({ scoreId: def.id, oldScore: before, score: r.score, changed: ch });
    if (ch && fire) {
      await fireScoreChanged(workspaceId, contact, { scoreId: def.id, scoreName: def.name, primary: false, oldScore: before, newScore: r.score }, r.breakdown);
    }
  }
  return { contactId, oldScore, score: result.score, changed, breakdown: result.breakdown, others };
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

/** Recalcula todo el workspace (acotado). Devuelve cuántos contactos cambiaron. */
export async function recalcWorkspaceScores(
  workspaceId: string,
  opts: { fire?: boolean; now?: Date; limit?: number } = {},
): Promise<{ processed: number; changed: number }> {
  const db = getDb();
  const [scores, rules] = [await listScores(workspaceId, db), await listScoreRules(workspaceId, db)];
  const hasOthers = (
    (await db.prepare('SELECT COUNT(*) AS c FROM crm_contact_scores WHERE user_id = ?').get(workspaceId)) as { c: number }
  ).c;
  const ids = (await db
    .prepare(
      `SELECT id FROM crm_contacts WHERE user_id = ? AND (? > 0 OR score != 0 OR score_breakdown != '[]')
       ORDER BY score_updated_at IS NOT NULL, score_updated_at ASC LIMIT ?`,
    )
    .all(workspaceId, rules.length + Number(hasOthers), Math.min(opts.limit ?? 5000, 20000))) as Array<{ id: string }>;
  let changed = 0;
  for (const { id } of ids) {
    const r = await recalcContactScore(workspaceId, id, { fire: opts.fire, now: opts.now, rules, scores, db });
    if (r && (r.changed || r.others.some((o) => o.changed))) changed++;
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

// ---------- Lectura para la UI ----------

export interface ContactScoreView {
  scoreId: string;
  name: string;
  isPrimary: boolean;
  score: number;
  tier: string | null;
  breakdown: ScoreBreakdownItem[];
}

function parseBreakdown(json: string | null | undefined): ScoreBreakdownItem[] {
  try {
    const v: unknown = JSON.parse(json || '[]');
    return Array.isArray(v) ? (v as ScoreBreakdownItem[]) : [];
  } catch {
    return [];
  }
}

/** Todos los scores de un contacto, el principal primero. */
export async function contactScores(workspaceId: string, contact: Pick<CrmContactRow, 'id' | 'score' | 'score_breakdown'>, db: Db = getDb()): Promise<ContactScoreView[]> {
  const { scoreTier } = await import('./crm-scoring-schema');
  const scores = await listScores(workspaceId, db);
  const rows = (await db
    .prepare('SELECT score_id, score, breakdown FROM crm_contact_scores WHERE contact_id = ? AND user_id = ?')
    .all(contact.id, workspaceId)) as Array<{ score_id: string; score: number; breakdown: string }>;
  const byId = new Map(rows.map((r) => [r.score_id, r]));
  return scores.map((s) => {
    const value = s.isPrimary ? Number(contact.score ?? 0) : Number(byId.get(s.id)?.score ?? 0);
    return {
      scoreId: s.id,
      name: s.name,
      isPrimary: s.isPrimary,
      score: value,
      tier: scoreTier(value, s.thresholds),
      breakdown: s.isPrimary ? parseBreakdown(contact.score_breakdown) : parseBreakdown(byId.get(s.id)?.breakdown),
    };
  });
}
