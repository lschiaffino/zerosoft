/**
 * Flow — esperas que retoma alguien de afuera:
 *  - Esperar hasta una llamada (logic.delay mode=resume): cada corrida tiene
 *    una URL firmada ({{run.resumeUrl}}); un GET o POST a esa URL retoma el
 *    Esperar que está en espera, con el body como salida del nodo.
 *  - Aprobación (logic.approval): links firmados por corrida y nodo a una
 *    página donde se aprueba o rechaza (con comentario opcional). La página
 *    no decide en el GET (los escáneres de links de los emails lo abrirían).
 * En los dos casos el tiempo límite es un flow_jobs que el worker corre si
 * nadie respondió. Quien llega primero (la llamada o el worker) se lleva el
 * job con un DELETE condicional; el otro ve que ya no está. Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { siteUrl } from './board-urls';
import { getDb, type FlowRunRow, type FlowStepRow } from './db';
import { escapeHtml, renderBrandedHtml } from './email';
import { nowIso, parseJson } from './flow';
import en from '@/messages/en/flow.json';
import es from '@/messages/es/flow.json';
import pt from '@/messages/pt/flow.json';

/** Tipos de job de las esperas externas (payload.kind en flow_jobs). */
export const RESUME_TIMEOUT = 'resume_timeout';
export const APPROVAL_TIMEOUT = 'approval_timeout';

/** Tope del body de una llamada de resume (queda como salida del nodo). */
export const RESUME_BODY_LIMIT = 64_000;
/** Tope del comentario de una aprobación. */
export const APPROVAL_COMMENT_LIMIT = 2000;
/** Destinatarios por aprobación. */
export const MAX_APPROVERS = 10;

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'zerosoft-flow-waits';
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url').slice(0, 32);
}

function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const RUN_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const NODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Token de resume de una corrida: <runId>.<firma>. */
export function resumeToken(runId: string): string {
  return `${runId}.${sign(`flow-resume:${runId}`)}`;
}

export function parseResumeToken(token: string): string | null {
  const [runId, sig, extra] = token.split('.');
  if (extra !== undefined || !runId || !sig || !RUN_ID_RE.test(runId)) return null;
  return sameSig(sig, sign(`flow-resume:${runId}`)) ? runId : null;
}

export function resumeUrl(runId: string): string {
  return `${siteUrl()}/api/flow/resume/${resumeToken(runId)}`;
}

/** Token de una aprobación: <runId>.<nodeId>.<firma>. */
export function approvalToken(runId: string, nodeId: string): string {
  return `${runId}.${nodeId}.${sign(`flow-approval:${runId}:${nodeId}`)}`;
}

export function parseApprovalToken(token: string): { runId: string; nodeId: string } | null {
  const [runId, nodeId, sig, extra] = token.split('.');
  if (extra !== undefined || !runId || !nodeId || !sig || !RUN_ID_RE.test(runId) || !NODE_ID_RE.test(nodeId)) return null;
  return sameSig(sig, sign(`flow-approval:${runId}:${nodeId}`)) ? { runId, nodeId } : null;
}

export function approvalUrl(locale: string, runId: string, nodeId: string, decision?: 'approve' | 'reject'): string {
  const loc = ['en', 'es', 'pt'].includes(locale) ? locale : 'en';
  return `${siteUrl()}/${loc}/flow/approve/${approvalToken(runId, nodeId)}${decision ? `?decision=${decision}` : ''}`;
}

// ---------- Email de aprobación ----------

type ApprovalStrings = typeof en.approvalEmail;

const STRINGS: Record<string, ApprovalStrings> = {
  en: en.approvalEmail,
  es: { ...en.approvalEmail, ...es.approvalEmail },
  pt: { ...en.approvalEmail, ...pt.approvalEmail },
};

export function approvalStrings(locale: string): ApprovalStrings {
  return STRINGS[locale] ?? STRINGS.en;
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

/** Asunto, texto y HTML del pedido de aprobación. */
export function buildApprovalEmail(input: {
  locale: string;
  flowName: string;
  subject: string;
  message: string;
  approveUrl: string;
  rejectUrl: string;
  expiresAt: string;
}): { subject: string; text: string; html: string } {
  const s = approvalStrings(input.locale);
  const vars = { flow: input.flowName, time: `${input.expiresAt.slice(0, 16).replace('T', ' ')} UTC` };
  const subject = input.subject.trim() || fill(s.subject, vars);
  const text = [
    fill(s.intro, vars),
    '',
    ...(input.message.trim() ? [input.message.trim(), ''] : []),
    `${s.approve}: ${input.approveUrl}`,
    `${s.reject}: ${input.rejectUrl}`,
    '',
    fill(s.expires, vars),
  ].join('\n');
  const html = renderBrandedHtml({
    heading: s.heading,
    eyebrow: 'zerosoft · flow',
    paragraphs: [
      escapeHtml(fill(s.intro, vars)),
      ...(input.message.trim() ? [escapeHtml(input.message.trim()).replace(/\n/g, '<br />')] : []),
      `<a href="${escapeHtml(input.approveUrl)}">${escapeHtml(s.approve)}</a> &nbsp;·&nbsp; <a href="${escapeHtml(input.rejectUrl)}">${escapeHtml(s.reject)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(fill(s.expires, vars))}</span>`,
    ],
  });
  return { subject, text, html };
}

// ---------- Reclamar una espera ----------

type ClaimResult = { ok: true; jobId: string; nodeId: string } | { ok: false; error: 'not_waiting' | 'busy' };

/**
 * Toma la espera de una corrida para retomarla desde afuera: lock de la
 * corrida en 'waiting' y DELETE condicional de su job de tiempo límite (si el
 * worker ya lo tomó, gana el worker). `nodeId` null = el primero que espera.
 */
async function claimWait(runId: string, kind: string, nodeId: string | null): Promise<ClaimResult> {
  const db = getDb();
  const ts = nowIso();
  const run = (await db.prepare('SELECT status FROM flow_runs WHERE id = ?').get(runId)) as Pick<FlowRunRow, 'status'> | undefined;
  if (!run || run.status !== 'waiting') return { ok: false, error: 'not_waiting' };
  const job = (await db
    .prepare(
      `SELECT id, node_id FROM flow_jobs WHERE run_id = ? AND json_valid(payload) AND json_extract(payload, '$.kind') = ?
         ${nodeId ? 'AND node_id = ?' : ''} ORDER BY created_at ASC LIMIT 1`,
    )
    .get(...(nodeId ? [runId, kind, nodeId] : [runId, kind]))) as { id: string; node_id: string } | undefined;
  if (!job) return { ok: false, error: 'not_waiting' };
  const lock = new Date(Date.now() + 5 * 60_000).toISOString();
  const locked = await db
    .prepare(
      `UPDATE flow_runs SET locked_until = ? WHERE id = ? AND status = 'waiting' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(lock, runId, ts);
  if (locked.changes !== 1) return { ok: false, error: 'busy' };
  const taken = await db
    .prepare('DELETE FROM flow_jobs WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)')
    .run(job.id, ts);
  if (taken.changes !== 1) {
    await db.prepare('UPDATE flow_runs SET locked_until = NULL WHERE id = ? AND locked_until = ?').run(runId, lock);
    return { ok: false, error: 'not_waiting' };
  }
  return { ok: true, jobId: job.id, nodeId: job.node_id };
}

export type ResumeResult =
  | { ok: true; runId: string; status: FlowRunRow['status'] }
  | { ok: false; error: 'not_found' | 'not_waiting' | 'busy' };

/**
 * Retoma la corrida ya reclamada. En segundo plano (routes) responde al
 * instante y el resto del flow corre después de la respuesta (after); si no
 * hay request en curso (scripts, tests), corre en el momento.
 */
async function resume(
  runId: string,
  nodeId: string,
  payload: Record<string, unknown>,
  background: boolean,
): Promise<FlowRunRow['status']> {
  const { resumeRun } = await import('./flow-engine');
  const job = () => resumeRun(runId, nodeId, payload);
  if (!background) return job();
  try {
    after(job);
  } catch {
    void job().catch(() => {});
  }
  return 'running';
}

/** Llamada a {{run.resumeUrl}}: retoma el Esperar de la corrida con lo que trajo la llamada. */
export async function resumeFromCall(
  token: string,
  data: { method: string; body: unknown; query: Record<string, string> },
  opts: { background?: boolean } = {},
): Promise<ResumeResult> {
  const runId = parseResumeToken(token);
  if (!runId) return { ok: false, error: 'not_found' };
  const claim = await claimWait(runId, RESUME_TIMEOUT, null);
  if (!claim.ok) return claim;
  const status = await resume(runId, claim.nodeId, { kind: 'resume', data }, opts.background === true);
  return { ok: true, runId, status };
}

export type ApprovalDecision = 'approve' | 'reject';

/** Decisión desde la página de aprobación. */
export async function decideApproval(
  token: string,
  decision: ApprovalDecision,
  comment: string,
  opts: { background?: boolean } = {},
): Promise<ResumeResult> {
  const parsed = parseApprovalToken(token);
  if (!parsed) return { ok: false, error: 'not_found' };
  const claim = await claimWait(parsed.runId, APPROVAL_TIMEOUT, parsed.nodeId);
  if (!claim.ok) return claim;
  const status = await resume(
    parsed.runId,
    parsed.nodeId,
    { kind: 'approval', decision, comment: comment.trim().slice(0, APPROVAL_COMMENT_LIMIT) },
    opts.background === true,
  );
  return { ok: true, runId: parsed.runId, status };
}

export interface ApprovalView {
  state: 'pending' | 'approved' | 'rejected' | 'expired' | 'closed';
  flowName: string;
  subject: string;
  message: string;
  expiresAt: string | null;
  decidedAt: string | null;
  comment: string;
  timedOut: boolean;
}

/** Lo que muestra la página de aprobación (null = token inválido o corrida inexistente). */
export async function getApprovalView(token: string): Promise<ApprovalView | null> {
  const parsed = parseApprovalToken(token);
  if (!parsed) return null;
  const db = getDb();
  const run = (await db
    .prepare('SELECT r.status, f.name FROM flow_runs r JOIN flow_flows f ON f.id = r.flow_id WHERE r.id = ?')
    .get(parsed.runId)) as { status: FlowRunRow['status']; name: string } | undefined;
  if (!run) return null;
  const step = (await db
    .prepare(
      `SELECT * FROM flow_steps WHERE run_id = ? AND node_id = ? AND node_type = 'logic.approval'
       ORDER BY started_at DESC, rowid DESC LIMIT 1`,
    )
    .get(parsed.runId, parsed.nodeId)) as FlowStepRow | undefined;
  if (!step) return null;
  const out = parseJson<Record<string, unknown>>(step.output, {});
  const pending = (await db
    .prepare(
      `SELECT 1 FROM flow_jobs WHERE run_id = ? AND node_id = ? AND json_valid(payload) AND json_extract(payload, '$.kind') = ?`,
    )
    .get(parsed.runId, parsed.nodeId, APPROVAL_TIMEOUT)) as unknown;
  const decision = out.decision === 'approved' || out.decision === 'rejected' ? out.decision : null;
  // Pendiente mientras exista su job de tiempo límite; después, la decisión
  // (también la automática al vencer), vencida sin decisión, o cerrada (corrida cancelada).
  const state: ApprovalView['state'] =
    pending && run.status === 'waiting' ? 'pending' : decision ?? (out.timedOut ? 'expired' : 'closed');
  return {
    state,
    flowName: run.name,
    subject: String(out.subject ?? ''),
    message: String(out.message ?? ''),
    expiresAt: typeof out.expiresAt === 'string' ? out.expiresAt : null,
    decidedAt: typeof out.decidedAt === 'string' ? out.decidedAt : null,
    comment: String(out.comment ?? ''),
    timedOut: out.timedOut === true,
  };
}
