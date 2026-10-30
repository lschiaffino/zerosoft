/**
 * Hiring: plantillas de email y de carta de oferta, envío al candidato desde
 * la app y respuestas por email que vuelven a su línea de tiempo.
 *
 * Respuestas: cada email al candidato sale con Reply-To
 * hire+<postulación>.<firma>@CHAT_INBOUND_DOMAIN (el dominio de recepción de
 * Chat, Resend Inbound). El webhook de Chat (/api/chat/inbound-email) reconoce
 * la dirección y llama a processHiringInbound: solo se acepta si el remitente
 * es el email del candidato y pasa los mismos filtros que Chat (respuestas
 * automáticas, rebotes); sin DMARC "pass" entra marcada como sin verificar. La firma es un HMAC: nadie arma la dirección
 * de otra postulación. Sin dominio de recepción, los emails salen sin Reply-To
 * y las respuestas no vuelven (la app lo avisa).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from '../email';
import { inboundDomain, inboundFake, parseFrom, rejectReason, stripQuotedReply } from '../chat-email';
import type { InboundAuth } from '../chat-email';
import { emailDefault } from './builtin';
import { HiringError, TEMPLATE_KINDS, firstName, renderTemplate, type HiringActor, type TemplateKind } from './types';
import { appBase, ensureSettings, newId, nowIso, requireManage, type SettingsRow } from './core';
import { addEvent, notifyTeam, teamIds } from './events';

// ---------- Plantillas ----------

export interface TemplateRow {
  id: string;
  workspace_id: string;
  job_id: string | null;
  kind: TemplateKind;
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export function templateDto(t: TemplateRow) {
  return { id: t.id, jobId: t.job_id, kind: t.kind, name: t.name, subject: t.subject, body: t.body, updatedAt: t.updated_at };
}
export type TemplateDto = ReturnType<typeof templateDto>;

export const templateSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS),
  name: z.string().trim().min(1).max(120),
  subject: z.string().trim().max(300).default(''),
  body: z.string().max(20_000).default(''),
  /** Plantilla de un puesto (la usa solo ese puesto). Sin puesto, es del workspace: solo admins. */
  jobId: z.string().max(80).nullable().default(null),
});

/** Plantillas que la persona puede usar: las del workspace y las de los puestos que gestiona (admins: todas). */
export async function listTemplates(actor: HiringActor | string, kind?: TemplateKind): Promise<TemplateDto[]> {
  const ws = typeof actor === 'string' ? actor : actor.ws;
  const scoped =
    typeof actor === 'string' || actor.admin
      ? ''
      : ` AND (t.job_id IS NULL OR t.job_id IN (SELECT job_id FROM hiring_job_members WHERE user_id = ? AND role IN ('recruiter','hiring_manager')))`;
  const args: string[] = [ws];
  if (kind) args.push(kind);
  if (scoped) args.push((actor as HiringActor).person);
  const rows = (await getDb()
    .prepare(`SELECT t.* FROM hiring_templates t WHERE t.workspace_id = ? ${kind ? 'AND t.kind = ?' : ''}${scoped} ORDER BY t.kind, t.name COLLATE NOCASE`)
    .all(...args)) as TemplateRow[];
  return rows.map(templateDto);
}

export async function getTemplate(ws: string, id: string): Promise<TemplateRow | null> {
  return ((await getDb().prepare('SELECT * FROM hiring_templates WHERE id = ? AND workspace_id = ?').get(id, ws)) as TemplateRow | undefined) ?? null;
}

/**
 * Quién escribe plantillas: las del workspace (las que usan todos los puestos,
 * incluido el acuse automático), solo admins; las de un puesto, quien lo
 * gestiona (recruiter o hiring manager).
 */
async function requireTemplateScope(actor: HiringActor, jobId: string | null): Promise<void> {
  if (jobId) await requireManage(actor, jobId);
  else if (!actor.admin) throw new HiringError('forbidden', 403);
}

export async function createTemplate(actor: HiringActor, input: z.infer<typeof templateSchema>): Promise<TemplateDto> {
  await requireTemplateScope(actor, input.jobId);
  const id = newId('htp');
  const ts = nowIso();
  await getDb()
    .prepare('INSERT INTO hiring_templates (id, workspace_id, job_id, kind, name, subject, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, input.jobId, input.kind, input.name, input.subject, input.body, actor.person, ts, ts);
  return templateDto((await getTemplate(actor.ws, id))!);
}

export async function updateTemplate(actor: HiringActor, id: string, patch: Partial<z.infer<typeof templateSchema>>): Promise<TemplateDto> {
  const cur = await getTemplate(actor.ws, id);
  if (!cur) throw new HiringError('not_found', 404);
  await requireTemplateScope(actor, cur.job_id);
  await getDb()
    .prepare('UPDATE hiring_templates SET name = ?, subject = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(patch.name ?? cur.name, patch.subject ?? cur.subject, patch.body ?? cur.body, nowIso(), id);
  return templateDto((await getTemplate(actor.ws, id))!);
}

export async function deleteTemplate(actor: HiringActor, id: string): Promise<void> {
  const cur = await getTemplate(actor.ws, id);
  if (!cur) throw new HiringError('not_found', 404);
  await requireTemplateScope(actor, cur.job_id);
  await getDb().prepare('DELETE FROM hiring_templates WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

/**
 * La plantilla para un envío: la elegida (si es del workspace o de este
 * puesto), si no la más nueva del puesto, si no la del workspace, si no la
 * integrada en el idioma de la página de empleos.
 */
export async function resolveTemplate(
  ws: string,
  kind: Exclude<TemplateKind, 'custom' | 'job'>,
  settings: SettingsRow,
  templateId: string | null | undefined,
  jobId: string,
): Promise<{ subject: string; body: string }> {
  if (templateId) {
    const t = await getTemplate(ws, templateId);
    if (t && (t.job_id === null || t.job_id === jobId)) return { subject: t.subject, body: t.body };
  }
  const own = (await getDb()
    .prepare('SELECT subject, body FROM hiring_templates WHERE workspace_id = ? AND kind = ? AND (job_id = ? OR job_id IS NULL) ORDER BY job_id IS NULL, updated_at DESC LIMIT 1')
    .get(ws, kind, jobId)) as { subject: string; body: string } | undefined;
  return own ?? emailDefault(settings.locale, kind);
}

// ---------- Envío ----------

function signingKey(): string {
  return process.env.CHAT_INBOUND_SECRET || process.env.NEXTAUTH_SECRET || 'zerosoft-chat-inbound';
}

function hireSignature(appId: string): string {
  return createHmac('sha256', signingKey()).update(`hire:${appId}`).digest('hex').slice(0, 16);
}

/** hire+<id>.<firma>@dominio (null sin dominio de recepción). */
export function hiringReplyAddress(appId: string): string | null {
  const domain = inboundDomain();
  return domain ? `hire+${appId.toLowerCase()}.${hireSignature(appId.toLowerCase())}@${domain}` : null;
}

/** De los destinatarios, la postulación de una dirección hire+ con firma válida. */
export function parseHiringAddress(recipients: string[]): string | null {
  for (const raw of recipients) {
    const addr = (raw.match(/<([^>]+)>/)?.[1] ?? raw).trim().toLowerCase();
    const m = addr.match(/^hire\+([a-z0-9_-]{8,64})\.([0-9a-f]{16})@/);
    if (!m) continue;
    const expected = Buffer.from(hireSignature(m[1]));
    const given = Buffer.from(m[2]);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return m[1];
  }
  return null;
}

export function repliesEnabled(): boolean {
  return inboundDomain() !== null;
}

export interface MailContext {
  candidate: { id: string; name: string; email: string };
  job: { title: string };
  applicationId: string;
  senderName: string;
  extra?: Record<string, string>;
}

export function mailVars(settings: SettingsRow, ctx: MailContext): Record<string, string> {
  return {
    'candidate.name': ctx.candidate.name,
    'candidate.firstName': firstName(ctx.candidate.name),
    'job.title': ctx.job.title,
    company: settings.company,
    'sender.name': ctx.senderName,
    ...(ctx.extra ?? {}),
  };
}

function textToHtmlParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) =>
    escapeHtml(p)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
      .replace(/\n/g, '<br/>'),
  );
}

/**
 * Manda un email al candidato desde la app (con su Reply-To de entrada) y lo
 * deja en la línea de tiempo. Las variables {{…}} se completan acá.
 */
export async function sendCandidateEmail(
  ws: string,
  ctx: MailContext,
  tpl: { subject: string; body: string },
  actorId: string | null,
  opts: { kind?: string } = {},
): Promise<{ ok: boolean }> {
  const settings = await ensureSettings(ws);
  const vars = mailVars(settings, ctx);
  const subject = renderTemplate(tpl.subject, vars).slice(0, 300) || ctx.job.title;
  const text = renderTemplate(tpl.body, vars).slice(0, 20_000);
  const replyTo = hiringReplyAddress(ctx.applicationId) ?? undefined;
  const res = await sendEmail({
    to: ctx.candidate.email,
    from: namedSender(settings.company),
    subject,
    text,
    html: renderBrandedHtml({ heading: subject, paragraphs: textToHtmlParagraphs(text), brandColor: settings.color, eyebrow: settings.company }),
    replyTo,
  });
  // Los links con token (oferta, borrado de datos, agenda) son del candidato: en la línea de tiempo quedan tapados.
  await addEvent(ws, ctx.candidate.id, ctx.applicationId, 'email_out', actorId, { subject: redactLinks(subject, ctx.extra), body: redactLinks(text, ctx.extra), kind: opts.kind ?? 'custom', delivered: res.ok });
  return { ok: res.ok };
}

const LINK_MARKERS: Record<string, string> = { offerLink: '[offer link]', privacyLink: '[privacy link]', schedulingLink: '[scheduling link]' };

/** Reemplaza los links personales del candidato por una marca (también cualquier /offer/… o /privacy/… que quede). */
export function redactLinks(text: string, extra: Record<string, string> = {}): string {
  let out = text;
  for (const [k, marker] of Object.entries(LINK_MARKERS)) if (extra[k]) out = out.split(extra[k]).join(marker);
  return out.replace(/https?:\/\/\S*\/careers\/[^/\s]+\/(offer|privacy)\/[A-Za-z0-9_-]+/g, (_m, kind: string) => (kind === 'offer' ? '[offer link]' : '[privacy link]'));
}

// ---------- Respuestas ----------

export interface HiringInbound {
  emailId: string;
  from: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  authentication: InboundAuth | null;
}

/** Una respuesta a hire+…: si es del candidato, va a su línea de tiempo y avisa al equipo. */
/**
 * Una respuesta a hire+…. Nunca se descarta en silencio: si no entra, queda
 * un evento "descartado" con el motivo (sin el texto). Se descarta solo lo
 * que falla explícitamente (DMARC fail, SPF y DKIM fail, respuestas
 * automáticas, rebotes) o no viene del email del candidato. Si no hay
 * veredicto DMARC "pass" (fuera del modo de prueba), entra como "sin
 * verificar": se ve con un aviso y no se avisa al equipo.
 */
export async function processHiringInbound(appId: string, email: HiringInbound): Promise<{ status: 'added' | 'duplicate' | 'ignored'; reason?: string; unverified?: boolean }> {
  const db = getDb();
  const app = (await db
    .prepare(
      `SELECT a.id, a.workspace_id, a.job_id, a.candidate_id, c.email, c.name, j.title FROM hiring_applications a
       JOIN hiring_candidates c ON c.id = a.candidate_id JOIN hiring_jobs j ON j.id = a.job_id WHERE lower(a.id) = ?`,
    )
    .get(appId.toLowerCase())) as { id: string; workspace_id: string; job_id: string; candidate_id: string; email: string; name: string; title: string } | undefined;
  if (!app) return { status: 'ignored', reason: 'unknown' };
  const claimed = await db.prepare('INSERT OR IGNORE INTO chat_inbound_emails (email_id, created_at) VALUES (?, ?)').run(`hire:${email.emailId}`.slice(0, 128), nowIso());
  if (!claimed.changes) return { status: 'duplicate' };
  const sender = parseFrom(email.from).email;
  const reason = rejectReason({ ...email, to: [], messageId: null, attachments: [], skippedAttachments: [] } as unknown as Parameters<typeof rejectReason>[0]) ?? (!sender || sender !== app.email.toLowerCase() ? 'sender_mismatch' : null);
  if (reason) {
    await addEvent(app.workspace_id, app.candidate_id, app.id, 'email_dropped', null, { reason, fromDomain: (sender ?? '').split('@')[1] ?? '' });
    return { status: 'ignored', reason };
  }
  const unverified = !inboundFake() && email.authentication?.dmarc?.toLowerCase() !== 'pass';
  const body = stripQuotedReply(email.text).slice(0, 10_000);
  await addEvent(app.workspace_id, app.candidate_id, app.id, 'email_in', null, { subject: email.subject.slice(0, 300), body, unverified });
  if (!unverified) {
    await notifyTeam(await teamIds(app.job_id, ['recruiter', 'hiring_manager']), {
      title: `${app.name} · ${app.title}`,
      body: body.slice(0, 200),
      href: `/app/hiring/candidates/${app.candidate_id}?app=${app.id}`,
      sourceId: app.id,
    });
  }
  return { status: 'added', unverified };
}

export function offerLinkFor(handle: string, token: string): string {
  return `${appBase()}/careers/${handle}/offer/${token}`;
}

export function privacyLinkFor(handle: string, token: string): string {
  return `${appBase()}/careers/${handle}/privacy/${token}`;
}
