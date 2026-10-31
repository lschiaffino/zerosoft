/**
 * Chat — aviso en tiempo real. El stream SSE no lleva contenido: compara una
 * huella de la conversación (o de la bandeja) y avisa "cambió"; el cliente
 * vuelve a pedir los datos por las rutas de siempre, que chequean el acceso.
 * Así cualquier escritura (bot, API, reglas, otra instancia) se ve en menos de
 * dos segundos sin una tabla de eventos. Server-only.
 */
import { getDb } from './db';
import { sseResponse } from './realtime';

export const STREAM_MAX_MS = 120_000;

function inClause(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/** Cambia con mensajes (nuevos, editados, borrados, leídos), estado de la conversación, escritura y presencia. */
export async function conversationFingerprint(conversationId: string): Promise<string> {
  const db = getDb();
  const now = new Date().toISOString();
  const row = (await db
    .prepare(
      `SELECT c.updated_at AS u, c.status AS s, c.assigned_to AS a,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS n,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.read_at IS NOT NULL) AS r,
        (SELECT MAX(COALESCE(m.edited_at, m.created_at)) FROM chat_messages m WHERE m.conversation_id = c.id) AS e,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NOT NULL) AS d
       FROM chat_conversations c WHERE c.id = ?`,
    )
    .get(conversationId)) as Record<string, unknown> | undefined;
  const typing = (await db.prepare('SELECT sender_type FROM chat_typing WHERE conversation_id = ? AND expires_at > ? ORDER BY sender_type').all(conversationId, now)) as Array<{ sender_type: string }>;
  const presence = (await db
    .prepare('SELECT user_id, typing FROM chat_presence WHERE conversation_id = ? AND expires_at > ? ORDER BY user_id')
    .all(conversationId, now)) as Array<{ user_id: string; typing: number }>;
  return JSON.stringify([row ?? null, typing.map((t) => t.sender_type), presence.map((p) => `${p.user_id}:${p.typing}`)]);
}

/** Cambia cuando entra o se mueve algo en estas bandejas. */
export async function inboxFingerprint(widgetIds: string[]): Promise<string> {
  if (widgetIds.length === 0) return '';
  const row = (await getDb()
    .prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS u FROM chat_conversations WHERE widget_id IN (${inClause(widgetIds.length)})`)
    .get(...widgetIds)) as { n: number; u: string | null } | undefined;
  return `${row?.n ?? 0}|${row?.u ?? ''}`;
}

/** El visitante: su última conversación en este widget. */
export async function visitorFingerprint(widgetId: string, visitorKey: string): Promise<string> {
  const row = (await getDb()
    .prepare(
      `SELECT c.id FROM chat_conversations c JOIN chat_visitors v ON v.id = c.visitor_id
       WHERE v.widget_id = ? AND v.external_id = ? ORDER BY c.created_at DESC LIMIT 1`,
    )
    .get(widgetId, visitorKey)) as { id: string } | undefined;
  return row ? `${row.id}:${await conversationFingerprint(row.id)}` : '';
}

/** Stream "cambió": la primera lectura es la base y solo avisa las diferencias. */
export function fingerprintStream(read: () => Promise<string>, opts: { intervalMs: number; signal?: AbortSignal; headers?: Record<string, string> }): Response {
  let last: string | null = null;
  const res = sseResponse<{ type: 'changed' }>({
    cursor: 0,
    intervalMs: opts.intervalMs,
    maxMs: STREAM_MAX_MS,
    signal: opts.signal,
    poll: async (cursor) => {
      const fp = await read();
      if (last === null || fp === last) {
        last = fp;
        return { events: [], cursor };
      }
      last = fp;
      return { events: [{ type: 'changed' }], cursor: cursor + 1 };
    },
  });
  for (const [k, v] of Object.entries(opts.headers ?? {})) res.headers.set(k, v);
  return res;
}
