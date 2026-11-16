/**
 * Permisos más finos que el workspace para /api/files (columna `scope` de
 * stored_files). Cada prefijo chequea que la persona de la sesión pueda ver
 * ese objeto puntual. Un prefijo que no está acá no deja pasar a nadie.
 * Server-only.
 */
import type { SessionUser } from '../session';

type Check = (user: SessionUser, id: string) => Promise<boolean>;

const CHECKS: Record<string, Check> = {
  /** Foto de un chat de Lines: quien ve ese chat (líneas y chats restringidos). */
  'groups-chat': async (user, id) => {
    const { groupsViewer, canSeeChat } = await import('../groups-access');
    const viewer = await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role);
    return canSeeChat(viewer, id);
  },
  /** Foto de una persona de la libreta de una línea de Lines: quien ve esa línea. */
  'groups-number': async (user, id) => {
    const { groupsViewer, canSeeNumber } = await import('../groups-access');
    const viewer = await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role);
    return canSeeNumber(viewer, id);
  },
  /** Adjuntos de una conversación de Chat: quien ve el widget (los restringidos, solo admins y su lista). */
  'chat-widget': async (user, id) => {
    const { getChatWidget } = await import('../chat-data');
    const { canAccessWidget } = await import('../chat-access');
    return canAccessWidget(await getChatWidget(id), user);
  },
};

export async function scopeAllows(scope: string, user: SessionUser): Promise<boolean> {
  const i = scope.indexOf(':');
  if (i <= 0) return false;
  const check = CHECKS[scope.slice(0, i)];
  if (!check) return false;
  try {
    return await check(user, scope.slice(i + 1));
  } catch {
    return false;
  }
}
