import { applyAssignmentRules, getChatConversation, getChatWidget, listChatAgents, listChatWidgets } from './chat-data';
import { getDb, type ChatConversationRow, type ChatWidgetRow } from './db';
import { roleAtLeast, type TeamRole } from './teams';
import { isRestricted, personCanSeeWidget, restrictedAudience } from './chat-audience';
import { getWorkspaceConversation, workspaceWidgetIds } from './chat-api';
import type { ApiKeyAuth } from './api-auth';

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

/**
 * Reemplaza quién entra a la bandeja. Solo quien PIERDE el acceso con este
 * cambio deja de tener asignación, seguimiento, presencia y avisos de esa
 * bandeja (traen texto y nombre del visitante); guardar sin cambios no toca a
 * nadie. Las abiertas que se quedan sin asignado se reparten en el momento.
 */
export async function setWidgetAccess(widgetId: string, restricted: boolean, userIds: string[]): Promise<{ lost: number; reassigned: number }> {
  const db = getDb();
  const before = await getChatWidget(widgetId);
  if (!before) return { lost: 0, reassigned: 0 };
  const previous = isRestricted(before) ? await restrictedAudience(before) : null;
  await db.prepare('UPDATE chat_widgets SET restricted = ?, updated_at = ? WHERE id = ?').run(restricted ? 1 : 0, new Date().toISOString(), widgetId);
  await db.prepare('DELETE FROM chat_widget_access WHERE widget_id = ?').run(widgetId);
  for (const id of new Set(userIds)) {
    await db.prepare('INSERT OR IGNORE INTO chat_widget_access (widget_id, user_id) VALUES (?, ?)').run(widgetId, id);
  }
  if (!restricted) return { lost: 0, reassigned: 0 };
  const allowed = await restrictedAudience({ ...before, restricted: 1 });
  const agents = await listChatAgents(before.user_id, before.team_id);
  // Antes era abierta: pierden quienes no están en la nueva lista, incluido quien ya no sea agente.
  const wereIn = previous ? [...previous] : null;
  const candidates = wereIn ?? [
    ...new Set([
      ...agents.map((a) => a.id),
      ...((await db.prepare('SELECT DISTINCT user_id FROM chat_conversation_followers WHERE conversation_id IN (SELECT id FROM chat_conversations WHERE widget_id = ?)').all(widgetId)) as Array<{ user_id: string }>).map((r) => r.user_id),
      ...((await db.prepare('SELECT DISTINCT assigned_to AS user_id FROM chat_conversations WHERE widget_id = ? AND assigned_to IS NOT NULL').all(widgetId)) as Array<{ user_id: string }>).map((r) => r.user_id),
      ...((await db
        .prepare("SELECT DISTINCT user_id FROM notifications WHERE source_type = 'chat_conversation' AND source_id IN (SELECT id FROM chat_conversations WHERE widget_id = ?)")
        .all(widgetId)) as Array<{ user_id: string }>).map((r) => r.user_id),
    ]),
  ];
  const lost = candidates.filter((id) => !allowed.has(id));
  if (lost.length === 0) return { lost: 0, reassigned: 0 };
  const marks = lost.map(() => '?').join(', ');
  const conversations = 'SELECT id FROM chat_conversations WHERE widget_id = ?';
  const orphaned = (await db
    .prepare(`SELECT id FROM chat_conversations WHERE widget_id = ? AND status IN ('open', 'pending') AND assigned_to IN (${marks}) LIMIT 500`)
    .all(widgetId, ...lost)) as Array<{ id: string }>;
  await db.prepare(`UPDATE chat_conversations SET assigned_to = NULL WHERE widget_id = ? AND assigned_to IN (${marks})`).run(widgetId, ...lost);
  await db.prepare(`DELETE FROM chat_conversation_followers WHERE conversation_id IN (${conversations}) AND user_id IN (${marks})`).run(widgetId, ...lost);
  await db.prepare(`DELETE FROM chat_presence WHERE conversation_id IN (${conversations}) AND user_id IN (${marks})`).run(widgetId, ...lost);
  await db.prepare(`DELETE FROM notifications WHERE source_type = 'chat_conversation' AND source_id IN (${conversations}) AND user_id IN (${marks})`).run(widgetId, ...lost);
  let reassigned = 0;
  for (const c of orphaned) {
    const last = (await db
      .prepare("SELECT body FROM chat_messages WHERE conversation_id = ? AND sender_type = 'visitor' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(c.id)) as { body: string } | undefined;
    if (await applyAssignmentRules(widgetId, c.id, last?.body ?? '', agents)) reassigned += 1;
  }
  return { lost: lost.length, reassigned };
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

// ---------- API v1 ----------

/** Solo las keys de owner y admin valen para todo el workspace; la de un miembro respeta la lista. */
function keyIsAdmin(auth: Pick<ApiKeyAuth, 'role'>): boolean {
  return roleAtLeast(auth.role, 'admin');
}

export async function apiWidgetIds(auth: Pick<ApiKeyAuth, 'user' | 'personId' | 'role'>): Promise<string[]> {
  const ids = await workspaceWidgetIds(auth.user.id);
  if (keyIsAdmin(auth) || ids.length === 0) return ids;
  const hidden = new Set(
    ((await getDb()
      .prepare(
        `SELECT w.id FROM chat_widgets w WHERE w.id IN (${ids.map(() => '?').join(', ')}) AND w.restricted = 1 AND w.user_id != ?
         AND NOT EXISTS (SELECT 1 FROM chat_widget_access a WHERE a.widget_id = w.id AND a.user_id = ?)`,
      )
      .all(...ids, auth.personId, auth.personId)) as Array<{ id: string }>).map((r) => r.id),
  );
  return ids.filter((id) => !hidden.has(id));
}

/** Conversación del workspace que esta key puede ver (null si no). */
export async function getApiConversation(auth: Pick<ApiKeyAuth, 'user' | 'personId' | 'role'>, id: string) {
  const conversation = await getWorkspaceConversation(auth.user.id, id);
  if (!conversation) return null;
  if (keyIsAdmin(auth)) return conversation;
  const widget = await getChatWidget(conversation.widget_id);
  return widget && (await personCanSeeWidget(widget, auth.personId)) ? conversation : null;
}

/** Una conversación de Agents que viene de un widget de Chat respeta la lista de esa bandeja. */
export async function canSeeAgentConversation(user: ChatAccessUser, agentConversationId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  const row = (await getDb().prepare('SELECT chat_conversation_id AS id FROM agent_conversations WHERE id = ?').get(agentConversationId)) as { id: string | null } | undefined;
  if (!row?.id) return true;
  const conv = await getChatConversation(row.id);
  const widget = conv ? await getChatWidget(conv.widget_id) : undefined;
  return !widget || personCanSeeWidget(widget, person(user));
}
