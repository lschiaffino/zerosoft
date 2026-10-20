/**
 * Agents — alertas por email al dueño del workspace cuando en la última hora
 * suben los pulgares abajo, los errores de herramientas o las corridas que
 * llegan al tope de pasos. Corre una vez por hora desde /api/cron/tick.
 *
 * Pico = la última hora llega a un mínimo absoluto (ALERT_MIN) y es al menos
 * ALERT_FACTOR veces el promedio por hora de los 7 días anteriores. Sin el
 * playground (son pruebas del equipo). Throttle: como mucho un email por
 * agente cada ALERT_THROTTLE_MS; el envío se reclama con un compare-and-set
 * sobre agent_alert_state.last_sent_at (dos crons a la vez no mandan dos) y
 * se libera si el email falla. Se apaga por agente (agents.alerts_enabled).
 */
import { getDb, getUserById } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import en from '@/messages/en/agents.json';
import es from '@/messages/es/agents.json';
import pt from '@/messages/pt/agents.json';

export const ALERT_KINDS = ['thumbs_down', 'tool_errors', 'step_limits'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export type AlertCounts = Record<AlertKind, number>;

/** Mínimo de eventos en la hora para que cuente como pico. */
export const ALERT_MIN: AlertCounts = { thumbs_down: 3, tool_errors: 5, step_limits: 3 };
/** Veces el promedio por hora de la semana anterior. */
export const ALERT_FACTOR = 3;
export const ALERT_WINDOW_MS = 3_600_000;
export const ALERT_BASELINE_MS = 7 * 86_400_000;
export const ALERT_THROTTLE_MS = 6 * 3_600_000;

type AlertStrings = typeof en.alertEmail;
const STRINGS: Record<string, AlertStrings> = {
  en: en.alertEmail,
  es: { ...en.alertEmail, ...es.alertEmail },
  pt: { ...en.alertEmail, ...pt.alertEmail },
};

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** Tipos con pico: la hora actual contra el promedio por hora de la semana anterior. */
export function detectSpikes(current: AlertCounts, baselineWeek: AlertCounts): AlertKind[] {
  const hours = ALERT_BASELINE_MS / ALERT_WINDOW_MS;
  return ALERT_KINDS.filter((k) => {
    const n = current[k];
    if (n < ALERT_MIN[k]) return false;
    return n >= ALERT_FACTOR * (baselineWeek[k] / hours);
  });
}

/** Eventos de cada tipo en [from, to) para un agente (sin el playground). */
export async function alertCounts(agentId: string, from: string, to: string): Promise<AlertCounts> {
  const db = getDb();
  const one = async (sql: string) => Number(((await db.prepare(sql).get(agentId, from, to)) as { n: number } | undefined)?.n ?? 0);
  const [thumbsDown, toolErrors, stepLimits] = await Promise.all([
    one(
      `SELECT COUNT(*) AS n FROM agent_feedback f JOIN agent_conversations c ON c.id = f.conversation_id
       WHERE f.agent_id = ? AND f.rating = -1 AND c.channel != 'playground' AND f.created_at >= ? AND f.created_at < ?`,
    ),
    one(
      `SELECT COUNT(*) AS n FROM agent_tool_calls t JOIN agent_conversations c ON c.id = t.conversation_id
       WHERE t.agent_id = ? AND t.error IS NOT NULL AND c.channel != 'playground' AND t.created_at >= ? AND t.created_at < ?`,
    ),
    one(
      `SELECT COUNT(*) AS n FROM agent_runs
       WHERE agent_id = ? AND status = 'step_limit' AND channel != 'playground' AND created_at >= ? AND created_at < ?`,
    ),
  ]);
  return { thumbs_down: thumbsDown, tool_errors: toolErrors, step_limits: stepLimits };
}

export function buildAlertEmail(
  agent: { id: string; name: string },
  kinds: AlertKind[],
  current: AlertCounts,
  locale: string,
  base = siteUrl(),
): { subject: string; text: string; html: string; link: string } {
  const s = STRINGS[locale] ?? STRINGS.en;
  const loc = STRINGS[locale] ? locale : 'en';
  const link = `${base}/${loc}/app/agents/${agent.id}?tab=analytics`;
  const vars = { agent: agent.name };
  const lines = kinds.map((k) => fill(s[k], { count: String(current[k]) }));
  const subject = fill(s.subject, vars);
  const text = [fill(s.intro, vars), '', ...lines.map((l) => `- ${l}`), '', `${s.cta}: ${link}`, '', s.why].join('\n');
  const html = renderBrandedHtml({
    heading: fill(s.heading, vars),
    eyebrow: agent.name,
    paragraphs: [
      escapeHtml(fill(s.intro, vars)),
      lines.map((l) => escapeHtml(l)).join('<br>'),
      `<a href="${escapeHtml(link)}">${escapeHtml(s.cta)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(s.why)}</span>`,
    ],
  });
  return { subject, text, html, link };
}

/** Idioma del email: el de la última vez que el equipo abrió la Analítica o tocó el switch. */
export async function rememberAlertLocale(agentId: string, locale: string): Promise<void> {
  if (!STRINGS[locale]) return;
  await getDb()
    .prepare(
      `INSERT INTO agent_alert_state (agent_id, locale) VALUES (?, ?)
       ON CONFLICT (agent_id) DO UPDATE SET locale = excluded.locale`,
    )
    .run(agentId, locale);
}

export async function setAgentAlertsEnabled(workspaceId: string, agentId: string, enabled: boolean): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE agents SET alerts_enabled = ? WHERE id = ? AND user_id = ?')
    .run(enabled ? 1 : 0, agentId, workspaceId);
  return res.changes > 0;
}

export interface AlertRunResult {
  checked: number;
  sent: number;
  failed: number;
}

/**
 * Revisa los agentes con eventos en la última hora y avisa al dueño si hay
 * pico. `limit` acota los agentes revisados por corrida.
 */
export async function checkAgentAlerts(opts: { now?: Date; limit?: number } = {}): Promise<AlertRunResult> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const to = now.toISOString();
  const from = new Date(now.getTime() - ALERT_WINDOW_MS).toISOString();
  const baseFrom = new Date(now.getTime() - ALERT_WINDOW_MS - ALERT_BASELINE_MS).toISOString();
  const cutoff = new Date(now.getTime() - ALERT_THROTTLE_MS).toISOString();

  // Solo agentes con algo malo en la hora: el resto no puede tener pico.
  const agents = (await db
    .prepare(
      `SELECT a.id, a.name, a.user_id FROM agents a
       WHERE a.alerts_enabled = 1 AND a.id IN (
         SELECT agent_id FROM agent_feedback WHERE rating = -1 AND created_at >= ? AND created_at < ?
         UNION SELECT agent_id FROM agent_tool_calls WHERE error IS NOT NULL AND created_at >= ? AND created_at < ?
         UNION SELECT agent_id FROM agent_runs WHERE status = 'step_limit' AND created_at >= ? AND created_at < ?
       )
       LIMIT ?`,
    )
    .all(from, to, from, to, from, to, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as Array<{
    id: string;
    name: string;
    user_id: string;
  }>;

  let sent = 0;
  let failed = 0;
  for (const agent of agents) {
    const current = await alertCounts(agent.id, from, to);
    const kinds = detectSpikes(current, await alertCounts(agent.id, baseFrom, from));
    if (kinds.length === 0) continue;
    const owner = await getUserById(agent.user_id);
    if (!owner?.email) continue;

    await db.prepare('INSERT OR IGNORE INTO agent_alert_state (agent_id) VALUES (?)').run(agent.id);
    const prev = (await db.prepare('SELECT last_sent_at, locale FROM agent_alert_state WHERE agent_id = ?').get(agent.id)) as
      | { last_sent_at: string | null; locale: string }
      | undefined;
    const claim = await db
      .prepare(
        `UPDATE agent_alert_state SET last_sent_at = ?, last_kinds = ?
         WHERE agent_id = ? AND (last_sent_at IS NULL OR last_sent_at < ?)`,
      )
      .run(to, JSON.stringify(kinds), agent.id, cutoff);
    if (claim.changes === 0) continue;

    const email = buildAlertEmail(agent, kinds, current, prev?.locale ?? 'en');
    const res = await sendEmail({ to: owner.email, subject: email.subject, text: email.text, html: email.html }).catch(() => ({
      ok: false,
    }));
    if (res.ok) {
      sent++;
    } else {
      failed++;
      await db
        .prepare('UPDATE agent_alert_state SET last_sent_at = ? WHERE agent_id = ? AND last_sent_at = ?')
        .run(prev?.last_sent_at ?? null, agent.id, to);
    }
  }
  return { checked: agents.length, sent, failed };
}
