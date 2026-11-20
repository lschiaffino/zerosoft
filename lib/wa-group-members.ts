/**
 * Miembros de un grupo de WhatsApp (Lines e Inbox): lo que comparten las dos
 * apps para agregar, quitar y cambiar admins.
 *
 * - `memberRef`: referencia opaca de un miembro para quien tiene los teléfonos
 *   ocultos (invitados, roles enmascarados): puede hacerlo admin o quitarlo sin
 *   ver su número. Es un HMAC con el secreto del servidor, así no se puede
 *   adivinar el teléfono probando números.
 * - `participantError`: el código que dio WhatsApp para una persona → uno de
 *   pocos motivos que la pantalla sabe explicar.
 */
import { createHmac } from 'crypto';

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'zerosoft-members';
}

export function memberRef(chatId: string, phone: string): string {
  return `member:${createHmac('sha256', secret()).update(`group-member:${chatId}:${phone}`).digest('hex').slice(0, 24)}`;
}

/** Motivos por persona que la pantalla explica (groups.wa.members.errors.*). */
export type ParticipantErrorReason =
  | 'privacy'
  | 'already_member'
  | 'recently_left'
  | 'not_member'
  | 'not_on_whatsapp'
  | 'not_group_admin'
  | 'own_number'
  | 'not_found'
  | 'invalid_phone'
  | 'failed';

/**
 * WhatsApp responde por participante con un status: 403 (su privacidad no deja
 * que lo agreguen: hay que mandarle el link), 409 (ya está), 408 (salió hace
 * poco y no se lo puede volver a agregar todavía), 404/400 (no tiene WhatsApp),
 * 401 (la cuenta no es admin del grupo).
 */
export function participantError(code: string | undefined | null): ParticipantErrorReason {
  const c = String(code ?? '');
  if (c === 'whatsapp_403' || c === 'privacy') return 'privacy';
  if (c === 'whatsapp_409' || c === 'already_member') return 'already_member';
  if (c === 'whatsapp_408' || c === 'recently_left') return 'recently_left';
  if (c === 'not_member') return 'not_member';
  if (c === 'whatsapp_404' || c === 'whatsapp_400' || c === 'not_on_whatsapp') return 'not_on_whatsapp';
  if (c === 'whatsapp_401' || c === 'not_group_admin' || c === 'forbidden') return 'not_group_admin';
  if (c === 'own_number' || c === 'not_found' || c === 'invalid_phone') return c;
  return 'failed';
}

/** Lo que vuelve por persona: `key` es lo que mandó la pantalla (el teléfono escrito o la referencia). */
export interface MemberTargetResult {
  key: string;
  /** Teléfono (enmascarado para quien no ve los números). */
  phone: string;
  ok: boolean;
  error?: ParticipantErrorReason;
}

export const MEMBER_ACTIONS = ['add', 'remove', 'promote', 'demote'] as const;
export type MemberAction = (typeof MEMBER_ACTIONS)[number];
/** Tope de personas por pedido (el panel agrega "varias a la vez"). */
export const MAX_MEMBER_TARGETS = 50;
