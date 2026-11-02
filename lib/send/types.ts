/**
 * Send: tipos y reglas puras (sin base), para que los tests las prueben solas.
 *
 * Reglas que importan:
 * - Orden de los pasos de un link: código de acceso, email, verificación,
 *   lista de permitidos o bloqueados, acuerdo. Primero el código: sin él, nadie
 *   manda mails de verificación ni prueba emails contra la lista.
 * - Un email escrito es declarado. Solo un código recibido lo verifica. Una lista
 *   de permitidos exige verificación: sin ella, alcanza con escribir un email de
 *   la lista.
 * - El tiempo por página lo mide el navegador con la pestaña visible; el servidor
 *   no acepta más segundos que los que pasaron entre dos avisos.
 */
import { createHash, randomBytes } from 'crypto';

export type VersionKind = 'pdf' | 'word' | 'slides' | 'video' | 'docs';
export type VersionStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type AccessMode = 'none' | 'allow' | 'block';
export type GateStep = 'passcode' | 'email' | 'verify' | 'denied' | 'nda';

/** Parte de subida y de lectura: entra en una función de Vercel (corta el cuerpo en 4,5 MB). */
export const PART_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_PAGES = 500;
export const MAX_ACCESS_ENTRIES = 500;
export const SESSION_DAYS = 14;
export const CODE_MINUTES = 15;
export const CODE_ATTEMPTS = 5;
/** Sin aviso durante este tiempo, el regreso cuenta como una visita nueva. */
export const VISIT_GAP_MS = 30 * 60_000;
/** "Leyendo ahora": hubo un aviso en este rango. */
export const LIVE_WINDOW_MS = 25_000;
/** Primer aviso: lo manda el navegador tras 3 s visibles. Antes de eso no hay visita. */
export const MIN_FIRST_SECONDS = 2;
export const MAX_DELTA_PER_PING = 120;
/** Video: partes de hasta 10 s, y no más de 120 tramos por video. */
export const VIDEO_BUCKET_SEC = 10;
export const MAX_VIDEO_BUCKETS = 120;

export class SendError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export interface SendActor {
  /** Workspace (id del owner). */
  ws: string;
  /** Persona real. */
  person: string;
  admin: boolean;
  email: string;
  name: string;
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('base64url')}`;
export const nowIso = () => new Date().toISOString();

// ---------- Tokens ----------

/** Link: 192 bits al azar en base64url (32 caracteres). */
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const hashCode = (sessionId: string, code: string) => createHash('sha256').update(`${sessionId}:${code}`).digest('hex');

export function newCode(): string {
  // Seis dígitos parejos: el rango múltiplo de 10^6 evita sesgo.
  const max = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  let n = 0;
  do {
    n = randomBytes(4).readUInt32BE(0);
  } while (n >= max);
  return String(n % 1_000_000).padStart(6, '0');
}

export const sessionCookie = (linkId: string) => `zs_send_${linkId.replace(/[^\w]/g, '')}`;

// ---------- Emails y listas ----------

const EMAIL_RE = /^[^\s@<>"',;]{1,64}@[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/;

/** Una entrada de la lista: un email, o un dominio ("acme.com", "@acme.com", "*.acme.com"). */
export function normalizeAccessEntry(value: string): string | null {
  const s = value.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@') && !s.startsWith('@')) return normalizeEmail(s);
  const domain = s.replace(/^\*\./, '').replace(/^@/, '');
  return DOMAIN_RE.test(domain) ? domain : null;
}

export function cleanAccessList(values: readonly string[]): { entries: string[]; invalid: string[] } {
  const entries = new Set<string>();
  const invalid: string[] = [];
  for (const raw of values) {
    for (const piece of raw.split(/[\s,;]+/)) {
      if (!piece) continue;
      const e = normalizeAccessEntry(piece);
      if (e) entries.add(e);
      else invalid.push(piece);
    }
  }
  return { entries: [...entries].slice(0, MAX_ACCESS_ENTRIES), invalid };
}

/** ¿El email coincide con la lista? Un dominio vale para sus subdominios. */
export function matchesAccessList(entries: readonly string[], email: string): boolean {
  const at = email.lastIndexOf('@');
  const domain = email.slice(at + 1);
  return entries.some((e) => (e.includes('@') ? e === email : domain === e || domain.endsWith(`.${e}`)));
}

export function accessAllowed(mode: AccessMode, entries: readonly string[], email: string | null): boolean {
  if (mode === 'none') return true;
  if (!email) return false;
  const hit = matchesAccessList(entries, email);
  return mode === 'allow' ? hit : !hit;
}

// ---------- Pasos del link ----------

export interface LinkRules {
  require_email: number | boolean;
  verify_email: number | boolean;
  passcode_hash: string | null;
  access_mode: string;
  access_list: string;
  watermark: number | boolean;
  nda_template_id: string | null;
}

export interface SessionState {
  passcode_ok: number | boolean;
  email: string | null;
  email_verified: number | boolean;
  nda_signed_at: string | null;
}

export function parseAccessList(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Un watermark con el email, la lista y el acuerdo necesitan un email: se pide aunque el link no lo marque. */
export function linkNeedsEmail(l: LinkRules): boolean {
  return Boolean(l.require_email || l.verify_email || l.watermark || l.nda_template_id || l.access_mode !== 'none');
}

/** Una lista de permitidos sin verificar se esquiva escribiendo un email de la lista. */
export function linkNeedsVerify(l: LinkRules): boolean {
  return Boolean(l.verify_email || l.access_mode === 'allow');
}

/** El primer paso que falta, o null si la sesión puede ver el contenido. */
export function nextGate(l: LinkRules, s: SessionState | null): GateStep | null {
  if (l.passcode_hash && !s?.passcode_ok) return 'passcode';
  if (linkNeedsEmail(l) && !s?.email) return 'email';
  if (linkNeedsVerify(l) && !s?.email_verified) return 'verify';
  const mode = (l.access_mode === 'allow' || l.access_mode === 'block' ? l.access_mode : 'none') as AccessMode;
  if (mode !== 'none' && !accessAllowed(mode, parseAccessList(l.access_list), s?.email ?? null)) return 'denied';
  if (l.nda_template_id && !s?.nda_signed_at) return 'nda';
  return null;
}

export type LinkState = 'active' | 'disabled' | 'expired';

export function linkState(l: { disabled_at: string | null; expires_at: string | null }, now = new Date()): LinkState {
  if (l.disabled_at) return 'disabled';
  if (l.expires_at && new Date(l.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

// ---------- Tiempo y páginas ----------

/** Segundos que se aceptan de un aviso: lo que pasó desde el anterior, más un margen por la red. */
export function acceptedSeconds(claimed: number, elapsedSec: number): number {
  if (!Number.isFinite(claimed) || claimed <= 0) return 0;
  const cap = Math.min(MAX_DELTA_PER_PING, Math.max(0, elapsedSec) + 3);
  return Math.round(Math.min(claimed, cap) * 10) / 10;
}

/** Reparte el total aceptado entre las páginas informadas, sin pasarse. */
export function scaleDeltas(deltas: ReadonlyArray<{ page: number; seconds: number }>, cap: number): Array<{ page: number; seconds: number }> {
  const clean = deltas.filter((d) => Number.isInteger(d.page) && d.page >= 1 && Number.isFinite(d.seconds) && d.seconds > 0);
  const total = clean.reduce((n, d) => n + d.seconds, 0);
  if (total <= 0) return [];
  const f = total > cap ? cap / total : 1;
  return clean.map((d) => ({ page: d.page, seconds: Math.round(d.seconds * f * 10) / 10 })).filter((d) => d.seconds > 0);
}

export function completionPct(seen: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((seen / total) * 100));
}

export function videoBuckets(durationSec: number): { bucketSec: number; pages: number } {
  const d = Math.max(1, Math.ceil(durationSec));
  const bucketSec = Math.max(VIDEO_BUCKET_SEC, Math.ceil(d / MAX_VIDEO_BUCKETS));
  return { bucketSec, pages: Math.ceil(d / bucketSec) };
}

// ---------- Reenvíos ----------

/**
 * Un link con destinatario se abrió con otro email. En un link sin destinatario
 * (una campaña) muchos emails es lo esperado. Es un indicio: un email escrito sin
 * verificar puede ser de cualquiera.
 */
export function isForwarded(recipient: string | null, email: string | null): boolean {
  return Boolean(email && recipient && recipient.toLowerCase() !== email);
}

// ---------- Archivos ----------

export function sniffKind(head: Uint8Array, name: string, mime: string): VersionKind | null {
  const ascii = String.fromCharCode(...head.subarray(0, 12));
  const n = name.toLowerCase();
  // PDF: la firma puede venir con basura antes (hasta 1 KB, como leen los lectores).
  if (Buffer.from(head.subarray(0, 1024)).includes('%PDF-')) return 'pdf';
  if (ascii.startsWith('PK\x03\x04')) {
    if (n.endsWith('.docx')) return 'word';
    if (n.endsWith('.pptx')) return 'slides';
    return null;
  }
  const video = /^video\/(mp4|webm|quicktime)$/.test(mime) || /\.(mp4|webm|mov|m4v)$/.test(n);
  if (video && (ascii.slice(4, 8) === 'ftyp' || (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3))) return 'video';
  return null;
}

/** Tipo que el reproductor entiende, según los bytes. */
export function videoMime(head: Uint8Array): string {
  if (head[0] === 0x1a && head[1] === 0x45) return 'video/webm';
  const brand = String.fromCharCode(...head.subarray(8, 12));
  return brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
}

// ---------- Marca ----------

export function safeBrandColor(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : '';
}

export function safeHttpUrl(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return '';
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
}

// ---------- Dispositivo ----------

export function deviceKind(type: string | undefined): 'mobile' | 'tablet' | 'desktop' {
  return type === 'mobile' || type === 'wearable' ? 'mobile' : type === 'tablet' ? 'tablet' : 'desktop';
}
