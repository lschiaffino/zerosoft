/**
 * Robots — avisos de fallas y pausa automática. Server-only.
 *
 * Cada corrida que termina pasa por recordRobotOutcome:
 *  - éxito (de cualquier origen): vuelve a cero el contador de fallas seguidas.
 *  - falla de una corrida automática (schedule o Flow; las manuales no
 *    cuentan, quien corre a mano ya ve el error): suma una falla. Si el robot
 *    tiene schedule y llega a pause_after fallas seguidas, se apagan las
 *    corridas automáticas (enabled = 0, paused_at) y se avisa siempre por
 *    email. Si no, con failure_alerts prendido se manda un email, como mucho
 *    uno por robot cada ROBOTS_ALERT_THROTTLE_HOURS (6 por defecto).
 *
 * El email va a quien creó el robot (o al dueño del workspace), en el idioma
 * con el que se guardó el robot por última vez (alert_locale).
 */
import { getDb, type RobotRow, type RobotRunTrigger } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import en from '@/messages/en/robots.json';
import es from '@/messages/es/robots.json';
import pt from '@/messages/pt/robots.json';

type AlertStrings = typeof en.alertEmail;
type MailLocale = 'en' | 'es' | 'pt';

const STRINGS: Record<MailLocale, AlertStrings> = {
  en: en.alertEmail,
  es: { ...en.alertEmail, ...es.alertEmail },
  pt: { ...en.alertEmail, ...pt.alertEmail },
};

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

export function alertThrottleMs(): number {
  const n = Number(process.env.ROBOTS_ALERT_THROTTLE_HOURS);
  return (Number.isFinite(n) && n >= 0 ? n : 6) * 3_600_000;
}

export type OutcomeAction = 'reset' | 'none' | 'alert' | 'pause';

/**
 * Qué hacer después de una corrida (sin efectos: lo testean los unit tests).
 * `failures` es el contador ya actualizado con esta corrida.
 */
export function decideOutcome(opts: {
  status: 'success' | 'failed';
  trigger: RobotRunTrigger;
  failures: number;
  pauseAfter: number;
  hasSchedule: boolean;
  enabled: boolean;
  alertsOn: boolean;
  lastAlertAt: string | null;
  now?: number;
}): OutcomeAction {
  if (opts.status === 'success') return 'reset';
  if (opts.trigger === 'manual') return 'none';
  if (opts.enabled && opts.hasSchedule && opts.pauseAfter > 0 && opts.failures >= opts.pauseAfter) return 'pause';
  if (!opts.alertsOn) return 'none';
  const now = opts.now ?? Date.now();
  if (opts.lastAlertAt && now - Date.parse(opts.lastAlertAt) < alertThrottleMs()) return 'none';
  return 'alert';
}

/** Errores que no son fallas del robot (lo apagó alguien): no cuentan. */
const NOT_A_FAILURE = new Set(['disabled']);

/**
 * Registra el resultado de una corrida terminada: contador de fallas, pausa y
 * email. Nunca tira (la corrida ya quedó guardada).
 */
export async function recordRobotOutcome(
  workspaceId: string,
  robotId: string,
  run: { id: string; trigger: RobotRunTrigger; status: 'success' | 'failed'; error: string | null },
): Promise<OutcomeAction> {
  try {
    const db = getDb();
    if (run.status === 'success') {
      await db
        .prepare('UPDATE robots SET consecutive_failures = 0 WHERE id = ? AND user_id = ? AND consecutive_failures <> 0')
        .run(robotId, workspaceId);
      return 'reset';
    }
    if (run.trigger === 'manual' || NOT_A_FAILURE.has(run.error ?? '')) return 'none';
    await db
      .prepare('UPDATE robots SET consecutive_failures = consecutive_failures + 1 WHERE id = ? AND user_id = ?')
      .run(robotId, workspaceId);
    const row = (await db.prepare('SELECT * FROM robots WHERE id = ? AND user_id = ?').get(robotId, workspaceId)) as RobotRow | undefined;
    if (!row) return 'none';
    const action = decideOutcome({
      status: 'failed',
      trigger: run.trigger,
      failures: Number(row.consecutive_failures) || 0,
      pauseAfter: Number(row.pause_after) || 0,
      hasSchedule: !!row.schedule,
      enabled: row.enabled === 1,
      alertsOn: row.failure_alerts === 1,
      lastAlertAt: row.last_alert_at,
    });
    const ts = new Date().toISOString();
    if (action === 'pause') {
      // Compare-and-set: dos corridas que fallan juntas pausan (y avisan) una vez.
      const res = await db
        .prepare('UPDATE robots SET enabled = 0, next_run_at = NULL, paused_at = ?, last_alert_at = ? WHERE id = ? AND enabled = 1')
        .run(ts, ts, robotId);
      if (res.changes !== 1) return 'none';
      await sendRobotAlert(row, run, 'paused');
      return 'pause';
    }
    if (action === 'alert') {
      const cutoff = new Date(Date.now() - alertThrottleMs()).toISOString();
      const res = await db
        .prepare('UPDATE robots SET last_alert_at = ? WHERE id = ? AND (last_alert_at IS NULL OR last_alert_at < ?)')
        .run(ts, robotId, cutoff);
      if (res.changes !== 1) return 'none';
      await sendRobotAlert(row, run, 'failed');
      return 'alert';
    }
    return action;
  } catch {
    return 'none';
  }
}

async function recipient(row: RobotRow): Promise<string | null> {
  const db = getDb();
  for (const id of [row.created_by, row.user_id]) {
    if (!id) continue;
    const u = (await db.prepare('SELECT email FROM users WHERE id = ?').get(id)) as { email: string } | undefined;
    if (u?.email) return u.email;
  }
  return null;
}

export function robotRunUrl(locale: string, robotId: string): string {
  return `${siteUrl()}/${locale}/app/robots/${robotId}?tab=runs`;
}

async function sendRobotAlert(
  row: RobotRow,
  run: { id: string; trigger: RobotRunTrigger; error: string | null },
  kind: 'failed' | 'paused',
): Promise<void> {
  const to = await recipient(row);
  if (!to) return;
  const locale: MailLocale = row.alert_locale === 'es' || row.alert_locale === 'pt' ? row.alert_locale : 'en';
  const s = STRINGS[locale];
  const vars = {
    robot: row.name,
    error: (run.error ?? 'failed').slice(0, 300),
    trigger: s.triggers[run.trigger as keyof typeof s.triggers] ?? run.trigger,
    count: String(Number(row.consecutive_failures) || 1),
    hours: String(Math.round(alertThrottleMs() / 3_600_000)),
  };
  const url = robotRunUrl(locale, row.id);
  const subject = fill(kind === 'paused' ? s.pausedSubject : s.failedSubject, vars);
  const lines = kind === 'paused' ? [fill(s.pausedBody, vars), fill(s.lastError, vars), s.pausedHow] : [fill(s.failedBody, vars), fill(s.streak, vars), fill(s.throttle, vars)];
  await sendEmail({
    to,
    subject,
    text: [...lines, '', `${s.cta}: ${url}`].join('\n'),
    html: renderBrandedHtml({
      heading: kind === 'paused' ? s.pausedHeading : s.failedHeading,
      eyebrow: 'zerosoft · robots',
      paragraphs: [...lines.map(escapeHtml), `<a href="${escapeHtml(url)}">${escapeHtml(s.cta)}</a>`],
    }),
  }).catch(() => undefined);
}
