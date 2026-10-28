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
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import type { RobotOutputChange } from './robots-diff';
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

// ---------- Email de cambios ----------

type ChangeStrings = typeof en.changeEmail;
const CHANGE_STRINGS: Record<MailLocale, ChangeStrings> = {
  en: en.changeEmail,
  es: { ...en.changeEmail, ...es.changeEmail },
  pt: { ...en.changeEmail, ...pt.changeEmail },
};

/** Emails de cambios por robot y día (ROBOTS_CHANGE_EMAILS_PER_DAY, 24). */
export function changeEmailsPerDay(): number {
  const n = Number(process.env.ROBOTS_CHANGE_EMAILS_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 24;
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Una fila como "col: valor · col: valor" (recortada). */
function rowLine(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>)
      .slice(0, 6)
      .map(([k, x]) => `${k}: ${cellText(x).slice(0, 80)}`)
      .join(' · ')
      .slice(0, 400);
  }
  return cellText(v).slice(0, 400);
}

/**
 * Texto y HTML del email de cambios: filas nuevas (verde), filas que ya no
 * están (rojo) y valores que cambiaron (antes → después). Puro: lo testean
 * los unit tests.
 */
export function renderChangeEmail(
  locale: MailLocale,
  robotName: string,
  changes: readonly RobotOutputChange[],
  url: string,
): { subject: string; text: string; html: string } {
  const s = CHANGE_STRINGS[locale];
  const intro = fill(s.body, { robot: robotName });
  const text: string[] = [intro];
  const html: string[] = [escapeHtml(intro)];
  const line = (color: string, sign: string, body: string) =>
    `<span style="display:block;padding:2px 6px;margin:2px 0;background:${color};">${sign} ${escapeHtml(body)}</span>`;
  for (const c of changes.slice(0, 20)) {
    if (c.kind === 'rows') {
      const summary = fill(s.rows, { added: String(c.addedCount), removed: String(c.removedCount) });
      text.push(`${c.key}: ${summary}`);
      const parts = [`<strong>${escapeHtml(c.key)}</strong> · ${escapeHtml(summary)}`];
      for (const r of c.added.slice(0, 10)) {
        text.push(`  + ${rowLine(r)}`);
        parts.push(line('#e7f6ec', '+', rowLine(r)));
      }
      for (const r of c.removed.slice(0, 10)) {
        text.push(`  - ${rowLine(r)}`);
        parts.push(line('#fdecec', '−', rowLine(r)));
      }
      if (c.added.length > 10 || c.removed.length > 10 || c.addedCount > c.added.length || c.removedCount > c.removed.length) {
        parts.push(escapeHtml(s.more));
      }
      html.push(parts.join(''));
    } else if (c.kind === 'changed') {
      text.push(`${c.key}: ${rowLine(c.before)} → ${rowLine(c.after)}`);
      html.push(`<strong>${escapeHtml(c.key)}</strong>${line('#fdecec', '−', rowLine(c.before))}${line('#e7f6ec', '+', rowLine(c.after))}`);
    } else if (c.kind === 'added') {
      text.push(`${c.key}: + ${rowLine(c.after)}`);
      html.push(`<strong>${escapeHtml(c.key)}</strong>${line('#e7f6ec', '+', rowLine(c.after))}`);
    } else {
      text.push(`${c.key}: - ${rowLine(c.before)}`);
      html.push(`<strong>${escapeHtml(c.key)}</strong>${line('#fdecec', '−', rowLine(c.before))}`);
    }
  }
  text.push('', `${s.cta}: ${url}`, '', s.footer);
  html.push(`<a href="${escapeHtml(url)}">${escapeHtml(s.cta)}</a>`, escapeHtml(s.footer));
  return {
    subject: fill(s.subject, { robot: robotName }),
    text: text.join('\n'),
    html: renderBrandedHtml({ heading: s.heading, eyebrow: 'zerosoft · robots', paragraphs: html }),
  };
}

/** Emails (lowercase) de las personas del workspace: dueño y miembros del equipo. */
async function workspaceMemberEmails(workspaceId: string): Promise<Set<string>> {
  const rows = (await getDb()
    .prepare(
      `SELECT lower(u.email) AS email FROM users u
       WHERE u.id = ?
          OR u.id IN (SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ?)`,
    )
    .all(workspaceId, workspaceId)) as Array<{ email: string | null }>;
  return new Set(rows.map((r) => r.email).filter((e): e is string => !!e));
}

/**
 * Manda el email de cambios, SOLO a personas del workspace (los destinatarios
 * elegidos que no son del workspace se descartan; sin ninguno, a quien creó el
 * robot). Tope diario por robot y por workspace. Remitente de la app
 * (appSender). Devuelve a cuántos salió. Nunca tira.
 */
export async function sendChangeEmail(row: RobotRow, changes: readonly RobotOutputChange[], to: readonly string[]): Promise<number> {
  try {
    if (!changes.length) return 0;
    let recipients: string[];
    if (to.length) {
      const members = await workspaceMemberEmails(row.user_id);
      recipients = [...new Set(to.map((a) => a.trim()).filter((a) => members.has(a.toLowerCase())))];
    } else {
      const own = await recipient(row);
      recipients = own ? [own] : [];
    }
    if (!recipients.length) return 0;
    if (process.env.RATE_LIMIT_DISABLED !== 'true') {
      const { rateLimit } = await import('./rate-limit');
      const perRobot = await rateLimit(`robot-change-email:${row.id}`, changeEmailsPerDay(), 86_400);
      if (!perRobot.ok) return 0;
      // Tope por workspace: un workspace con muchos robots no inunda casillas.
      const perWs = await rateLimit(`robot-change-email-ws:${row.user_id}`, changeEmailsPerDay() * 10, 86_400);
      if (!perWs.ok) return 0;
    }
    const locale: MailLocale = row.alert_locale === 'es' || row.alert_locale === 'pt' ? row.alert_locale : 'en';
    const mail = renderChangeEmail(locale, row.name, changes, `${siteUrl()}/${locale}/app/robots/${row.id}?tab=data`);
    let sent = 0;
    for (const addr of recipients.slice(0, 10)) {
      const ok = await sendEmail({ to: addr, from: appSender(), subject: mail.subject, text: mail.text, html: mail.html })
        .then(() => true)
        .catch(() => false);
      if (ok) sent += 1;
    }
    return sent;
  } catch {
    return 0;
  }
}
