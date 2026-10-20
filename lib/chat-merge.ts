/**
 * Chat — unir conversaciones duplicadas del mismo visitante. La conversación
 * de origen se suma a la de destino: mensajes (con su estado de leído), tags,
 * actividades del CRM, la conversación del agente (feedback, herramientas y
 * corridas) y los atributos que el destino no tenga. Después se borra el
 * origen y el destino lleva un mensaje de sistema con la marca del merge
 * (MERGE_NOTE_PREFIX; el inbox lo muestra traducido, el visitante no lo ve).
 * Mismo visitante = mismo widget y mismo visitor_id, o el mismo email.
 */
import { ensureMigrated, getClient, getDb, txDb } from './db';
import type { ChatConversationRow, ChatVisitorRow } from './db';
import { parseAttributeValues, type ChatAttributeValues } from './chat-attributes';
import { mergeNoteBody } from './chat-merge-note';

export { mergeNoteBody, parseMergeNote, MERGE_NOTE_PREFIX } from './chat-merge-note';

export interface MergeCandidate {
  id: string;
  status: ChatConversationRow['status'];
  subject: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_body: string | null;
}

function normEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Mismo visitante: el mismo registro o el mismo email (sin distinguir mayúsculas). */
export function isSameVisitor(
  a: Pick<ChatVisitorRow, 'id' | 'email'>,
  b: Pick<ChatVisitorRow, 'id' | 'email'>,
): boolean {
  if (a.id === b.id) return true;
  const ea = normEmail(a.email);
  return ea !== null && ea === normEmail(b.email);
}

/** Valores del destino; los que no tiene salen del origen. */
export function mergedAttributes(target: ChatAttributeValues, source: ChatAttributeValues): ChatAttributeValues {
  return { ...source, ...target };
}

type StatusFields = Pick<ChatConversationRow, 'status' | 'snoozed_until' | 'resolved_at'>;

/**
 * Estado del hilo unido: el del destino, salvo que esté resuelto y el
 * origen siga abierto (o pendiente o pospuesto): ahí manda el origen, así el
 * trabajo pendiente no queda escondido en una conversación cerrada.
 */
export function mergedStatus(target: StatusFields, source: StatusFields): StatusFields {
  if (target.status === 'resolved' && source.status !== 'resolved') {
    return { status: source.status, snoozed_until: source.snoozed_until, resolved_at: null };
  }
  return { status: target.status, snoozed_until: target.snoozed_until, resolved_at: target.resolved_at };
}

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a.includes('T') ? a : `${a.replace(' ', 'T')}Z`);
  const tb = Date.parse(b.includes('T') ? b : `${b.replace(' ', 'T')}Z`);
  return tb < ta ? b : a;
}

/** Otras conversaciones del mismo visitante en el mismo widget (para unir). */
export async function listMergeCandidates(conversationId: string, limit = 20): Promise<MergeCandidate[]> {
  return (await getDb()
    .prepare(
      `SELECT c.id, c.status, c.subject, c.created_at, c.updated_at,
         (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS message_count,
         (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id AND m.is_note = 0 AND m.deleted_at IS NULL
            AND m.sender_type != 'system' ORDER BY m.created_at DESC LIMIT 1) AS last_message_body
       FROM chat_conversations t
       JOIN chat_visitors tv ON tv.id = t.visitor_id
       JOIN chat_conversations c ON c.widget_id = t.widget_id AND c.id != t.id
       JOIN chat_visitors cv ON cv.id = c.visitor_id
       WHERE t.id = ?
         AND (c.visitor_id = t.visitor_id
              OR (tv.email IS NOT NULL AND TRIM(tv.email) != '' AND LOWER(TRIM(cv.email)) = LOWER(TRIM(tv.email))))
       ORDER BY c.updated_at DESC
       LIMIT ?`,
    )
    .all(conversationId, Math.min(Math.max(limit, 1), 50))) as MergeCandidate[];
}

export type MergeError = 'not_found' | 'same_conversation' | 'other_widget' | 'other_visitor';

/**
 * Suma `sourceId` a `targetId` en una transacción. El acceso a ambas lo
 * valida la ruta; acá se exige mismo widget y mismo visitante.
 */
export async function mergeChatConversations(
  targetId: string,
  sourceId: string,
): Promise<{ ok: true; moved: number } | { ok: false; error: MergeError }> {
  if (targetId === sourceId) return { ok: false, error: 'same_conversation' };
  const db = getDb();
  const load = async (id: string) =>
    (await db
      .prepare(
        `SELECT c.*, v.email AS v_email FROM chat_conversations c JOIN chat_visitors v ON v.id = c.visitor_id WHERE c.id = ?`,
      )
      .get(id)) as (ChatConversationRow & { v_email: string | null }) | undefined;
  const [target, source] = await Promise.all([load(targetId), load(sourceId)]);
  if (!target || !source) return { ok: false, error: 'not_found' };
  if (target.widget_id !== source.widget_id) return { ok: false, error: 'other_widget' };
  if (!isSameVisitor({ id: target.visitor_id, email: target.v_email }, { id: source.visitor_id, email: source.v_email })) {
    return { ok: false, error: 'other_visitor' };
  }

  const now = new Date().toISOString();
  const status = mergedStatus(target, source);
  const attributes = mergedAttributes(parseAttributeValues(target.attributes), parseAttributeValues(source.attributes));

  await ensureMigrated();
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  let moved = 0;
  try {
    moved = (
      await tdb.prepare('UPDATE chat_messages SET conversation_id = ? WHERE conversation_id = ?').run(targetId, sourceId)
    ).changes;
    await tdb
      .prepare(
        'INSERT OR IGNORE INTO chat_conversation_tags (conversation_id, tag, created_at) SELECT ?, tag, created_at FROM chat_conversation_tags WHERE conversation_id = ?',
      )
      .run(targetId, sourceId);
    await tdb.prepare('UPDATE crm_activities SET chat_conversation_id = ? WHERE chat_conversation_id = ?').run(targetId, sourceId);

    // Conversación del agente (si el widget delega en uno): una por conversación de Chat.
    const agentConv = async (chatId: string) =>
      (await tdb.prepare('SELECT id, handed_off FROM agent_conversations WHERE chat_conversation_id = ?').get(chatId)) as
        | { id: string; handed_off: number }
        | undefined;
    const [tAgent, sAgent] = [await agentConv(targetId), await agentConv(sourceId)];
    if (sAgent && !tAgent) {
      await tdb.prepare('UPDATE agent_conversations SET chat_conversation_id = ?, updated_at = ? WHERE id = ?').run(targetId, now, sAgent.id);
    } else if (sAgent && tAgent) {
      for (const table of ['agent_feedback', 'agent_tool_calls', 'agent_runs']) {
        await tdb.prepare(`UPDATE ${table} SET conversation_id = ? WHERE conversation_id = ?`).run(tAgent.id, sAgent.id);
      }
      await tdb
        .prepare('UPDATE agent_conversations SET handed_off = MAX(handed_off, ?), updated_at = ? WHERE id = ?')
        .run(Number(sAgent.handed_off) === 1 ? 1 : 0, now, tAgent.id);
      await tdb.prepare('DELETE FROM agent_conversations WHERE id = ?').run(sAgent.id);
    }

    await tdb
      .prepare(
        `UPDATE chat_conversations SET status = ?, snoozed_until = ?, resolved_at = ?, attributes = ?,
           csat_score = COALESCE(csat_score, ?), csat_comment = COALESCE(csat_comment, ?),
           first_response_at = ?, created_at = ?, subject = COALESCE(NULLIF(subject, ''), ?), updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status.status,
        status.snoozed_until,
        status.resolved_at,
        JSON.stringify(attributes),
        source.csat_score,
        source.csat_comment,
        earliest(target.first_response_at, source.first_response_at),
        earliest(target.created_at, source.created_at),
        source.subject,
        now,
        targetId,
      );
    await tdb
      .prepare(
        "INSERT INTO chat_messages (id, conversation_id, sender_type, user_id, body, attachments, is_note, created_at) VALUES (?, ?, 'system', NULL, ?, '[]', 0, ?)",
      )
      .run(crypto.randomUUID(), targetId, mergeNoteBody(source.created_at, moved), now);
    await tdb.prepare('DELETE FROM chat_conversations WHERE id = ?').run(sourceId);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { ok: true, moved };
}
