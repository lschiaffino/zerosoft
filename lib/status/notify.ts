import { appSender, sendEmail } from '@/lib/email';
import { getDb } from '@/lib/db';
import type { CheckResult } from './checks';
import { NOTIFY_COOLDOWN_MS, NOTIFY_MAX_PER_HOUR, type Notification } from './store';
import { redactSecrets } from './redact';

/**
 * Emails de alerta al dueño (ALERT_EMAIL, uno o varios separados por coma).
 *
 * Límites, guardados en la base con compare-and-set (sirven entre instancias):
 * - apertura/reapertura: una vez cada 30 min por incidente (notified_at);
 * - "empeoró": siempre (la severidad solo sube: una vez por vuelta);
 * - resuelto: solo si se avisó la apertura (así no llega un "resuelto" de algo
 *   que nadie supo que estaba roto);
 * - tope global de 20 por hora (status_meta.notify_hour/notify_count).
 * Resend además no repite un envío con la misma Idempotency-Key.
 */

function recipients(): string[] {
  return (process.env.ALERT_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

function siteUrl(): string {
  return (process.env.STATUS_SITE_URL || process.env.NEXTAUTH_URL || 'https://zerosoft.ai').replace(/\/+$/, '');
}

async function claimGlobal(now: number): Promise<boolean> {
  const hour = Math.floor(now / 3_600_000);
  const r = await getDb()
    .prepare(
      `UPDATE status_meta SET notify_count = CASE WHEN notify_hour = ? THEN notify_count + 1 ELSE 1 END, notify_hour = ?
       WHERE id = 1 AND (notify_hour <> ? OR notify_count < ?)`,
    )
    .run(hour, hour, hour, NOTIFY_MAX_PER_HOUR);
  return r.changes === 1;
}

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 120 ? `${m} min` : `${Math.round(m / 6) / 10} h`;
}

export function alertEmail(n: Notification, now: number): { subject: string; text: string } {
  const head =
    n.kind === 'resolve'
      ? `Resolved: ${n.component.label} (after ${minutes(now - n.startedAt)})`
      : n.kind === 'reopen'
        ? `Failing again: ${n.component.label} is ${n.severity}`
        : n.kind === 'worse'
          ? `Worse: ${n.component.label} is now ${n.severity}`
          : `${n.severity === 'unknown' ? 'No reports' : n.severity === 'down' ? 'Down' : 'Degraded'}: ${n.component.label}`;
  const lines = [
    head,
    '',
    `Component: ${n.component.label} (${n.component.id})`,
    `Status: ${n.severity}`,
    `Incident: ${n.incidentId}`,
    `Started: ${new Date(n.startedAt).toISOString()}`,
  ];
  if (n.error) lines.push('', 'Error:', redactSecrets(n.error));
  if (n.detail) lines.push('', `Detail: ${redactSecrets(n.detail, 300)}`);
  lines.push(
    '',
    `Open incidents (Bearer STATUS_AGENT_TOKEN): ${siteUrl()}/api/status/incidents?state=open`,
    `Public page: ${siteUrl()}/status`,
  );
  return { subject: `[zerosoft status] ${head}`, text: lines.join('\n') };
}

/** Manda (o no, por los límites) el email de una notificación. true si salió. */
export async function deliver(n: Notification, now: number): Promise<boolean> {
  const to = recipients();
  if (!to.length) return false;
  const db = getDb();
  if (n.kind === 'resolve') {
    // Solo si se avisó esta vuelta (la apertura o la última reapertura): los emails van de a pares.
    const r = (await db
      .prepare(
        "SELECT notified_at, (SELECT MAX(at) FROM status_incident_notes WHERE incident_id = ? AND kind IN ('opened', 'reopened')) AS opened_at FROM status_incidents WHERE id = ?",
      )
      .get(n.incidentId, n.incidentId)) as { notified_at?: number | null; opened_at?: number | null } | undefined;
    if (!r?.notified_at || Number(r.notified_at) < Number(r.opened_at ?? 0)) return false;
  } else {
    const claim = await db
      .prepare('UPDATE status_incidents SET notified_at = ? WHERE id = ? AND (notified_at IS NULL OR notified_at < ?)')
      // "Empeoró" (p. ej. el disco pasó de 90 % a lleno) sale siempre: la severidad solo sube, así que es una vez por vuelta.
      .run(now, n.incidentId, n.kind === 'worse' ? now + 1 : now - NOTIFY_COOLDOWN_MS);
    if (claim.changes !== 1) return false;
  }
  if (!(await claimGlobal(now))) return false;
  const { subject, text } = alertEmail(n, now);
  const minute = Math.floor(now / 60_000);
  let ok = false;
  for (const addr of to) {
    const res = await sendEmail({ to: addr, from: appSender(), subject, text, idempotencyKey: `status-${n.incidentId}-${n.kind}-${minute}-${addr}` });
    ok = ok || res.ok;
  }
  return ok;
}

/**
 * La base no responde: no hay estado ni límites guardados. Un email directo con
 * todos los chequeos, una vez por franja de 3 horas (Idempotency-Key de Resend,
 * que dura 24 h).
 */
export async function sendFallbackAlert(dbError: string, checks: Record<string, CheckResult>, now: number): Promise<void> {
  const to = recipients();
  if (!to.length) return;
  const bucket = Math.floor(now / (3 * 3_600_000));
  const lines = [
    'The status cron could not read or write its database, so incidents are not being tracked.',
    '',
    'Database error:',
    redactSecrets(dbError),
    '',
    'Checks this minute:',
    ...Object.entries(checks).map(([id, r]) => `- ${id}: ${r.status}${r.error ? ` (${redactSecrets(r.error, 300)})` : ''}`),
    '',
    'This email repeats at most every 3 hours while the database stays unavailable.',
  ];
  for (const addr of to) {
    await sendEmail({ to: addr, from: appSender(), subject: '[zerosoft status] Database unavailable: monitoring cannot store results', text: lines.join('\n'), idempotencyKey: `status-db-fallback-${bucket}-${addr}` });
  }
}
