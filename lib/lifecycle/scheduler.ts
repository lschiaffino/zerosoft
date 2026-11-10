/**
 * Cron de los emails de ciclo de vida (corre en /api/cron/tick, cada hora).
 *
 * - Sin proveedor de email (RESEND_API_KEY) el motor no hace nada y lo dice
 *   una vez en el log. LIFECYCLE_EMAILS=console los manda al log (desarrollo
 *   y e2e); LIFECYCLE_EMAILS=off los apaga aunque haya Resend.
 * - Cada persona tiene una fila en lifecycle_state con next_check_at. El cron
 *   toma las vencidas y reclama cada una (compare-and-set en claimed_until):
 *   dos corridas a la vez nunca procesan a la misma persona.
 * - Cada envío es una fila de lifecycle_sends con UNIQUE (user_id, send_key):
 *   el INSERT es el claim, así que un email nunca sale dos veces. A Resend va
 *   con Idempotency-Key por si se pierde la respuesta. Un fallo se reintenta
 *   (hasta 3 veces) en la próxima corrida.
 * - Las cuentas que ya existían al crear el motor (legacy) no reciben la
 *   serie; sí el digest si lo activan.
 */
import { appSender, sendEmail } from '../email';
import { getDb } from '../db';
import { siteUrl } from '../board-urls';
import { getEmailPrefs, unsubscribeToken } from './prefs';
import { decideNext, digestKey, LIFECYCLE_LIMITS, parseTime } from './rules';
import { dbSignalsSource, type SignalsSource } from './signals';
import { renderLifecycleEmail, type DigestCounts } from './templates';
import {
  TEMPLATE_CATEGORY,
  type EmailPrefs,
  type LifecycleCategory,
  type LifecycleSignals,
  type LifecycleStateRow,
  type LifecycleTemplate,
  type SentRecord,
} from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CLAIM_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
/** Cuántas veces por día como mucho se mira a una persona con el digest activo. */
const DIGEST_RECHECK_MS = 6 * HOUR;

export type LifecycleMode = 'resend' | 'console' | 'off';

let warnedOff = false;

/** De dónde salen los emails: Resend, el log (LIFECYCLE_EMAILS=console) o ninguno. */
export function lifecycleMode(env: Record<string, string | undefined> = process.env): LifecycleMode {
  const flag = env.LIFECYCLE_EMAILS?.trim().toLowerCase();
  if (flag === 'off') return 'off';
  if (env.RESEND_API_KEY) return 'resend';
  if (flag === 'console') return 'console';
  return 'off';
}

type Sender = typeof sendEmail;

export interface RunOptions {
  now?: Date;
  limit?: number;
  budgetMs?: number;
  source?: SignalsSource;
  send?: Sender;
  /** Fuerza el modo (tests). */
  mode?: LifecycleMode;
}

export interface RunResult {
  mode: LifecycleMode;
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** Fecha comparable como texto con las columnas ISO de lifecycle_state. */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Personas nuevas sin fila de estado (las de antes del motor ya la tienen,
 * como legacy). Una cuenta de más de 14 días sin fila (base restaurada,
 * import) también queda como legacy: nunca le llega una bienvenida tardía.
 */
export async function ensureStateRows(now = new Date(), limit = 500): Promise<number> {
  const cutoff = iso(now.getTime() - LIFECYCLE_LIMITS.inactiveMs).slice(0, 19);
  const norm = "REPLACE(SUBSTR(u.created_at, 1, 19), ' ', 'T')";
  const res = await getDb()
    .prepare(
      `INSERT OR IGNORE INTO lifecycle_state (user_id, legacy, created_at, next_check_at)
       SELECT u.id, CASE WHEN ${norm} < ? THEN 1 ELSE 0 END, ${norm} || 'Z', CASE WHEN ${norm} < ? THEN NULL ELSE ? END
       FROM users u WHERE NOT EXISTS (SELECT 1 FROM lifecycle_state s WHERE s.user_id = u.id) LIMIT ?`,
    )
    .run(cutoff, cutoff, now.toISOString(), limit);
  return res.changes ?? 0;
}

const lastTouch = new Map<string, number>();

/**
 * Marca actividad (layout de /app). Escribe como mucho una vez cada 15
 * minutos por persona y proceso; nunca tira.
 */
export async function touchLifecycleActivity(user: { id: string; created_at: string }, now = new Date()): Promise<void> {
  const t = now.getTime();
  const prev = lastTouch.get(user.id) ?? 0;
  if (t - prev < 15 * 60_000) return;
  lastTouch.set(user.id, t);
  if (lastTouch.size > 5000) lastTouch.clear();
  const created = parseTime(user.created_at) || t;
  const legacy = t - created >= LIFECYCLE_LIMITS.inactiveMs ? 1 : 0;
  const stamp = now.toISOString();
  try {
    await getDb()
      .prepare(
        `INSERT INTO lifecycle_state (user_id, legacy, created_at, last_active_at, next_check_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET last_active_at = excluded.last_active_at
         WHERE lifecycle_state.last_active_at IS NULL OR lifecycle_state.last_active_at < ?`,
      )
      .run(user.id, legacy, iso(created), stamp, legacy ? null : stamp, iso(t - 10 * 60_000));
  } catch {
    /* sin la tabla todavía: la actividad no puede romper la app */
  }
}

/** Después de cambiar preferencias: que el cron vuelva a mirar a la persona pronto. */
export async function recheckSoon(userId: string, now = new Date()): Promise<void> {
  await getDb()
    .prepare('UPDATE lifecycle_state SET next_check_at = ? WHERE user_id = ?')
    .run(now.toISOString(), userId)
    .catch(() => null);
}

async function history(userId: string): Promise<SentRecord[]> {
  const rows = (await getDb()
    .prepare('SELECT send_key, template, category, status, attempts, sent_at, created_at FROM lifecycle_sends WHERE user_id = ?')
    .all(userId)) as Array<{ send_key: string; template: LifecycleTemplate; category: LifecycleCategory; status: string; attempts: number; sent_at: string | null; created_at: string }>;
  // Un fallo con reintentos pendientes no cuenta como enviado (se reintenta); agotado, sí (no se insiste).
  return rows
    .filter((r) => r.status !== 'failed' || r.attempts >= MAX_ATTEMPTS)
    .filter((r) => r.status !== 'skipped' || r.category === 'digest')
    .map((r) => ({ key: r.send_key, template: r.template, category: r.category, at: r.sent_at ?? r.created_at }));
}

/** Lo que pasó en el workspace en los últimos 7 días (para el digest). */
export async function digestCounts(s: Pick<LifecycleSignals, 'workspaceOwnerId' | 'teamId'>, now = new Date()): Promise<DigestCounts> {
  const since = iso(now.getTime() - 7 * DAY).slice(0, 19);
  const after = "REPLACE(SUBSTR(created_at, 1, 19), ' ', 'T') > ?";
  const n = async (sql: string, ...args: Array<string | number | null>) => {
    try {
      const row = (await getDb().prepare(sql).get(...args)) as { n?: number } | undefined;
      return Number(row?.n ?? 0);
    } catch {
      return 0;
    }
  };
  const members = s.teamId ? 'SELECT user_id FROM team_members WHERE team_id = ?' : 'SELECT ?';
  const memberArg = s.teamId ?? s.workspaceOwnerId;
  const [docs, issues, deals, people] = await Promise.all([
    n(`SELECT COUNT(*) AS n FROM docs_pages WHERE user_id = ? AND archived = 0 AND ${after}`, s.workspaceOwnerId, since),
    n(`SELECT COUNT(*) AS n FROM track_issues WHERE creator_id IN (${members}) AND ${after}`, memberArg, since),
    n(`SELECT COUNT(*) AS n FROM crm_deals WHERE user_id = ? AND ${after}`, s.workspaceOwnerId, since),
    s.teamId ? n(`SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND user_id <> ? AND ${after}`, s.teamId, s.workspaceOwnerId, since) : Promise.resolve(0),
  ]);
  return { docs, issues, deals, members: people };
}

interface Delivery {
  userId: string;
  key: string;
  template: LifecycleTemplate;
  signals: LifecycleSignals;
  digest?: DigestCounts;
  app?: LifecycleSignals['apps'][number];
}

/** Links de baja y preferencias de una persona. */
export function lifecycleLinks(userId: string, category: LifecycleCategory, locale: string, origin = siteUrl()) {
  return {
    unsubscribeUrl: `${origin}/${locale}/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId, category))}`,
    unsubscribeAllUrl: `${origin}/${locale}/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId, 'all'))}`,
    preferencesUrl: `${origin}/${locale}/app/settings/notifications`,
    oneClickUrl: `${origin}/api/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(userId, category))}`,
  };
}

/** Reclama la fila de envío y manda. 'duplicate' si ya salió (o la tiene otra corrida). */
async function deliver(d: Delivery, send: Sender, now: Date): Promise<'sent' | 'failed' | 'duplicate'> {
  const db = getDb();
  const category = TEMPLATE_CATEGORY[d.template];
  const id = `lcs_${crypto.randomUUID()}`;
  const stamp = now.toISOString();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO lifecycle_sends (id, user_id, send_key, template, category, locale, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sending', 1, ?)`,
    )
    .run(id, d.userId, d.key, d.template, category, d.signals.locale, stamp);
  let sendId = id;
  if (inserted.changes !== 1) {
    // Ya existe: solo se retoma un fallo con reintentos pendientes (compare-and-set).
    const row = (await db.prepare('SELECT id FROM lifecycle_sends WHERE user_id = ? AND send_key = ?').get(d.userId, d.key)) as { id: string } | undefined;
    if (!row) return 'duplicate';
    const retried = await db
      .prepare("UPDATE lifecycle_sends SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'failed' AND attempts < ?")
      .run(row.id, MAX_ATTEMPTS);
    if (retried.changes !== 1) return 'duplicate';
    sendId = row.id;
  }
  const links = lifecycleLinks(d.userId, category, d.signals.locale);
  const team = d.signals.teamName;
  const email = renderLifecycleEmail({
    template: d.template,
    locale: d.signals.locale,
    email: d.signals.email,
    name: d.signals.name,
    app: d.app ?? (d.template === 'welcome' ? (d.signals.apps[0] ?? null) : null),
    tool: d.signals.sourceTool,
    team,
    digest: d.digest ?? null,
    origin: siteUrl(),
    unsubscribeUrl: links.unsubscribeUrl,
    unsubscribeAllUrl: links.unsubscribeAllUrl,
    preferencesUrl: links.preferencesUrl,
    category,
    desktopInstalled: d.signals.desktopInstalled,
  });
  const res = await send({
    to: d.signals.email,
    from: appSender(),
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: { 'List-Unsubscribe': `<${links.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    idempotencyKey: `lifecycle-${sendId}`,
  }).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : 'send_error', provider: undefined, id: undefined }));
  if (res.ok) {
    await db
      .prepare("UPDATE lifecycle_sends SET status = 'sent', sent_at = ?, provider = ?, provider_id = ?, error = NULL WHERE id = ?")
      .run(new Date().toISOString(), res.provider ?? null, res.id ?? null, sendId);
    return 'sent';
  }
  await db
    .prepare("UPDATE lifecycle_sends SET status = 'failed', error = ? WHERE id = ?")
    .run(String(res.error ?? 'send_error').slice(0, 300), sendId);
  return 'failed';
}

async function skip(userId: string, key: string, template: LifecycleTemplate, locale: string, now: Date): Promise<void> {
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO lifecycle_sends (id, user_id, send_key, template, category, locale, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'skipped', 0, ?)`,
    )
    .run(`lcs_${crypto.randomUUID()}`, userId, key, template, TEMPLATE_CATEGORY[template], locale, now.toISOString());
}

/** Procesa a una persona ya reclamada. Devuelve qué pasó y cuándo volver a mirarla. */
async function processUser(
  state: LifecycleStateRow,
  source: SignalsSource,
  send: Sender,
  now: Date,
  tally: RunResult,
): Promise<{ next: string | null; done: boolean }> {
  const signals = await source.load(state.user_id);
  if (!signals) return { next: null, done: true };
  const prefs: EmailPrefs = await getEmailPrefs(state.user_id);
  let sent = await history(state.user_id);
  const t = now.getTime();

  const outcome = (r: 'sent' | 'failed' | 'duplicate') => {
    if (r === 'sent') tally.sent += 1;
    else if (r === 'failed') tally.failed += 1;
    else tally.skipped += 1;
  };

  // Digest semanal (opcional, aparte del tope de la serie). Vacío no se manda.
  const dKey = digestKey({ signals, state, sent, prefs, now });
  if (dKey) {
    const counts = await digestCounts(signals, now);
    if (Object.values(counts).some((v) => v > 0)) outcome(await deliver({ userId: state.user_id, key: dKey, template: 'digest', signals, digest: counts }, send, now));
    else {
      await skip(state.user_id, dKey, 'digest', signals.locale, now);
      tally.skipped += 1;
    }
    sent = await history(state.user_id);
  }

  const decision = decideNext({ signals, state, sent, prefs, now });
  let next: number | null;
  let done = false;
  if (decision.action === 'send') {
    const r = await deliver({ userId: state.user_id, key: decision.key, template: decision.template, signals, app: decision.app }, send, now);
    outcome(r);
    // Un fallo se reintenta en una hora; un envío abre la próxima ventana en 2 días.
    next = r === 'failed' ? t + HOUR : t + LIFECYCLE_LIMITS.minGapMs;
  } else if (decision.action === 'wait') {
    next = Math.max(parseTime(decision.until), t + 30 * 60_000);
  } else {
    done = decision.reason !== 'inactive';
    // Terminó la serie: igual se la mira cada tanto por el reenganche. Legacy o baja total: nunca.
    next = decision.reason === 'legacy' || decision.reason === 'unsubscribed_all' ? null : t + 3 * DAY;
  }
  if (prefs.digest && !prefs.unsubscribedAll) next = Math.min(next ?? Infinity, t + DIGEST_RECHECK_MS);
  return { next: next === null || !Number.isFinite(next) ? null : iso(next), done };
}

/** Una corrida del cron. Nunca tira por una persona: sigue con la próxima. */
export async function runLifecycleEmails(opts: RunOptions = {}): Promise<RunResult> {
  const mode = opts.mode ?? lifecycleMode();
  const result: RunResult = { mode, checked: 0, sent: 0, failed: 0, skipped: 0 };
  if (mode === 'off') {
    if (!warnedOff) {
      warnedOff = true;
      // eslint-disable-next-line no-console
      console.info('[lifecycle] no email provider configured (RESEND_API_KEY): lifecycle emails are off. Set LIFECYCLE_EMAILS=console to log them instead.');
    }
    return result;
  }
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const source = opts.source ?? dbSignalsSource;
  const send = opts.send ?? sendEmail;
  const db = getDb();
  await ensureStateRows(now);
  const stamp = now.toISOString();
  const due = (await db
    .prepare(
      `SELECT * FROM lifecycle_state WHERE next_check_at IS NOT NULL AND next_check_at <= ?
       AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY next_check_at ASC LIMIT ?`,
    )
    .all(stamp, stamp, opts.limit ?? 100)) as LifecycleStateRow[];
  for (const row of due) {
    if (Date.now() - started > budget) break;
    const claimed = await db
      .prepare('UPDATE lifecycle_state SET claimed_until = ? WHERE user_id = ? AND (claimed_until IS NULL OR claimed_until < ?)')
      .run(iso(now.getTime() + CLAIM_MS), row.user_id, stamp);
    if (claimed.changes !== 1) continue;
    result.checked += 1;
    try {
      const { next, done } = await processUser(row, source, send, now, result);
      await db
        .prepare('UPDATE lifecycle_state SET next_check_at = ?, claimed_until = NULL, done_at = CASE WHEN ? = 1 THEN COALESCE(done_at, ?) ELSE done_at END WHERE user_id = ?')
        .run(next, done ? 1 : 0, stamp, row.user_id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[lifecycle] user failed', row.user_id, err instanceof Error ? err.message : err);
      await db
        .prepare('UPDATE lifecycle_state SET next_check_at = ?, claimed_until = NULL WHERE user_id = ?')
        .run(iso(now.getTime() + HOUR), row.user_id)
        .catch(() => null);
    }
  }
  if (mode === 'console' && result.checked) {
    // eslint-disable-next-line no-console
    console.info(`[lifecycle] checked=${result.checked} sent=${result.sent} failed=${result.failed} skipped=${result.skipped} (console mode)`);
  }
  return result;
}

export interface SendLogRow {
  id: string;
  email: string;
  template: LifecycleTemplate;
  category: LifecycleCategory;
  locale: string;
  status: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

/** Últimos envíos (admin). */
export async function listLifecycleSends(limit = 100): Promise<SendLogRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.id, u.email, s.template, s.category, s.locale, s.status, s.attempts, s.error, s.created_at, s.sent_at
       FROM lifecycle_sends s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .catch(() => [])) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    template: r.template as LifecycleTemplate,
    category: r.category as LifecycleCategory,
    locale: String(r.locale),
    status: String(r.status),
    attempts: Number(r.attempts),
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at),
    sentAt: (r.sent_at as string | null) ?? null,
  }));
}
