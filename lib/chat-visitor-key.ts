/**
 * Chat — la clave del visitante en las rutas públicas del widget (visitorId).
 *
 * Es el único secreto que separa a un visitante de otro: quien la conoce lee
 * su conversación. Por eso:
 * - El servidor la emite (POST /api/chat/visitor): `v1.<16 bytes aleatorios>.<firma>`,
 *   firmada con HMAC por widget. Las claves viejas que generó el widget en el
 *   navegador (uuid) siguen andando para no cortar conversaciones abiertas.
 * - Los visitantes que no nacen de un navegador (canal email) tienen una clave
 *   reservada `mail.<uuid>` que ninguna ruta pública acepta: no se pueden
 *   adivinar ni usar desde el widget. Las de prefijo `email:` (versión previa,
 *   adivinables) también se rechazan.
 * - Solo una clave firmada por el servidor (o la de un visitante que ya
 *   escribió) cuenta vistas y respuestas de mensajes salientes, así nadie
 *   infla los números con ids inventados.
 * Server-only.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

export const VISITOR_KEY_MAX = 128;
const RESERVED = ['mail.', 'email:'];
const SIGNED = /^v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})$/;

function key(): string {
  return process.env.CHAT_VISITOR_SECRET || process.env.NEXTAUTH_SECRET || 'zerosoft-chat-visitor';
}

function sign(widgetId: string, rand: string): string {
  return createHmac('sha256', key()).update(`visitor:${widgetId}:${rand}`).digest('base64url').slice(0, 22);
}

/** Clave reservada: la de un visitante del canal email (o del formato viejo adivinable). */
export function isReservedVisitorKey(raw: string): boolean {
  const k = raw.trim().toLowerCase();
  return RESERVED.some((p) => k.startsWith(p));
}

/** La clave de un visitante del canal email: aleatoria y fuera del alcance de las rutas públicas. */
export function emailVisitorKey(): string {
  return `mail.${randomUUID()}`;
}

/** visitorId aceptable en una ruta pública, o null (vacío, largo, con control o reservado). */
export function cleanPublicVisitorKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim();
  if (!k || k.length > VISITOR_KEY_MAX) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(k)) return null;
  if (isReservedVisitorKey(k)) return null;
  return k;
}

export function issueVisitorToken(widgetId: string): string {
  const rand = randomBytes(16).toString('base64url');
  return `v1.${rand}.${sign(widgetId, rand)}`;
}

/** La clave la emitió este servidor para este widget. */
export function isSignedVisitorToken(widgetId: string, raw: string): boolean {
  const m = SIGNED.exec(raw);
  if (!m) return false;
  const expected = Buffer.from(sign(widgetId, m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
