/**
 * Sign: tipos y reglas puras (sin base), para que los tests las prueben solas.
 *
 * - Orden de firma: los destinatarios que firman o aprueban se agrupan por
 *   `routing_order`; en orden secuencial actúa el grupo más bajo pendiente
 *   (los del mismo número, en paralelo); en paralelo, todos a la vez. Los CC
 *   no actúan: reciben la copia firmada.
 * - Aislamiento de campos: un destinatario solo completa los suyos. Un id de
 *   campo ajeno en el envío es un error (403), no se ignora.
 * - Inmutable después de enviar: cualquier cambio pide anular el sobre y
 *   armar uno nuevo (copia).
 */
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'crypto';

export type EnvelopeStatus = 'draft' | 'sent' | 'completed' | 'declined' | 'voided' | 'expired';
export type RecipientRole = 'signer' | 'approver' | 'cc';
export type RecipientStatus = 'created' | 'sent' | 'viewed' | 'signed' | 'approved' | 'declined' | 'completed';
export type FieldKind = 'signature' | 'initials' | 'date' | 'name' | 'email' | 'text' | 'checkbox' | 'dropdown';
export type SigningOrder = 'sequential' | 'parallel';

export const FIELD_KINDS: FieldKind[] = ['signature', 'initials', 'date', 'name', 'email', 'text', 'checkbox', 'dropdown'];
export const RECIPIENT_ROLES: RecipientRole[] = ['signer', 'approver', 'cc'];
/** Campos que completa el servidor (nombre, email y fecha del destinatario). */
export const AUTO_FIELDS: FieldKind[] = ['date', 'name', 'email'];

export class SignError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface SignActor {
  /** Workspace (id del owner). */
  ws: string;
  /** Persona real. */
  person: string;
  admin: boolean;
  email: string;
  name: string;
}

export interface RecipientLike {
  id: string;
  role: RecipientRole;
  routing_order: number;
  status: RecipientStatus;
}

export interface FieldLike {
  id: string;
  recipient_id: string;
  kind: FieldKind;
  required: number | boolean;
  options?: string | string[];
}

export const acted = (r: Pick<RecipientLike, 'status'>) => r.status === 'signed' || r.status === 'approved';
const acts = (r: Pick<RecipientLike, 'role'>) => r.role === 'signer' || r.role === 'approver';

/** Los que tienen que actuar ahora (vacío si ya actuaron todos). */
export function activeRecipients<R extends RecipientLike>(recipients: R[], order: SigningOrder): R[] {
  const pending = recipients.filter((r) => acts(r) && !acted(r));
  if (order === 'parallel' || !pending.length) return pending;
  const min = Math.min(...pending.map((r) => r.routing_order));
  return pending.filter((r) => r.routing_order === min);
}

/** ¿Le toca a este destinatario? */
export function isRecipientTurn<R extends RecipientLike>(recipient: R, recipients: R[], order: SigningOrder): boolean {
  return activeRecipients(recipients, order).some((r) => r.id === recipient.id);
}

/** ¿Firmaron y aprobaron todos los que tenían que hacerlo? */
export function allActed(recipients: RecipientLike[]): boolean {
  const need = recipients.filter(acts);
  return need.length > 0 && need.every(acted);
}

/** Solo un borrador se cambia. Enviado, se anula y se copia. */
export function assertEditable(env: { status: string }): void {
  if (env.status !== 'draft') throw new SignError('envelope_locked', 409);
}

/** Quién ve un sobre en la app: quien lo creó, los admins y los destinatarios que son del workspace (por email). */
export function canSeeEnvelope(actor: Pick<SignActor, 'person' | 'admin' | 'email'>, env: { created_by: string }, recipientEmails: string[] = []): boolean {
  if (actor.admin || env.created_by === actor.person) return true;
  const me = actor.email.trim().toLowerCase();
  return Boolean(me) && recipientEmails.some((e) => e.trim().toLowerCase() === me);
}

/** Quién lo gestiona (editar, enviar, anular, recordar, descargar el original): quien lo creó y los admins. */
export function canManageEnvelope(actor: Pick<SignActor, 'person' | 'admin'>, env: { created_by: string }): boolean {
  return actor.admin || env.created_by === actor.person;
}

export function parseOptions(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export interface SubmissionResult {
  /** fieldId → valor a guardar (los automáticos los completa quien llama). */
  values: Map<string, string>;
  needsSignature: boolean;
  needsInitials: boolean;
}

/**
 * Valida lo que manda un destinatario: solo sus campos, los obligatorios
 * completos y cada valor con la forma de su tipo. Firma e iniciales quedan
 * marcadas: la imagen viaja aparte.
 */
export function validateSubmission(fields: FieldLike[], recipientId: string, input: Record<string, unknown>): SubmissionResult {
  const mine = new Map(fields.filter((f) => f.recipient_id === recipientId).map((f) => [f.id, f]));
  for (const id of Object.keys(input)) {
    if (!mine.has(id)) throw new SignError(fields.some((f) => f.id === id) ? 'field_not_yours' : 'field_unknown', 403, { field: id });
  }
  const values = new Map<string, string>();
  const missing: string[] = [];
  let needsSignature = false;
  let needsInitials = false;
  for (const f of mine.values()) {
    const raw = input[f.id];
    const required = Boolean(Number(f.required));
    switch (f.kind) {
      case 'signature':
      case 'initials': {
        // Un campo de firma obligatorio siempre se firma; uno opcional, solo si se marcó.
        const on = required || raw === true || raw === 'signed';
        if (on) {
          values.set(f.id, 'signed');
          if (f.kind === 'signature') needsSignature = true;
          else needsInitials = true;
        }
        break;
      }
      case 'date':
      case 'name':
      case 'email':
        values.set(f.id, '');
        break;
      case 'checkbox': {
        const on = raw === true || raw === 'true';
        if (raw !== undefined && typeof raw !== 'boolean' && raw !== 'true' && raw !== 'false') throw new SignError('invalid_value', 400, { field: f.id });
        if (required && !on) missing.push(f.id);
        values.set(f.id, on ? 'true' : 'false');
        break;
      }
      case 'dropdown': {
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (v && !parseOptions(f.options).includes(v)) throw new SignError('invalid_value', 400, { field: f.id });
        if (required && !v) missing.push(f.id);
        if (v) values.set(f.id, v);
        break;
      }
      case 'text': {
        if (raw !== undefined && typeof raw !== 'string') throw new SignError('invalid_value', 400, { field: f.id });
        const v = typeof raw === 'string' ? raw.trim().slice(0, 500) : '';
        if (required && !v) missing.push(f.id);
        if (v) values.set(f.id, v);
        break;
      }
    }
  }
  if (missing.length) throw new SignError('required_missing', 400, { fields: missing });
  return { values, needsSignature, needsInitials };
}

/** Caja de un campo en fracciones de la página (0..1), dentro de la página y con un mínimo. */
export function clampBox(b: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const w = Math.min(1, Math.max(0.01, n(b.w)));
  const h = Math.min(1, Math.max(0.005, n(b.h)));
  const x = Math.min(1 - w, Math.max(0, n(b.x)));
  const y = Math.min(1 - h, Math.max(0, n(b.y)));
  return { x, y, w, h };
}

export function isEmail(s: string): boolean {
  return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s) && s.length <= 254;
}

// ---------- Tokens de firma ----------

/**
 * El link de cada destinatario es un HMAC de (id, nonce) con la clave de
 * Sign: el servidor lo puede volver a armar para un recordatorio sin
 * guardarlo, y en la base queda solo su SHA-256 (con la base sola no se
 * firma nada). Revocar es cambiar el nonce.
 */
function tokenKey(): Buffer {
  const own = process.env.SIGN_TOKEN_KEY?.trim();
  if (own) return createHash('sha256').update(own).digest();
  const base = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-encryption-key';
  return Buffer.from(hkdfSync('sha256', base, 'zerosoft', 'sign-tokens', 32));
}

export function signingToken(recipientId: string, nonce: string): string {
  return createHmac('sha256', tokenKey()).update(`${recipientId}:${nonce}`).digest('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// ---------- Código por email (OTP) ----------

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
/** Envíos de código por destinatario en OTP_SEND_WINDOW_SEC. */
export const OTP_SEND_LIMIT = 3;
export const OTP_SEND_WINDOW_SEC = 15 * 60;
/** Intentos de verificación por IP en OTP_VERIFY_WINDOW_SEC (además del tope por código). */
export const OTP_VERIFY_IP_LIMIT = 20;
export const OTP_VERIFY_WINDOW_SEC = 15 * 60;

export function hashOtp(recipientId: string, code: string): string {
  return createHmac('sha256', tokenKey()).update(`otp:${recipientId}:${code}`).digest('hex');
}

export type OtpCheck = 'ok' | 'none' | 'expired' | 'locked' | 'wrong';

/** Resultado de comparar un código con el guardado (sin tocar la base). */
export function checkOtp(
  row: { id: string; otp_hash: string | null; otp_expires_at: string | null; otp_attempts: number },
  code: string,
  now = new Date(),
): OtpCheck {
  if (!row.otp_hash || !row.otp_expires_at) return 'none';
  if (row.otp_attempts >= OTP_MAX_ATTEMPTS) return 'locked';
  if (new Date(row.otp_expires_at).getTime() < now.getTime()) return 'expired';
  if (!/^\d{6}$/.test(code)) return 'wrong';
  const a = Buffer.from(hashOtp(row.id, code), 'hex');
  const b = Buffer.from(row.otp_hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'wrong';
}

/** "ana@empresa.com" → "a**@e*****.com" para mostrar a dónde se mandó el código. */
export function maskEmail(email: string): string {
  const [user, domain = ''] = email.split('@');
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const m = (s: string) => (s.length <= 1 ? s : s[0] + '*'.repeat(Math.min(s.length - 1, 6)));
  return `${m(user)}@${m(host)}${tld}`;
}
