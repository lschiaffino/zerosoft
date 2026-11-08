/**
 * Suscripciones de tableros de Analytics: un resumen por email (a personas
 * del workspace) o a un canal de Talk, diario o semanal a la hora elegida.
 * Corre en /api/cron/tick con claim por fila (compare-and-set), y cada envío
 * calcula los resultados con los permisos de quien creó la suscripción.
 */
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getDb } from '../db';
import { personAppAccess } from '../api-auth';
import { appSender, escapeHtml, sendEmail } from '../email';
import { isValidTimezone } from '../cron';
import { canEditItem, isBiAdmin, viewerCan, type BiViewer } from './access';
import { runQuery } from './run';
import { dashboardById, getDashboard, questionById, BiStoreError } from './store';
import { pickViz, formatValue } from './viz';

export const subscriptionInputSchema = z.object({
  channel: z.enum(['email', 'talk']),
  /** email: direcciones separadas por coma; talk: nombre o id del canal. */
  target: z.string().trim().min(1).max(1000),
  cadence: z.enum(['daily', 'weekly']).default('weekly'),
  hour: z.number().int().min(0).max(23).default(9),
  weekday: z.number().int().min(0).max(6).default(1),
  timezone: z.string().max(64).default('UTC'),
});
export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;

export interface SubscriptionDto extends SubscriptionInput {
  id: string;
  dashboardId: string;
  nextRunAt: string;
  lastSentAt: string | null;
  lastError: string | null;
  createdBy: string;
  canEdit: boolean;
}

/** Hora local (h, wd) en tz → próximo instante UTC después de `after`. */
export function nextRun(input: Pick<SubscriptionInput, 'cadence' | 'hour' | 'weekday' | 'timezone'>, after: Date): Date {
  const tz = isValidTimezone(input.timezone) ? input.timezone : 'UTC';
  // Se prueba hora por hora (como mucho 8 días): simple y correcto con cambios de horario.
  const start = new Date(Math.floor(after.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < 24 * 8; i++) {
    const t = new Date(start.getTime() + i * 3_600_000);
    const parts = fmt.formatToParts(t);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const wd = days.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
    if (hour === input.hour && (input.cadence === 'daily' || wd === input.weekday)) return t;
  }
  return new Date(after.getTime() + 86_400_000);
}

type Row = {
  id: string;
  workspace_id: string;
  dashboard_id: string;
  channel: 'email' | 'talk';
  target: string;
  cadence: 'daily' | 'weekly';
  hour: number;
  weekday: number;
  timezone: string;
  next_run_at: string;
  last_sent_at: string | null;
  last_error: string | null;
  created_by: string;
};

function dto(r: Row, viewer: BiViewer): SubscriptionDto {
  return {
    id: r.id,
    dashboardId: r.dashboard_id,
    channel: r.channel,
    target: r.target,
    cadence: r.cadence,
    hour: Number(r.hour),
    weekday: Number(r.weekday),
    timezone: r.timezone,
    nextRunAt: r.next_run_at,
    lastSentAt: r.last_sent_at,
    lastError: r.last_error,
    createdBy: r.created_by,
    canEdit: canEditItem(viewer, r.created_by),
  };
}

/** Emails de personas del workspace (los únicos destinatarios aceptados). */
async function workspaceEmails(workspaceId: string): Promise<Set<string>> {
  const rows = (await getDb()
    .prepare(
      `SELECT lower(u.email) AS email FROM users u WHERE u.id = ?
       UNION SELECT lower(u.email) FROM team_members m JOIN teams t ON t.id = m.team_id JOIN users u ON u.id = m.user_id
       WHERE t.owner_id = ? AND m.role != 'guest'`,
    )
    .all(workspaceId, workspaceId)) as Array<{ email: string | null }>;
  return new Set(rows.map((r) => r.email ?? '').filter(Boolean));
}

async function normalizeTarget(viewer: BiViewer, input: SubscriptionInput): Promise<string> {
  if (input.channel === 'talk') {
    if (!viewerCan(viewer, 'talk')) throw new BiStoreError('talk_not_available', 403);
    const { findChannel } = await import('../talk-bot');
    const ch = await findChannel(viewer.workspaceId, input.target.replace(/^#/, ''));
    if (!ch) throw new BiStoreError('channel_not_found', 404);
    return ch.id;
  }
  const list = [...new Set(input.target.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!list.length || list.length > 10) throw new BiStoreError('invalid_recipients');
  const members = await workspaceEmails(viewer.workspaceId);
  const outside = list.filter((e) => !members.has(e));
  if (outside.length) throw new BiStoreError('recipient_not_member');
  return list.join(', ');
}

export async function listSubscriptions(viewer: BiViewer, dashboardId: string): Promise<SubscriptionDto[]> {
  if (!(await getDashboard(viewer, dashboardId))) throw new BiStoreError('not_found', 404);
  const rows = (await getDb()
    .prepare('SELECT * FROM bi_subscriptions WHERE workspace_id = ? AND dashboard_id = ? ORDER BY created_at')
    .all(viewer.workspaceId, dashboardId)) as Row[];
  return rows.map((r) => dto(r, viewer));
}

export async function createSubscription(viewer: BiViewer, dashboardId: string, raw: unknown): Promise<SubscriptionDto> {
  if (!(await getDashboard(viewer, dashboardId))) throw new BiStoreError('not_found', 404);
  const input = subscriptionInputSchema.parse(raw);
  if (!isValidTimezone(input.timezone)) throw new BiStoreError('invalid_timezone');
  const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM bi_subscriptions WHERE dashboard_id = ?').get(dashboardId)) as { n: number };
  if (Number(n.n) >= 10) throw new BiStoreError('too_many_subscriptions');
  const target = await normalizeTarget(viewer, input);
  const id = `bisub_${nanoid(12)}`;
  const t = new Date();
  await getDb()
    .prepare(
      `INSERT INTO bi_subscriptions (id, workspace_id, dashboard_id, channel, target, cadence, hour, weekday, timezone, next_run_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, viewer.workspaceId, dashboardId, input.channel, target, input.cadence, input.hour, input.weekday, input.timezone, nextRun(input, t).toISOString(), viewer.personId, t.toISOString());
  const row = (await getDb().prepare('SELECT * FROM bi_subscriptions WHERE id = ?').get(id)) as Row;
  return dto(row, viewer);
}

export async function deleteSubscription(viewer: BiViewer, id: string): Promise<void> {
  const r = (await getDb().prepare('SELECT * FROM bi_subscriptions WHERE id = ? AND workspace_id = ?').get(id, viewer.workspaceId)) as Row | undefined;
  if (!r) throw new BiStoreError('not_found', 404);
  if (!canEditItem(viewer, r.created_by) && !isBiAdmin(viewer)) throw new BiStoreError('forbidden', 403);
  await getDb().prepare('DELETE FROM bi_subscriptions WHERE id = ?').run(id);
}

/** Resumen de un tablero: por tarjeta, el número o las primeras filas. */
export async function buildDigest(viewer: BiViewer, dashboardId: string, baseUrl: string): Promise<{ subject: string; text: string; html: string } | null> {
  const d = await dashboardById(viewer.workspaceId, dashboardId);
  if (!d) return null;
  const textParts: string[] = [d.name, ''];
  const htmlParts: string[] = [`<h2 style="font:600 18px system-ui;margin:0 0 12px">${escapeHtml(d.name)}</h2>`];
  for (const c of d.cards.slice(0, 12)) {
    if (c.kind === 'text') {
      if (c.text.trim()) {
        textParts.push(c.text, '');
        htmlParts.push(`<p style="font:14px system-ui;color:#444">${escapeHtml(c.text)}</p>`);
      }
      continue;
    }
    const q = c.questionId ? await questionById(viewer.workspaceId, c.questionId) : null;
    if (!q) continue;
    try {
      const values: Record<string, string> = {};
      for (const f of d.filters) if (f.default && c.mapping[f.id]?.param) values[c.mapping[f.id].param!] = f.default;
      const res = await runQuery(viewer, q.source, q.query, { values, fresh: true });
      const viz = pickViz(res.columns, res.rows.length, q.viz);
      if (viz.type === 'number' && res.rows[0]) {
        const v = formatValue(res.rows[0][viz.ys[0]]);
        textParts.push(`${q.name}: ${v}`, '');
        htmlParts.push(`<p style="font:14px system-ui;margin:16px 0 4px;color:#555">${escapeHtml(q.name)}</p><p style="font:600 28px system-ui;margin:0">${escapeHtml(v)}</p>`);
      } else {
        const rows = res.rows.slice(0, 10);
        textParts.push(q.name, ...rows.map((r) => r.map((v, i) => formatValue(v, 'en', res.columns[i]?.type)).join(' · ')), '');
        htmlParts.push(
          `<p style="font:600 14px system-ui;margin:20px 0 6px">${escapeHtml(q.name)}</p><table style="border-collapse:collapse;font:13px system-ui">` +
            `<tr>${res.columns.map((col) => `<th style="text-align:left;border-bottom:1px solid #ddd;padding:4px 8px">${escapeHtml(col.name)}</th>`).join('')}</tr>` +
            rows.map((r) => `<tr>${r.map((v, i) => `<td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${escapeHtml(formatValue(v, 'en', res.columns[i]?.type))}</td>`).join('')}</tr>`).join('') +
            '</table>' +
            (res.rows.length > 10 ? `<p style="font:12px system-ui;color:#777">+${res.rows.length - 10}</p>` : ''),
        );
      }
    } catch {
      textParts.push(`${q.name}: —`, '');
      htmlParts.push(`<p style="font:14px system-ui;color:#999">${escapeHtml(q.name)}: —</p>`);
    }
  }
  const link = `${baseUrl}/app/analytics/dashboards/${d.id}`;
  textParts.push(link);
  htmlParts.push(`<p style="margin-top:24px"><a href="${escapeHtml(link)}" style="font:14px system-ui">${escapeHtml(link)}</a></p>`);
  return { subject: d.name, text: textParts.join('\n'), html: `<div style="max-width:640px">${htmlParts.join('')}</div>` };
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://zerosoft.ai').replace(/\/$/, '');
}

async function deliver(r: Row): Promise<string | null> {
  const access = await personAppAccess(r.workspace_id, r.created_by);
  if (!access) return 'creator_left';
  const viewer: BiViewer = { workspaceId: r.workspace_id, personId: r.created_by, role: access.role, apps: access.apps };
  if (!viewerCan(viewer, 'analytics')) return 'creator_no_access';
  const digest = await buildDigest(viewer, r.dashboard_id, baseUrl());
  if (!digest) return 'dashboard_missing';
  if (r.channel === 'talk') {
    const { postAsBot } = await import('../talk-bot');
    await postAsBot(r.workspace_id, { channel: r.target, body: digest.text.slice(0, 8000), botName: 'Analytics', memberId: r.created_by });
    return null;
  }
  const members = await workspaceEmails(r.workspace_id);
  for (const to of r.target.split(/,\s*/).filter((e) => members.has(e))) {
    const res = await sendEmail({ to, from: appSender(), subject: digest.subject, text: digest.text, html: digest.html, idempotencyKey: `bisub-${r.id}-${r.next_run_at}-${to}` });
    if (!res.ok) return res.error ?? 'email_failed';
  }
  return null;
}

/** Cron: manda las suscripciones vencidas (claim por fila para no mandar dos veces). */
export async function runBiSubscriptions(opts: { budgetMs?: number; now?: Date } = {}): Promise<{ sent: number; failed: number }> {
  const started = Date.now();
  const nowD = opts.now ?? new Date();
  const nowIso = nowD.toISOString();
  const due = (await getDb()
    .prepare('SELECT * FROM bi_subscriptions WHERE next_run_at <= ? AND (claimed_until IS NULL OR claimed_until < ?) ORDER BY next_run_at LIMIT 50')
    .all(nowIso, nowIso)) as Row[];
  let sent = 0;
  let failed = 0;
  for (const r of due) {
    if (Date.now() - started > (opts.budgetMs ?? 8000)) break;
    const claim = await getDb()
      .prepare('UPDATE bi_subscriptions SET claimed_until = ? WHERE id = ? AND next_run_at = ? AND (claimed_until IS NULL OR claimed_until < ?)')
      .run(new Date(nowD.getTime() + 10 * 60_000).toISOString(), r.id, r.next_run_at, nowIso);
    if (!claim.changes) continue;
    let error: string | null;
    try {
      error = await deliver(r);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : 'failed';
    }
    if (error) failed++;
    else sent++;
    const next = nextRun({ cadence: r.cadence, hour: Number(r.hour), weekday: Number(r.weekday), timezone: r.timezone }, nowD).toISOString();
    await getDb()
      .prepare('UPDATE bi_subscriptions SET next_run_at = ?, claimed_until = NULL, last_sent_at = ?, last_error = ? WHERE id = ?')
      .run(next, error ? r.last_sent_at : nowIso, error, r.id);
  }
  return { sent, failed };
}
