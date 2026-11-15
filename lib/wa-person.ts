/**
 * Una persona de un grupo de WhatsApp, como la ficha "Info del contacto" que
 * abre WhatsApp al tocar la foto o el nombre de quien escribió: lo comparten
 * Inbox (lib/inbox/wa-meta.ts personCard) y Lines (lib/groups.ts
 * personCard), y la dibuja components/groups/wa/ContactSheet.tsx.
 * También la regla de "Responder en privado". Sin dependencias de servidor.
 */

export type PersonRole = 'member' | 'admin' | 'superadmin';

export interface WaPersonCard {
  /** Dígitos del teléfono ('' si quien mira no puede verlo). */
  phone: string;
  /** Nombre para mostrar ('' si no se conoce: se muestra el teléfono). */
  name: string;
  /** "Info" (estado) de WhatsApp. */
  about: string;
  /** Foto de perfil ('' sin foto: iniciales). */
  picture: string;
  /** Rol en este grupo (null si ya no está en el grupo). */
  role: PersonRole | null;
  /** Es la cuenta misma (no se le escribe ni se la bloquea). */
  me: boolean;
  /** El chat 1:1 con la persona en esta cuenta, si existe. */
  dm: { id: string; muted: boolean; blocked: boolean } | null;
  /** Lo compartido en el chat 1:1 (todo en 0 sin chat). */
  shared: { media: number; docs: number; links: number; starred: number };
  /** Otros grupos de la cuenta donde está (sin este). */
  commonGroups: Array<{ id: string; name: string; picture: string }>;
  /** Se puede bloquear desde acá (hay chat 1:1 y el proveedor lo deja). */
  canBlock: boolean;
}

/** Total de "Archivos, enlaces y documentos" (como lo cuenta WhatsApp). */
export function sharedTotal(card: Pick<WaPersonCard, 'shared'>): number {
  return card.shared.media + card.shared.docs + card.shared.links;
}

/**
 * "Responder en privado" (como WhatsApp): solo a un mensaje de otra persona en
 * un grupo, que todavía existe y tiene a quién escribirle (su teléfono). La
 * respuesta va al chat 1:1 con esa persona, en la misma cuenta.
 */
export function canReplyPrivately(m: { group: boolean; fromMe: boolean; deleted: boolean; senderPhone: string; note?: boolean; myPhone?: string }): boolean {
  if (!m.group || m.fromMe || m.deleted || m.note) return false;
  if (!/^\d{8,15}$/.test(m.senderPhone)) return false;
  return !m.myPhone || m.senderPhone !== m.myPhone;
}

/**
 * Del lado del servidor: el mensaje citado en una respuesta privada tiene que
 * ser de un grupo de la misma cuenta, de la persona del chat 1:1 al que se
 * manda (no se cita en privado lo de otro, ni lo propio, ni entre cuentas).
 */
export function privateQuoteAllowed(
  quoted: { accountId: string; groupKind: 'group' | 'dm'; fromMe: boolean; senderPhone: string; deleted: boolean },
  target: { accountId: string; kind: 'group' | 'dm'; phone: string },
): boolean {
  if (target.kind !== 'dm' || quoted.groupKind !== 'group') return false;
  if (quoted.accountId !== target.accountId) return false;
  if (quoted.fromMe || quoted.deleted) return false;
  return !!target.phone && quoted.senderPhone === target.phone;
}
