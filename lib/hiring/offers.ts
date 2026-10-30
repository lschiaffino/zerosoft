/**
 * Hiring: ofertas. El recruiter (o el hiring manager) arma la carta desde una
 * plantilla; la aprueba el hiring manager del puesto o un admin; recién
 * aprobada se envía al candidato con un link propio donde la acepta (con su
 * nombre escrito, que queda registrado con fecha, IP, navegador y un hash de
 * la carta) o la rechaza. Aceptar mueve la postulación a "Contratados".
 * Sin firma electrónica: no hay una app Sign en main. Server-only.
 */
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db';
import { HiringError, canApproveOffer, renderTemplate, type HiringActor, type OfferStatus } from './types';
import { ensureSettings, jobRole, listStages, newId, nowIso } from './core';
import { addEvent, notifyTeam, teamIds } from './events';
import { getApplicationRow, getCandidateRow, markHired, personName, requireManageApp } from './candidates';
import { mailVars, offerLinkFor, resolveTemplate, sendCandidateEmail } from './comms';
import { getJobRow } from './core';

export interface OfferRow {
  id: string;
  workspace_id: string;
  application_id: string;
  status: OfferStatus;
  title: string;
  salary: number | null;
  currency: string;
  start_date: string | null;
  body: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  token_hash: string | null;
  responded_at: string | null;
  signed_name: string | null;
  signed_ip: string | null;
  signed_ua: string | null;
  body_hash: string | null;
  decline_reason: string;
  created_at: string;
  updated_at: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function offerDto(o: OfferRow) {
  return {
    id: o.id,
    applicationId: o.application_id,
    status: o.status,
    title: o.title,
    salary: o.salary,
    currency: o.currency,
    startDate: o.start_date,
    body: o.body,
    createdBy: o.created_by,
    approvedBy: o.approved_by,
    approvedAt: o.approved_at,
    sentAt: o.sent_at,
    respondedAt: o.responded_at,
    signedName: o.signed_name,
    signedIp: o.signed_ip,
    bodyHash: o.body_hash,
    declineReason: o.decline_reason,
    createdAt: o.created_at,
  };
}
export type OfferDto = ReturnType<typeof offerDto>;

export function formatSalary(amount: number | null, currency: string, locale = 'en'): string {
  if (amount == null) return '';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export const offerSchema = z.object({
  title: z.string().trim().max(160).optional(),
  salary: z.number().int().min(0).max(100_000_000).nullable().default(null),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('USD'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  body: z.string().max(30_000).optional(),
  templateId: z.string().max(80).nullable().default(null),
});

export async function listOffers(appId: string): Promise<OfferDto[]> {
  return ((await getDb().prepare('SELECT * FROM hiring_offers WHERE application_id = ? ORDER BY created_at DESC').all(appId)) as OfferRow[]).map(offerDto);
}

async function getOfferRow(ws: string, id: string): Promise<OfferRow | null> {
  return ((await getDb().prepare('SELECT * FROM hiring_offers WHERE id = ? AND workspace_id = ?').get(id, ws)) as OfferRow | undefined) ?? null;
}

/** Crea la oferta (pendiente de aprobación) con la carta armada desde la plantilla. */
export async function createOffer(actor: HiringActor, appId: string, input: z.infer<typeof offerSchema>): Promise<OfferDto> {
  const { app, job, candidate } = await requireManageApp(actor, appId);
  const db = getDb();
  const open = await db.prepare("SELECT 1 FROM hiring_offers WHERE application_id = ? AND status IN ('pending_approval','approved','sent')").get(app.id);
  if (open) throw new HiringError('offer_open', 409);
  const settings = await ensureSettings(actor.ws);
  const title = input.title || job.title;
  let body = input.body;
  if (!body) {
    const tpl = await resolveTemplate(actor.ws, 'offer_letter', settings, input.templateId);
    body = renderTemplate(tpl.body, {
      ...mailVars(settings, { candidate, job: { title }, applicationId: app.id, senderName: await personName(actor.person) }),
      'offer.salary': formatSalary(input.salary, input.currency, settings.locale),
      'offer.startDate': input.startDate ?? '',
    });
  }
  const id = newId('hof');
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO hiring_offers (id, workspace_id, application_id, status, title, salary, currency, start_date, body, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'pending_approval', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, app.id, title, input.salary, input.currency, input.startDate, body, actor.person, ts, ts);
  await addEvent(actor.ws, candidate.id, app.id, 'offer', actor.person, { status: 'pending_approval', title });
  await notifyTeam(await teamIds(job.id, ['hiring_manager'], actor.person), {
    title: `${candidate.name} · ${title}`,
    body: 'offer',
    href: `/app/hiring/candidates/${candidate.id}?app=${app.id}`,
    sourceId: id,
  });
  return offerDto((await getOfferRow(actor.ws, id))!);
}

export const offerActionSchema = z.object({ action: z.enum(['approve', 'send', 'withdraw']), templateId: z.string().max(80).nullable().default(null) });

/**
 * Aprobar (hiring manager o admin), enviar (solo aprobada) o retirar. Enviar
 * devuelve el link para que quien la manda lo pueda copiar.
 */
export async function actOnOffer(actor: HiringActor, offerId: string, input: z.infer<typeof offerActionSchema>): Promise<{ offer: OfferDto; link?: string }> {
  const offer = await getOfferRow(actor.ws, offerId);
  if (!offer) throw new HiringError('not_found', 404);
  const { app, job, candidate } = await requireManageApp(actor, offer.application_id);
  const db = getDb();
  const ts = nowIso();
  if (input.action === 'approve') {
    if (!canApproveOffer({ admin: actor.admin, jobRole: await jobRole(job.id, actor.person) })) throw new HiringError('forbidden', 403);
    const res = await db
      .prepare("UPDATE hiring_offers SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_approval'")
      .run(actor.person, ts, ts, offer.id);
    if (!res.changes) throw new HiringError('invalid_state', 409);
    await addEvent(actor.ws, candidate.id, app.id, 'offer', actor.person, { status: 'approved', title: offer.title });
    return { offer: offerDto((await getOfferRow(actor.ws, offer.id))!) };
  }
  if (input.action === 'withdraw') {
    const res = await db.prepare("UPDATE hiring_offers SET status = 'withdrawn', token_hash = NULL, updated_at = ? WHERE id = ? AND status IN ('pending_approval','approved','sent')").run(ts, offer.id);
    if (!res.changes) throw new HiringError('invalid_state', 409);
    await addEvent(actor.ws, candidate.id, app.id, 'offer', actor.person, { status: 'withdrawn', title: offer.title });
    return { offer: offerDto((await getOfferRow(actor.ws, offer.id))!) };
  }
  // send
  if (offer.status !== 'approved' && offer.status !== 'sent') throw new HiringError('offer_not_approved', 409);
  const token = randomBytes(24).toString('base64url');
  const res = await db
    .prepare("UPDATE hiring_offers SET status = 'sent', token_hash = ?, body_hash = ?, sent_at = ?, updated_at = ? WHERE id = ? AND status IN ('approved','sent')")
    .run(sha(token), sha(offer.body), ts, ts, offer.id);
  if (!res.changes) throw new HiringError('invalid_state', 409);
  const settings = await ensureSettings(actor.ws);
  const link = offerLinkFor(settings.handle, token);
  const tpl = await resolveTemplate(actor.ws, 'offer', settings, input.templateId);
  await sendCandidateEmail(actor.ws, { candidate, job: { title: offer.title || job.title }, applicationId: app.id, senderName: await personName(actor.person), extra: { offerLink: link } }, tpl, actor.person, {
    kind: 'offer',
  });
  await addEvent(actor.ws, candidate.id, app.id, 'offer', actor.person, { status: 'sent', title: offer.title });
  return { offer: offerDto((await getOfferRow(actor.ws, offer.id))!), link };
}

export interface PublicOffer {
  company: string;
  color: string | null;
  candidateName: string;
  title: string;
  body: string;
  salary: string;
  startDate: string | null;
  status: OfferStatus;
  signedName: string | null;
  respondedAt: string | null;
  locale: string;
}

async function offerByToken(token: string): Promise<OfferRow | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  return ((await getDb().prepare('SELECT * FROM hiring_offers WHERE token_hash = ?').get(sha(token))) as OfferRow | undefined) ?? null;
}

/** La oferta como la ve el candidato (solo con su token). */
export async function publicOffer(handle: string, token: string): Promise<PublicOffer | null> {
  const o = await offerByToken(token);
  if (!o) return null;
  const settings = await ensureSettings(o.workspace_id);
  if (settings.handle !== handle.toLowerCase()) return null;
  const app = await getApplicationRow(o.workspace_id, o.application_id);
  const c = app ? await getCandidateRow(o.workspace_id, app.candidate_id) : null;
  if (!c) return null;
  return {
    company: settings.company,
    color: settings.color,
    candidateName: c.name,
    title: o.title,
    body: o.body,
    salary: formatSalary(o.salary, o.currency, settings.locale),
    startDate: o.start_date,
    status: o.status,
    signedName: o.signed_name,
    respondedAt: o.responded_at,
    locale: settings.locale,
  };
}

export const respondSchema = z.object({
  token: z.string().min(20).max(80),
  action: z.enum(['accept', 'decline']),
  signedName: z.string().trim().max(160).default(''),
  agree: z.boolean().default(false),
  reason: z.string().trim().max(1000).default(''),
});

/**
 * Respuesta del candidato. Aceptar pide el nombre escrito (igual al del
 * candidato, sin distinguir mayúsculas ni acentos) y la casilla de
 * conformidad; queda el registro de auditoría. Compare-and-set sobre
 * status = 'sent': una oferta se responde una sola vez.
 */
export async function respondToOffer(input: z.infer<typeof respondSchema>, meta: { ip: string; ua: string }): Promise<OfferStatus> {
  const o = await offerByToken(input.token);
  if (!o) throw new HiringError('not_found', 404);
  if (o.status !== 'sent') throw new HiringError('offer_closed', 409);
  const app = (await getApplicationRow(o.workspace_id, o.application_id))!;
  const c = (await getCandidateRow(o.workspace_id, app.candidate_id))!;
  const db = getDb();
  const ts = nowIso();
  if (input.action === 'accept') {
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!input.agree) throw new HiringError('agree_required');
    if (!input.signedName || norm(input.signedName) !== norm(c.name)) throw new HiringError('name_mismatch');
    if (sha(o.body) !== o.body_hash) throw new HiringError('offer_changed', 409);
    const res = await db
      .prepare("UPDATE hiring_offers SET status = 'accepted', responded_at = ?, signed_name = ?, signed_ip = ?, signed_ua = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
      .run(ts, input.signedName, meta.ip.slice(0, 64), meta.ua.slice(0, 300), ts, o.id);
    if (!res.changes) throw new HiringError('offer_closed', 409);
    await addEvent(o.workspace_id, c.id, app.id, 'offer', null, { status: 'accepted', title: o.title, signedName: input.signedName });
    // Aceptada: a "Contratados".
    const hired = (await listStages(app.job_id)).find((s) => s.kind === 'hired');
    if (hired) {
      await db
        .prepare("UPDATE hiring_applications SET stage_id = ?, status = 'hired', hired_at = ?, stage_changed_at = ?, updated_at = ? WHERE id = ? AND status != 'hired'")
        .run(hired.id, ts, ts, ts, app.id);
      await addEvent(o.workspace_id, c.id, app.id, 'stage', null, { to: hired.name, toKind: 'hired' });
      await markHired(o.workspace_id, app.id, null);
    }
  } else {
    const res = await db
      .prepare("UPDATE hiring_offers SET status = 'declined', responded_at = ?, decline_reason = ?, signed_ip = ?, signed_ua = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
      .run(ts, input.reason, meta.ip.slice(0, 64), meta.ua.slice(0, 300), ts, o.id);
    if (!res.changes) throw new HiringError('offer_closed', 409);
    await addEvent(o.workspace_id, c.id, app.id, 'offer', null, { status: 'declined', title: o.title, reason: input.reason });
  }
  const job = await getJobRow(o.workspace_id, app.job_id);
  if (job) {
    await notifyTeam(await teamIds(job.id, ['recruiter', 'hiring_manager']), {
      title: `${c.name} · ${o.title}`,
      body: input.action === 'accept' ? 'accepted' : 'declined',
      href: `/app/hiring/candidates/${c.id}?app=${app.id}`,
      sourceId: o.id,
    });
  }
  return input.action === 'accept' ? 'accepted' : 'declined';
}
