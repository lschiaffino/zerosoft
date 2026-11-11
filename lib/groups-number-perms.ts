/**
 * Lines: quién conecta y administra cada línea (número de WhatsApp).
 *
 * - Owner y admins: todas las líneas del workspace, como siempre.
 * - Un member con la capacidad `lines.numbers.manage` (lib/capabilities.ts):
 *   agrega líneas nuevas y administra solo las suyas (las que tiene como
 *   dueño): conectar con QR, reconectar, renombrar, credenciales, traer
 *   grupos, importar historial, desconectar, borrar y con quién la comparte.
 *   Cambiar el dueño de una línea sigue siendo de admins.
 * - Una línea que agrega un member nace a su nombre y privada ('restricted'):
 *   la ven él y los admins, y nadie más hasta que la comparta.
 * - Que te compartan una línea te deja ver sus chats; no te deja administrarla.
 * - La capacidad no da acceso de lectura: un member con ella sigue viendo
 *   solo las líneas que le dejan ver (groups-access.ts).
 *
 * La sesión trae el rol y las capacidades leídos de la base en cada pedido:
 * quitar la capacidad corta el acceso en el siguiente pedido.
 */
import { can } from './permissions';
import type { SessionUser } from './session';

export interface NumberManager {
  /** Persona real que actúa. */
  me: string;
  /** Owner o admin: administra todas. */
  isAdmin: boolean;
  /** Puede agregar líneas (admins, o members con la capacidad). */
  canAdd: boolean;
}

export function numberManager(user: Pick<SessionUser, 'id' | 'role' | 'apps' | 'caps' | 'actingUser'>): NumberManager {
  const isAdmin = can(user, 'workspace.edit');
  return { me: user.actingUser?.id ?? user.id, isAdmin, canAdd: isAdmin || can(user, 'lines.numbers.manage') };
}

/** ¿Administra esta línea? Admins, todas; un member con la capacidad, las que son suyas. */
export function canManageNumber(m: NumberManager, row: { owner_id?: string | null } | { ownerId?: string | null }): boolean {
  if (m.isAdmin) return true;
  if (!m.canAdd) return false;
  const owner = 'owner_id' in row ? row.owner_id : 'ownerId' in row ? row.ownerId : null;
  return Boolean(owner) && owner === m.me;
}

/** La lista con `canManage` por línea, para la pantalla. */
export function withManage<T extends { ownerId: string | null }>(m: NumberManager, list: T[]): Array<T & { canManage: boolean }> {
  return list.map((n) => ({ ...n, canManage: canManageNumber(m, n) }));
}
