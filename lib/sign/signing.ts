/**
 * Sign: la firma del lado del destinatario (página pública, sin cuenta) y el
 * cierre del sobre. Server-only.
 *
 * - El link es personal: token en la URL, en la base solo su hash. Sirve
 *   mientras el sobre esté enviado y no haya vencido, y para una sola firma.
 * - Con código por email (por defecto), el link solo no alcanza: hace falta
 *   verificar el código, que abre una sesión de dos horas en una cookie
 *   propia del destinatario (en la base, el hash).
 * - Un destinatario completa solo sus campos (validateSubmission).
 * - Con todos firmados: se dibujan los campos, se suma el certificado, se
 *   guarda privado, se manda la copia a todos y se avisa a Flow, al CRM y a
 *   Hiring. Compare-and-set en cada paso: dos pedidos no cierran dos veces.
 */
import { randomBytes, randomInt } from 'crypto';
import { getDb } from '../db';
import { rateLimit } from '../rate-limit';
import { cleanSignatureImage, sha256Hex } from '../esign';
import { emitEventSoon } from '../events';
import { personAppAccess } from '../api-auth';
import { readSignFile, storeSignFile } from './files';
import { appendCertificate, flattenFields, type PageBox } from './pdf';
import { formatDate, signCopy, signLocale } from './i18n';
import {
  addEvent,
  emailTo,
  envelopeById,
  listEvents,
  listFields,
  listRecipients,
  notifyActive,
  notifyRecipient,
  notifySender,
  nowIso,
  parseJson,
  personName,
  type EnvelopeLink,
  type EnvelopeRow,
  type FieldRow,
  type RecipientRow,
} from './core';
import {
  activeRecipients,
  allActed,
  checkOtp,
  hashOtp,
  hashToken,
  isRecipientTurn,
  maskEmail,
  OTP_MAX_ATTEMPTS,
  OTP_SEND_LIMIT,
  OTP_SEND_WINDOW_SEC,
  OTP_TTL_MS,
  SignError,
  TOKEN_RE,
  validateSubmission,
} from './types';
import { runSignHooks } from './hooks';

export const SESSION_TTL_MS = 2 * 60 * 60_000;
export const sessionCookieName = (recipientId: string) => `zs_sign_${recipientId.replace(/[^\w]/g, '')}`;

export interface Meta {
  ip: string;
  ua: string;
}

export interface Resolved {
  env: EnvelopeRow;
  recipient: RecipientRow;
  recipients: RecipientRow[];
}

export async function resolveToken(token: string): Promise<Resolved | null> {
  if (!TOKEN_RE.test(token)) return null;
  const recipient = (await getDb().prepare('SELECT * FROM sign_recipients WHERE token_hash = ?').get(hashToken(token))) as RecipientRow | undefined;
  if (!recipient) return null;
  let env = await envelopeById(recipient.envelope_id);
  if (!env) return null;
  // Vencido: se marca al tocarlo (el cron también lo hace).
  if (env.status === 'sent' && env.expires_at && new Date(env.expires_at).getTime() < Date.now()) {
    await expireEnvelope(env);
    env = (await envelopeById(env.id))!;
  }
  return { env, recipient, recipients: await listRecipients(env.id) };
}

export type PublicState = 'ready' | 'otp' | 'done' | 'waiting' | 'completed' | 'declined' | 'voided' | 'expired';

export function publicState(r: Resolved, sessionOk: boolean): PublicState {
  const { env, recipient } = r;
  if (env.status === 'voided') return 'voided';
  if (env.status === 'expired') return 'expired';
  if (env.status === 'declined') return 'declined';
  if (env.status === 'completed') return 'completed';
  if (env.status !== 'sent') return 'voided';
  if (recipient.status === 'signed' || recipient.status === 'approved') return 'done';
  if (recipient.role === 'cc' || !isRecipientTurn(recipient, r.recipients, env.signing_order)) return 'waiting';
  if (env.otp_required === 1 && !sessionOk) return 'otp';
  return 'ready';
}

/** ¿La cookie del destinatario es una sesión válida (código verificado hace menos de 2 h)? */
export function sessionValid(recipient: RecipientRow, cookie: string | undefined | null): boolean {
  if (!cookie || !recipient.session_hash || !recipient.otp_verified_at) return false;
  const [secret, issued] = cookie.split('.');
  if (!secret || !issued || !/^\d+$/.test(issued)) return false;
  if (Date.now() - Number(issued) > SESSION_TTL_MS) return false;
  return sha256Hex(`${secret}.${issued}`) === recipient.session_hash;
}

/** Lo que ve el destinatario: el sobre, su rol y sus campos (nunca los valores de otros). */
export async function publicView(r: Resolved, sessionOk: boolean) {
  const state = publicState(r, sessionOk);
  const sender = await personName(r.env.created_by);
  const fields = state === 'ready' ? (await listFields(r.env.id)).filter((f) => f.recipient_id === r.recipient.id) : [];
  return {
    state,
    title: r.env.title,
    message: r.env.message,
    senderName: sender.name,
    senderEmail: sender.email,
    recipient: { name: r.recipient.name, email: r.recipient.email, role: r.recipient.role, maskedEmail: maskEmail(r.recipient.email) },
    expiresAt: r.env.expires_at,
    pages: state === 'ready' ? parseJson<PageBox[]>(r.env.pages, []) : [],
    fields: fields.map((f) => ({ id: f.id, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required === 1, label: f.label, options: parseJson<string[]>(f.options, []) })),
  };
}

export async function markViewed(r: Resolved, meta: Meta): Promise<void> {
  const ts = nowIso();
  const res = await getDb()
    .prepare("UPDATE sign_recipients SET viewed_at = ?, status = CASE WHEN status IN ('created','sent') THEN 'viewed' ELSE status END WHERE id = ? AND viewed_at IS NULL")
    .run(ts, r.recipient.id);
  if (res.changes) await addEvent(r.env.id, 'viewed', { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua });
}

function requireActionable(r: Resolved, sessionOk: boolean): void {
  const state = publicState(r, sessionOk);
  if (state === 'otp') throw new SignError('otp_required', 401);
  if (state !== 'ready') throw new SignError(`state_${state}`, 409);
}

// ---------- Código por email ----------

export async function sendOtp(r: Resolved, meta: Meta): Promise<{ to: string }> {
  const state = publicState(r, false);
  if (state !== 'otp' && state !== 'ready') throw new SignError(`state_${state}`, 409);
  if (r.env.otp_required !== 1) throw new SignError('otp_not_required', 409);
  // Tope por destinatario (además del tope por IP de la ruta): no se puede inundar una casilla.
  const lim = await rateLimit(`sign:otp-send:${r.recipient.id}`, OTP_SEND_LIMIT, OTP_SEND_WINDOW_SEC);
  if (!lim.ok) throw new SignError('rate_limited', 429);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await getDb().prepare('UPDATE sign_recipients SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?').run(hashOtp(r.recipient.id, code), expires, r.recipient.id);
  const locale = signLocale(r.env.locale);
  await emailTo(r.env, r.recipient.email, 'otpSubject', [signCopy(locale, 'otpLine', { code })], { title: r.env.title });
  await addEvent(r.env.id, 'otp_sent', { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua });
  return { to: maskEmail(r.recipient.email) };
}

/** Verifica el código. Devuelve el valor de la cookie de sesión. */
export async function verifyOtp(r: Resolved, code: string, meta: Meta): Promise<string> {
  const state = publicState(r, false);
  if (state !== 'otp' && state !== 'ready') throw new SignError(`state_${state}`, 409);
  const fresh = (await getDb().prepare('SELECT * FROM sign_recipients WHERE id = ?').get(r.recipient.id)) as RecipientRow;
  const result = checkOtp(fresh, code.trim());
  if (result !== 'ok') {
    if (result === 'wrong') {
      // Compare-and-set: dos intentos a la vez cuentan los dos.
      await getDb().prepare('UPDATE sign_recipients SET otp_attempts = otp_attempts + 1 WHERE id = ?').run(r.recipient.id);
      await addEvent(r.env.id, 'otp_failed', { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua });
      if (fresh.otp_attempts + 1 >= OTP_MAX_ATTEMPTS) throw new SignError('otp_locked', 429);
      throw new SignError('otp_wrong', 400, { left: OTP_MAX_ATTEMPTS - fresh.otp_attempts - 1 });
    }
    throw new SignError(result === 'locked' ? 'otp_locked' : result === 'expired' ? 'otp_expired' : 'otp_none', result === 'locked' ? 429 : 400);
  }
  const secret = randomBytes(24).toString('base64url');
  const issued = String(Date.now());
  const ts = nowIso();
  // El código es de un solo uso.
  await getDb()
    .prepare('UPDATE sign_recipients SET otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0, otp_verified_at = COALESCE(otp_verified_at, ?), session_hash = ? WHERE id = ?')
    .run(ts, sha256Hex(`${secret}.${issued}`), r.recipient.id);
  await addEvent(r.env.id, 'otp_verified', { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua });
  return `${secret}.${issued}`;
}

// ---------- Firmar, aprobar, rechazar ----------

export interface SubmitInput {
  consent: boolean;
  values: Record<string, unknown>;
  signature?: string | null;
  signatureKind?: 'typed' | 'drawn' | 'upload' | null;
  initials?: string | null;
}

export async function submitSigning(r: Resolved, sessionOk: boolean, input: SubmitInput, meta: Meta): Promise<{ completed: boolean }> {
  requireActionable(r, sessionOk);
  if (!input.consent) throw new SignError('consent_required');
  const fields = await listFields(r.env.id);
  const result = validateSubmission(fields, r.recipient.id, input.values ?? {});
  const signature = result.needsSignature ? cleanSignatureImage(input.signature) : '';
  if (result.needsSignature && !signature) throw new SignError('signature_required');
  const initials = result.needsInitials ? cleanSignatureImage(input.initials) : '';
  if (result.needsInitials && !initials) throw new SignError('initials_required');
  const ts = nowIso();
  const status = r.recipient.role === 'approver' ? 'approved' : 'signed';
  const db = getDb();
  const res = await db
    .prepare(
      `UPDATE sign_recipients SET status = ?, signed_at = ?, consent_at = ?, signature_image = ?, signature_kind = ?, initials_image = ?, ip = ?, user_agent = ?
       WHERE id = ? AND status IN ('created','sent','viewed')`,
    )
    .run(status, ts, ts, signature, signature ? (input.signatureKind ?? 'drawn') : '', initials, meta.ip.slice(0, 64), meta.ua.slice(0, 300), r.recipient.id);
  if (!res.changes) throw new SignError('state_done', 409);
  const locale = signLocale(r.env.locale);
  for (const f of fields.filter((x) => x.recipient_id === r.recipient.id)) {
    let value = result.values.get(f.id) ?? null;
    if (f.kind === 'name') value = r.recipient.name;
    if (f.kind === 'email') value = r.recipient.email;
    if (f.kind === 'date') value = formatDate(ts, locale);
    if (value !== null) await db.prepare('UPDATE sign_fields SET value = ?, filled_at = ? WHERE id = ? AND recipient_id = ?').run(value, ts, f.id, r.recipient.id);
  }
  await addEvent(r.env.id, 'consent', { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua });
  await addEvent(r.env.id, status, { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua, detail: { signatureKind: signature ? (input.signatureKind ?? 'drawn') : null } });
  await notifySender(r.env, 'notifySigned', { name: r.recipient.name });
  return { completed: await advance(r.env.id) };
}

/** Después de una firma: el grupo siguiente recibe el link, o se cierra el sobre. */
export async function advance(envId: string): Promise<boolean> {
  const env = await envelopeById(envId);
  if (!env || env.status !== 'sent') return env?.status === 'completed';
  const recipients = await listRecipients(env.id);
  if (allActed(recipients)) {
    // La firma ya quedó guardada: si el cierre falla, el cron lo reintenta.
    return finalizeEnvelope(env.id).catch((err) => {
      console.error('[sign] no se pudo cerrar el sobre', env.id, err instanceof Error ? err.message : err);
      return false;
    });
  }
  await notifyActive(env);
  return false;
}

export async function declineSigning(r: Resolved, sessionOk: boolean, reason: string, meta: Meta): Promise<void> {
  requireActionable(r, sessionOk);
  const why = reason.trim().slice(0, 1000);
  if (!why) throw new SignError('reason_required');
  const ts = nowIso();
  const db = getDb();
  const res = await db.prepare("UPDATE sign_recipients SET status = 'declined', declined_at = ?, decline_reason = ?, ip = ?, user_agent = ? WHERE id = ? AND status IN ('created','sent','viewed')").run(ts, why, meta.ip.slice(0, 64), meta.ua.slice(0, 300), r.recipient.id);
  if (!res.changes) throw new SignError('state_done', 409);
  const env = await db.prepare("UPDATE sign_envelopes SET status = 'declined', declined_at = ?, updated_at = ? WHERE id = ? AND status = 'sent'").run(ts, ts, r.env.id);
  if (!env.changes) return;
  await addEvent(r.env.id, 'declined', { recipientId: r.recipient.id, ip: meta.ip, ua: meta.ua, detail: { reason: why } });
  const locale = signLocale(r.env.locale);
  const sender = await personName(r.env.created_by);
  const lines = [signCopy(locale, 'declinedLine', { name: r.recipient.name, title: r.env.title }), signCopy(locale, 'reason', { reason: why })];
  if (sender.email) await emailTo(r.env, sender.email, 'declinedSubject', lines, { title: r.env.title });
  for (const o of r.recipients.filter((x) => x.id !== r.recipient.id && x.notified_at)) await emailTo(r.env, o.email, 'declinedSubject', lines, { title: r.env.title });
  await notifySender(r.env, 'notifyDeclined', { name: r.recipient.name });
  const fresh = (await envelopeById(r.env.id))!;
  await emitSign(fresh, 'sign.envelope.declined', { declinedBy: { name: r.recipient.name, email: r.recipient.email }, reason: why });
  await runSignHooks('declined', fresh, { name: r.recipient.name, email: r.recipient.email, reason: why });
}

// ---------- Cierre ----------

const EVENT_TEXT: Record<string, string> = {
  created: 'Envelope created',
  document: 'Document uploaded',
  sent: 'Envelope sent',
  notified: 'Signing link emailed',
  reminded: 'Reminder emailed',
  link_revoked: 'Previous link revoked and a new one emailed',
  viewed: 'Opened the document',
  otp_sent: 'Verification code emailed',
  otp_verified: 'Verification code entered',
  otp_failed: 'Wrong verification code',
  consent: 'Agreed to sign electronically',
  signed: 'Signed',
  approved: 'Approved',
  declined: 'Declined',
  voided: 'Envelope voided',
  expired: 'Envelope expired',
  completed: 'Envelope completed',
  copied: 'Copied from another envelope',
};

/**
 * Cierra el sobre: reclama el cierre (compare-and-set), dibuja los campos,
 * suma el certificado, guarda el PDF final privado y recién ahí lo marca
 * completo. Si algo falla, el cron lo reintenta a los 10 minutos.
 */
export async function finalizeEnvelope(envId: string): Promise<boolean> {
  const db = getDb();
  const ts = nowIso();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const claim = await db
    .prepare("UPDATE sign_envelopes SET finalize_claimed_at = ? WHERE id = ? AND status = 'sent' AND (finalize_claimed_at IS NULL OR finalize_claimed_at < ?)")
    .run(ts, envId, stale);
  if (!claim.changes) return false;
  const env = (await envelopeById(envId))!;
  const recipients = await listRecipients(env.id);
  if (!allActed(recipients) || !env.document_ref) {
    await db.prepare('UPDATE sign_envelopes SET finalize_claimed_at = NULL WHERE id = ?').run(env.id);
    return false;
  }
  const original = await readSignFile(env.document_ref);
  if (!original) throw new SignError('file_unavailable', 500);
  const fields = await listFields(env.id);
  const byRecipient = new Map(recipients.map((r) => [r.id, r]));
  const flattened = await flattenFields(
    original,
    fields.map((f: FieldRow) => {
      const r = byRecipient.get(f.recipient_id);
      return { kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, value: f.value, image: f.kind === 'signature' ? r?.signature_image : f.kind === 'initials' ? r?.initials_image : null };
    }),
  );
  const flattenedHash = sha256Hex(flattened);
  const sender = await personName(env.created_by);
  const events = await listEvents(env.id);
  const completedAt = nowIso();
  const final = await appendCertificate(flattened, {
    envelopeId: env.id,
    title: env.title,
    documentName: env.document_name,
    pageCount: parseJson<PageBox[]>(env.pages, []).length,
    sender: `${sender.name} <${sender.email}>`,
    createdAt: env.created_at,
    sentAt: env.sent_at,
    completedAt,
    documentHash: env.document_hash ?? '',
    uploadHash: env.upload_hash,
    flattenedHash,
    recipients: recipients.map((r) => ({
      name: r.name,
      email: r.email,
      role: r.role,
      routingOrder: r.routing_order,
      status: r.role === 'cc' ? 'copy' : r.status,
      sentAt: r.notified_at,
      viewedAt: r.viewed_at,
      signedAt: r.signed_at,
      otpVerifiedAt: env.otp_required === 1 ? r.otp_verified_at : null,
      consentAt: r.consent_at,
      ip: r.ip,
      userAgent: r.user_agent,
      signatureImage: r.signature_image || null,
    })),
    events: [...events.map((e) => {
      const r = e.recipient_id ? byRecipient.get(e.recipient_id) : null;
      return { at: e.created_at, text: `${EVENT_TEXT[e.kind] ?? e.kind}${r ? ` - ${r.name} <${r.email}>` : ''}`, ip: e.ip, userAgent: e.user_agent };
    }), { at: completedAt, text: EVENT_TEXT.completed, ip: '', userAgent: '' }],
  });
  const finalHash = sha256Hex(final);
  const ref = await storeSignFile(final, 'application/pdf');
  const done = await db
    .prepare("UPDATE sign_envelopes SET status = 'completed', completed_at = ?, final_ref = ?, final_hash = ?, flattened_hash = ?, updated_at = ? WHERE id = ? AND status = 'sent'")
    .run(completedAt, ref, finalHash, flattenedHash, completedAt, env.id);
  if (!done.changes) return false;
  await db.prepare("UPDATE sign_recipients SET status = 'completed' WHERE envelope_id = ? AND role = 'cc'").run(env.id);
  await addEvent(env.id, 'completed', { detail: { finalHash, flattenedHash, documentHash: env.document_hash } });

  const locale = signLocale(env.locale);
  const attach = final.length <= 8 * 1024 * 1024 ? { name: `${(env.document_name || env.title).replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document'}-signed.pdf`, bytes: final } : undefined;
  const lines = [signCopy(locale, attach ? 'completedLine' : 'completedNoAttach', { title: env.title }), signCopy(locale, 'finalHash', { hash: finalHash })];
  const to = new Set<string>(recipients.map((r) => r.email.toLowerCase()));
  if (sender.email) to.add(sender.email.toLowerCase());
  for (const email of to) await emailTo(env, email, 'completedSubject', lines, { title: env.title }, attach);
  await notifySender(env, 'notifyCompleted');
  const fresh = (await envelopeById(env.id))!;
  await emitSign(fresh, 'sign.envelope.completed', {});
  await runSignHooks('completed', fresh, null);
  return true;
}

export async function expireEnvelope(env: EnvelopeRow): Promise<boolean> {
  const ts = nowIso();
  const res = await getDb().prepare("UPDATE sign_envelopes SET status = 'expired', expired_at = ?, updated_at = ? WHERE id = ? AND status = 'sent'").run(ts, ts, env.id);
  if (!res.changes) return false;
  await addEvent(env.id, 'expired');
  const sender = await personName(env.created_by);
  if (sender.email) await emailTo(env, sender.email, 'expiredSubject', [signCopy(signLocale(env.locale), 'expiredLine', { title: env.title })], { title: env.title });
  await notifySender(env, 'notifyExpired');
  return true;
}

// ---------- Flow ----------

/**
 * Flow: solo los flows de quien puede ver el sobre (admins y quien lo creó)
 * y tiene Sign. Los webhooks genéricos no los reciben: llevan datos personales.
 */
export async function emitSign(env: EnvelopeRow, type: 'sign.envelope.completed' | 'sign.envelope.declined', extra: Record<string, unknown>): Promise<void> {
  const recipients = await listRecipients(env.id);
  const data = {
    envelope: {
      id: env.id,
      title: env.title,
      status: env.status,
      sentAt: env.sent_at,
      completedAt: env.completed_at,
      declinedAt: env.declined_at,
      documentHash: env.document_hash,
      finalHash: env.final_hash,
      links: parseJson<EnvelopeLink[]>(env.links, []),
      href: `/app/sign/envelopes/${env.id}`,
    },
    recipients: recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, status: r.status, signedAt: r.signed_at })),
    ...extra,
  };
  await emitEventSoon(env.workspace_id, type, data, {
    audience: async (creatorId) => {
      if (!creatorId) return false;
      const access = await personAppAccess(env.workspace_id, creatorId);
      if (!access) return false;
      if (access.apps !== '*' && !access.apps.includes('sign')) return false;
      return access.role === 'owner' || access.role === 'admin' || creatorId === env.created_by;
    },
  }).catch(() => undefined);
}

// ---------- Cron ----------

/** Vence lo vencido, manda recordatorios y reintenta cierres trabados. Claim por fila en cada paso. */
export async function runSignCron(now = new Date()): Promise<{ expired: number; reminded: number; finalized: number }> {
  const db = getDb();
  const iso = now.toISOString();
  let expired = 0;
  for (const env of (await db.prepare("SELECT * FROM sign_envelopes WHERE status = 'sent' AND expires_at IS NOT NULL AND expires_at < ? LIMIT 200").all(iso)) as EnvelopeRow[]) {
    if (await expireEnvelope(env).catch(() => false)) expired++;
  }
  let reminded = 0;
  const due = (await db.prepare("SELECT * FROM sign_envelopes WHERE status = 'sent' AND reminder_days > 0 LIMIT 500").all()) as EnvelopeRow[];
  for (const env of due) {
    const recipients = await listRecipients(env.id);
    for (const r of activeRecipients(recipients, env.signing_order)) {
      const last = r.reminded_at ?? r.notified_at;
      if (!last || now.getTime() - new Date(last).getTime() < env.reminder_days * 86_400_000) continue;
      // Claim: el recordatorio sale una vez aunque corran dos crons.
      const claim = await db.prepare('UPDATE sign_recipients SET reminded_at = ? WHERE id = ? AND COALESCE(reminded_at, notified_at) = ?').run(iso, r.id, last);
      if (!claim.changes) continue;
      await notifyRecipient(env, { ...r, reminded_at: iso }, 'reminder').catch(() => undefined);
      reminded++;
    }
  }
  let finalized = 0;
  const stale = new Date(now.getTime() - 10 * 60_000).toISOString();
  for (const env of (await db.prepare("SELECT * FROM sign_envelopes WHERE status = 'sent' AND finalize_claimed_at IS NOT NULL AND finalize_claimed_at < ? LIMIT 20").all(stale)) as EnvelopeRow[]) {
    if (await finalizeEnvelope(env.id).catch(() => false)) finalized++;
  }
  return { expired, reminded, finalized };
}
