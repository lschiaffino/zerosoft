import { getChatConversation, getChatWidget, listChatWidgets } from './chat-data';
import { getDb, type ChatConversationRow, type ChatWidgetRow } from './db';
import { roleAtLeast, type TeamRole } from './teams';

/** Lo mínimo de la sesión que hace falta para decidir el acceso. */
export interface ChatAccessUser {
  id: string;
  team?: { id: string } | null;
  actingUser?: { id: string } | null;
  role?: TeamRole;
}

const isAdmin = (user: ChatAccessUser) => Boolean(user.role && roleAtLeast(user.role, 'admin'));
const person = (user: ChatAccessUser) => user.actingUser?.id ?? user.id;

/**
 * Permisos de Chat. Un widget es del usuario (workspace personal) o del team
 * activo. Encima, cada bandeja (widget) puede ser restringida: solo la ven los
 * admins y las personas de su lista (chat_widget_access). Toda ruta y página
 * pasa por acá o por listAccessibleChatWidgets.
 */

function inWorkspace(widget: ChatWidgetRow, user: ChatAccessUser): boolean {
  if (widget.user_id === user.id) return true;
  return Boolean(widget.team_id && user.team?.id === widget.team_id);
}

export async function listWidgetAccess(widgetId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare('SELECT user_id FROM chat_widget_access WHERE widget_id = ?')
    .all(widgetId)) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** Reemplaza quién entra a la bandeja. `restricted` false la abre a todo el workspace. */
export async function setWidgetAccess(widgetId: string, restricted: boolean, userIds: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('UPDATE chat_widgets SET restricted = ?, updated_at = ? WHERE id = ?').run(restricted ? 1 : 0, new Date().toISOString(), widgetId);
  await db.prepare('DELETE FROM chat_widget_access WHERE widget_id = ?').run(widgetId);
  for (const id of new Set(userIds)) {
    await db.prepare('INSERT OR IGNORE INTO chat_widget_access (widget_id, user_id) VALUES (?, ?)').run(widgetId, id);
  }
}

/** La persona puede ver la bandeja. */
export async function canAccessWidget(widget: ChatWidgetRow | null | undefined, user: ChatAccessUser): Promise<boolean> {
  if (!widget || !inWorkspace(widget, user)) return false;
  if (Number(widget.restricted ?? 0) !== 1 || isAdmin(user)) return true;
  const row = await getDb()
    .prepare('SELECT 1 AS ok FROM chat_widget_access WHERE widget_id = ? AND user_id = ?')
    .get(widget.id, person(user));
  return Boolean(row);
}

/** Los widgets del workspace que esta persona puede ver. */
export async function listAccessibleChatWidgets(user: ChatAccessUser): Promise<ChatWidgetRow[]> {
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  if (isAdmin(user) || !widgets.some((w) => Number(w.restricted ?? 0) === 1)) return widgets;
  const mine = new Set(
    ((await getDb().prepare('SELECT widget_id FROM chat_widget_access WHERE user_id = ?').all(person(user))) as Array<{ widget_id: string }>).map((r) => r.widget_id),
  );
  return widgets.filter((w) => Number(w.restricted ?? 0) !== 1 || mine.has(w.id));
}

/** Filtra una lista de agentes a los que pueden atender la bandeja (para reglas y round robin). */
export async function agentsWithWidgetAccess<T extends { id: string }>(widget: ChatWidgetRow, agents: T[]): Promise<T[]> {
  if (Number(widget.restricted ?? 0) !== 1) return agents;
  const allowed = new Set(await listWidgetAccess(widget.id));
  return agents.filter((a) => allowed.has(a.id) || a.id === widget.user_id);
}

/** Conversación accesible para el agente logueado (vía su widget). */
export async function canAccessConversation(
  conversationId: string,
  user: ChatAccessUser,
): Promise<{ ok: boolean; conversation: ChatConversationRow | null }> {
  const conversation = await getChatConversation(conversationId);
  if (!conversation) return { ok: false, conversation: null };
  const widget = await getChatWidget(conversation.widget_id);
  if (!(await canAccessWidget(widget, user))) return { ok: false, conversation: null };
  return { ok: true, conversation };
}
