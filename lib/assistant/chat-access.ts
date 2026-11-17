/**
 * Permiso para que el asistente lea el texto de los chats de la persona
 * (Inbox o Lines). Sin permiso, las herramientas solo ven datos de la lista
 * (nombre, desde cuándo espera, no leídos), nunca el texto de un mensaje.
 *
 * - "Esta vez": vale para la charla del asistente donde se dio.
 * - "Siempre": hasta que la persona lo saque en Ajustes › Cuenta.
 *
 * Es por persona y por workspace: el permiso de una persona nunca deja leer
 * chats de otra (Inbox es personal; Lines sigue con el acceso por línea y
 * por chat de lib/groups-access.ts).
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export const CHAT_APPS = ['inbox', 'lines'] as const;
export type ChatApp = (typeof CHAT_APPS)[number];
export type GrantScope = 'once' | 'always';

export interface ChatGrantOwner {
  workspaceId: string;
  personId: string;
}

/** ¿Puede leer los chats de esta app en esta charla? */
export async function hasChatGrant(owner: ChatGrantOwner, app: ChatApp, conversationId: string | null | undefined): Promise<boolean> {
  const row = await getDb()
    .prepare(
      "SELECT 1 AS x FROM assistant_chat_grants WHERE workspace_id = ? AND person_id = ? AND app = ? AND (conversation_id = '' OR conversation_id = ?) LIMIT 1",
    )
    .get(owner.workspaceId, owner.personId, app, conversationId ?? '');
  return Boolean(row);
}

export async function grantChatAccess(owner: ChatGrantOwner, app: ChatApp, scope: GrantScope, conversationId: string | null): Promise<void> {
  const conv = scope === 'always' ? '' : (conversationId ?? '');
  if (scope === 'once' && !conv) throw new Error('conversation_required');
  await getDb()
    .prepare('INSERT OR IGNORE INTO assistant_chat_grants (id, workspace_id, person_id, app, conversation_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(`acg_${randomUUID().replace(/-/g, '').slice(0, 20)}`, owner.workspaceId, owner.personId, app, conv, new Date().toISOString());
}

/** Lo que dejó "siempre" (para Ajustes). */
export async function listAlwaysGrants(owner: ChatGrantOwner): Promise<Array<{ app: ChatApp; createdAt: string }>> {
  const rows = (await getDb()
    .prepare("SELECT app, created_at FROM assistant_chat_grants WHERE workspace_id = ? AND person_id = ? AND conversation_id = '' ORDER BY app")
    .all(owner.workspaceId, owner.personId)) as Array<{ app: string; created_at: string }>;
  return rows.filter((r): r is { app: ChatApp; created_at: string } => (CHAT_APPS as readonly string[]).includes(r.app)).map((r) => ({ app: r.app, createdAt: r.created_at }));
}

/** Saca el permiso de una app: el de siempre y los de cada charla. */
export async function revokeChatAccess(owner: ChatGrantOwner, app: ChatApp): Promise<void> {
  await getDb().prepare('DELETE FROM assistant_chat_grants WHERE workspace_id = ? AND person_id = ? AND app = ?').run(owner.workspaceId, owner.personId, app);
}
