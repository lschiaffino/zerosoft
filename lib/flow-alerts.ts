/**
 * Flow — qué pasa cuando una corrida falla:
 *  - Aviso por email al dueño del flow (created_by; si no, el dueño del
 *    workspace). Como mucho uno por flow y hora: failure_email_at se toma con
 *    un compare-and-set, así dos fallas simultáneas no mandan dos emails.
 *  - Replay: vuelve a correr una corrida fallida. Desde el paso que falló
 *    (rerunFromStep: lo anterior reusa su salida, no repite emails ni
 *    registros) o, si no se puede, completa con el mismo input.
 *  - Replay automático (opcional por flow): una vez, AUTO_REPLAY_DELAY_MS
 *    después de la falla; lo dispara el worker (processDueReplays).
 * Server-only.
 */
import { siteUrl } from './board-urls';
import { getDb, type FlowFlowRow, type FlowRunRow } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { enqueueRun, getFlowSettings, parseJson } from './flow';
import { executeRun, rerunFromStep } from './flow-engine';
import en from '@/messages/en/flow.json';
import es from '@/messages/es/flow.json';
import pt from '@/messages/pt/flow.json';

type EmailStrings = typeof en.failureEmail;

const STRINGS: Record<string, EmailStrings> = {
  en: en.failureEmail,
  es: { ...en.failureEmail, ...es.failureEmail },
  pt: { ...en.failureEmail, ...pt.failureEmail },
};

/** Un aviso por flow como mucho cada esto. */
export const FAILURE_EMAIL_INTERVAL_MS = 60 * 60_000;
/** Cuánto después de la falla corre el replay automático. */
export const AUTO_REPLAY_DELAY_MS = 15 * 60_000;

/** Disparadores automáticos: las pruebas manuales y los sub-flows no avisan ni se reintentan solos. */
const ALERT_TRIGGERS = new Set(['trigger.event', 'trigger.webhook', 'trigger.stripe', 'trigger.schedule', 'error']);
const REPLAY_TRIGGERS = new Set(['trigger.event', 'trigger.webhook', 'trigger.stripe', 'trigger.schedule']);
/** Fallas que no se arreglan solas repitiendo: el replay automático no las toma. */
const NO_AUTO_REPLAY = new Set(['cancelled', 'flow_disabled', 'flow_missing', 'no_trigger', 'input_too_large', 'step_limit']);

type FlowInfo = Pick<FlowFlowRow, 'id' | 'name' | 'user_id' | 'created_by' | 'failure_alerts' | 'auto_replay'>;
type RunInfo = Pick<FlowRunRow, 'id' | 'trigger_type' | 'rerun_of' | 'created_at'>;

/** Código del error sin el prefijo del nodo ('send: http_500' → 'http_500'). */
function errorCode(error: string | null): string {
  return (error ?? '').replace(/^[A-Za-z0-9_-]+: /, '').trim();
}

/**
 * Agenda el replay automático de una corrida que acaba de fallar si el flow
 * lo tiene prendido. Solo la corrida original (un replay que vuelve a fallar
 * no se reintenta otra vez). Devuelve cuándo corre, o null.
 */
export async function scheduleAutoReplay(flow: FlowInfo, run: RunInfo, error: string | null, now = new Date()): Promise<string | null> {
  if (flow.auto_replay !== 1 || run.rerun_of || !REPLAY_TRIGGERS.has(run.trigger_type)) return null;
  if (NO_AUTO_REPLAY.has(errorCode(error))) return null;
  const at = new Date(now.getTime() + AUTO_REPLAY_DELAY_MS).toISOString();
  await getDb().prepare("UPDATE flow_runs SET replay_at = ? WHERE id = ? AND status = 'failed'").run(at, run.id);
  return at;
}

export interface FailureEmailInput {
  locale: string;
  flowName: string;
  error: string | null;
  failedNode: string | null;
  runUrl: string;
  failedAt: string;
  replayAt: string | null;
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** Hora para el email (UTC, legible sin depender del idioma del servidor). */
function utcTime(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

/** Asunto, texto y HTML del aviso de falla. */
export function buildFailureEmail(input: FailureEmailInput): { subject: string; text: string; html: string } {
  const s = STRINGS[input.locale] ?? STRINGS.en;
  const vars = { flow: input.flowName, time: utcTime(input.failedAt) };
  const subject = fill(s.subject, vars);
  const replayLine = input.replayAt ? fill(s.replayScheduled, { time: utcTime(input.replayAt) }) : s.replayOffer;
  const details = [
    `${s.error}: ${errorCode(input.error) || '-'}`,
    ...(input.failedNode ? [`${s.step}: ${input.failedNode}`] : []),
  ];
  const text = [
    fill(s.intro, vars),
    '',
    ...details,
    '',
    replayLine,
    '',
    `${s.cta}: ${input.runUrl}`,
    '',
    s.throttle,
    s.why,
  ].join('\n');
  const html = renderBrandedHtml({
    heading: s.heading,
    eyebrow: 'zerosoft · flow',
    paragraphs: [
      escapeHtml(fill(s.intro, vars)),
      details.map((d) => `<code>${escapeHtml(d)}</code>`).join('<br />'),
      escapeHtml(replayLine),
      `<a href="${escapeHtml(input.runUrl)}">${escapeHtml(s.cta)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(s.throttle)} ${escapeHtml(s.why)}</span>`,
    ],
  });
  return { subject, text, html };
}

/**
 * Aviso de falla al dueño del flow. Respeta failure_alerts del flow y el
 * tope de uno por hora (compare-and-set de failure_email_at). Si el envío
 * falla, se libera el tope para que la próxima falla vuelva a intentar.
 */
export async function notifyRunFailure(opts: {
  flow: FlowInfo;
  run: RunInfo;
  error: string | null;
  failedNode: string | null;
  replayAt: string | null;
  now?: Date;
}): Promise<boolean> {
  const { flow, run } = opts;
  if (flow.failure_alerts === 0 || !ALERT_TRIGGERS.has(run.trigger_type)) return false;
  if (errorCode(opts.error) === 'cancelled') return false;
  const db = getDb();
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - FAILURE_EMAIL_INTERVAL_MS).toISOString();
  const prev = (await db.prepare('SELECT failure_email_at FROM flow_flows WHERE id = ?').get(flow.id)) as
    | { failure_email_at: string | null }
    | undefined;
  if (!prev) return false;
  const claimed = await db
    .prepare('UPDATE flow_flows SET failure_email_at = ? WHERE id = ? AND (failure_email_at IS NULL OR failure_email_at <= ?)')
    .run(now.toISOString(), flow.id, since);
  if (claimed.changes !== 1) return false;
  const owner = (await db
    .prepare(
      `SELECT email FROM users WHERE id = ? AND email != ''
       UNION ALL SELECT email FROM users WHERE id = ? AND email != '' LIMIT 1`,
    )
    .get(flow.created_by ?? flow.user_id, flow.user_id)) as { email: string } | undefined;
  const release = () =>
    db.prepare('UPDATE flow_flows SET failure_email_at = ? WHERE id = ? AND failure_email_at = ?').run(
      prev.failure_email_at,
      flow.id,
      now.toISOString(),
    );
  if (!owner) {
    await release();
    return false;
  }
  const { locale } = await getFlowSettings(flow.user_id);
  const mail = buildFailureEmail({
    locale,
    flowName: flow.name,
    error: opts.error,
    failedNode: opts.failedNode,
    runUrl: `${siteUrl()}/${locale}/app/flow/${flow.id}?run=${run.id}`,
    failedAt: now.toISOString(),
    replayAt: opts.replayAt,
  });
  const res = await sendEmail({ to: owner.email, subject: mail.subject, text: mail.text, html: mail.html });
  if (!res.ok) {
    await release();
    return false;
  }
  return true;
}

// ---------- Replay ----------

export type ReplayError = 'not_found' | 'run_not_failed' | 'rate_limited';

export type ReplayResult =
  | { ok: true; runId: string; status: FlowRunRow['status']; mode: 'from_step' | 'full' }
  | { ok: false; error: ReplayError };

/**
 * Vuelve a correr una corrida fallida. Primero desde el paso que falló
 * (reusa las salidas anteriores); si no hay paso fallido o no se puede
 * retomar desde ahí (dentro de un Loop, nodo borrado), la corrida entera con
 * el mismo input y el grafo actual. Se ejecuta en el momento.
 */
export async function replayRun(workspaceId: string, runId: string): Promise<ReplayResult> {
  const db = getDb();
  const old = (await db.prepare('SELECT * FROM flow_runs WHERE id = ? AND user_id = ?').get(runId, workspaceId)) as
    | FlowRunRow
    | undefined;
  if (!old) return { ok: false, error: 'not_found' };
  if (old.status !== 'failed') return { ok: false, error: 'run_not_failed' };
  // Un replay (manual o automático) reemplaza al que estaba agendado.
  await db.prepare('UPDATE flow_runs SET replay_at = NULL WHERE id = ?').run(old.id);
  const failed = (await db
    .prepare(
      `SELECT node_id FROM flow_steps WHERE run_id = ? AND status = 'failed' AND node_type NOT LIKE 'trigger.%'
       ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(old.id)) as { node_id: string } | undefined;
  if (failed) {
    const res = await rerunFromStep(workspaceId, old.id, failed.node_id);
    if (res.ok) return { ok: true, runId: res.runId, status: res.status, mode: 'from_step' };
    if (res.error === 'rate_limited' || res.error === 'not_found') return { ok: false, error: res.error };
  }
  const flow = (await db.prepare('SELECT id, user_id FROM flow_flows WHERE id = ? AND user_id = ?').get(old.flow_id, workspaceId)) as
    | Pick<FlowFlowRow, 'id' | 'user_id'>
    | undefined;
  if (!flow) return { ok: false, error: 'not_found' };
  const newId = await enqueueRun(flow, old.trigger_type, parseJson(old.input, {}), {
    status: 'running',
    lockMs: 5 * 60_000,
    chain: { depth: old.chain_depth, seen: parseJson<string[]>(old.chain_seen, []) },
    rerunOf: old.id,
  });
  if (!newId) return { ok: false, error: 'rate_limited' };
  return { ok: true, runId: newId, status: await executeRun(newId), mode: 'full' };
}

/**
 * Replays automáticos vencidos. Cada corrida se reclama con un
 * compare-and-set de replay_at (dos workers a la vez no la repiten).
 */
export async function processDueReplays(opts: { now?: Date; limit?: number; deadline?: number } = {}): Promise<number> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare(
      `SELECT r.id, r.user_id, r.replay_at FROM flow_runs r JOIN flow_flows f ON f.id = r.flow_id
       WHERE r.replay_at IS NOT NULL AND r.replay_at <= ? AND r.status = 'failed' AND f.enabled = 1
       ORDER BY r.replay_at LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 20, 1), 200))) as Array<{ id: string; user_id: string; replay_at: string }>;
  let done = 0;
  for (const row of rows) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const claimed = await db
      .prepare('UPDATE flow_runs SET replay_at = NULL WHERE id = ? AND replay_at = ?')
      .run(row.id, row.replay_at);
    if (claimed.changes !== 1) continue;
    try {
      await replayRun(row.user_id, row.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[flow] auto replay failed', err);
    }
    done += 1;
  }
  // Flows apagados: sus replays pendientes se descartan (no corren al prenderlo días después).
  await db
    .prepare(
      `UPDATE flow_runs SET replay_at = NULL WHERE replay_at IS NOT NULL AND replay_at <= ?
         AND flow_id IN (SELECT id FROM flow_flows WHERE enabled = 0)`,
    )
    .run(now);
  return done;
}
