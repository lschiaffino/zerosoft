/**
 * Chat: quién entra a una bandeja restringida. El dueño, los admins del
 * workspace y las personas de chat_widget_access. Lo usan los permisos, la
 * asignación, las notificaciones y cualquier destinatario. Sin dependencias de
 * chat-data para que chat-data lo pueda usar. Server-only.
 */
import { getDb } from './db';

export interface AudienceWidget {
  id: string;
  user_id: string;
  restricted?: number | null;
}

export function isRestricted(widget: Pick<AudienceWidget, 'restricted'>): boolean {
  return Number(widget.restricted ?? 0) === 1;
}

/** Ids con acceso a una bandeja restringida. */
export async function restrictedAudience(widget: AudienceWidget): Promise<Set<string>> {
  const db = getDb();
  const [listed, admins] = await Promise.all([
    db.prepare('SELECT user_id FROM chat_widget_access WHERE widget_id = ?').all(widget.id) as Promise<Array<{ user_id: string }>>,
    db
      .prepare(
        `SELECT m.user_id FROM team_members m JOIN teams t ON t.id = m.team_id
         WHERE t.owner_id = ? AND m.role IN ('owner', 'admin')`,
      )
      .all(widget.user_id) as Promise<Array<{ user_id: string }>>,
  ]);
  return new Set([widget.user_id, ...listed.map((r) => r.user_id), ...admins.map((r) => r.user_id)]);
}

/** Deja solo a quienes pueden ver la bandeja (agentes, destinatarios). */
export async function filterWidgetAudience<T extends { id: string }>(widget: AudienceWidget, people: T[]): Promise<T[]> {
  if (!isRestricted(widget)) return people;
  const allowed = await restrictedAudience(widget);
  return people.filter((p) => allowed.has(p.id));
}

export async function personCanSeeWidget(widget: AudienceWidget, personId: string): Promise<boolean> {
  return !isRestricted(widget) || (await restrictedAudience(widget)).has(personId);
}

/**
 * Condición SQL para filas con una conversación de Chat opcional (Agents):
 * deja afuera las de bandejas que esta persona no ve. Para admins no hace falta.
 */
export function chatConversationVisibleSql(column: string, personId: string): { sql: string; args: string[] } {
  return {
    sql: `(${column} IS NULL OR NOT EXISTS (
      SELECT 1 FROM chat_conversations zc JOIN chat_widgets zw ON zw.id = zc.widget_id
      WHERE zc.id = ${column} AND zw.restricted = 1 AND zw.user_id != ?
        AND NOT EXISTS (SELECT 1 FROM chat_widget_access za WHERE za.widget_id = zw.id AND za.user_id = ?)
    ))`,
    args: [personId, personId],
  };
}

/**
 * Lo mismo para filas colgadas de una conversación de Agents (agent_runs,
 * agent_tool_calls, agent_feedback): deja afuera las de bandejas que no se ven.
 */
export function agentConversationVisibleSql(column: string, personId: string): { sql: string; args: string[] } {
  const v = chatConversationVisibleSql('zac.chat_conversation_id', personId);
  return {
    sql: `${column} IN (SELECT zac.id FROM agent_conversations zac WHERE ${v.sql})`,
    args: v.args,
  };
}
