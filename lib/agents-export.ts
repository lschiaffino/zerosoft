/**
 * Agents — exportar conversaciones a CSV (una fila por mensaje, con los datos
 * de la conversación y su puntaje). No incluye las llamadas a herramientas:
 * traen datos leídos con el acceso de otra persona (ver redactDocsCalls en
 * lib/agents.ts). Sin el playground. Server-only.
 */
import { getDb } from './db';
import type { AgentConversationRow } from './db';

const MAX_CONVERSATIONS = 2000;

export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  // Fórmulas: una celda que empieza con = + - @ se abre como texto en Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const HEADER = [
  'conversation_id',
  'channel',
  'title',
  'started_at',
  'updated_at',
  'handed_off',
  'csat',
  'sentiment',
  'topic',
  'visitor_email',
  'message_at',
  'author',
  'message',
];

export async function exportConversationsCsv(workspaceId: string, agentId: string, opts: { days?: number; now?: Date } = {}): Promise<string> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - Math.min(Math.max(opts.days ?? 30, 1), 365) * 86_400_000).toISOString();
  const convs = (await db
    .prepare(
      `SELECT * FROM agent_conversations WHERE user_id = ? AND agent_id = ? AND channel != 'playground' AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(workspaceId, agentId, from, MAX_CONVERSATIONS)) as AgentConversationRow[];
  const lines = [HEADER.join(',')];
  for (const c of convs) {
    const base = [
      c.id,
      c.source === 'flow' ? 'flow' : c.channel,
      c.title,
      c.created_at,
      c.updated_at,
      c.handed_off ? 'yes' : 'no',
      c.csat ?? '',
      c.sentiment ?? '',
      c.topic ?? '',
      c.visitor_email ?? '',
    ];
    const messages = c.chat_conversation_id
      ? (
          (await db
            .prepare(
              "SELECT sender_type, body, created_at FROM chat_messages WHERE conversation_id = ? AND sender_type IN ('visitor', 'bot', 'user') AND is_note = 0 AND deleted_at IS NULL ORDER BY created_at, rowid LIMIT 500",
            )
            .all(c.chat_conversation_id)) as Array<{ sender_type: string; body: string; created_at: string }>
        ).map((m) => ({ author: m.sender_type === 'visitor' ? 'visitor' : m.sender_type === 'bot' ? 'agent' : 'teammate', text: m.body, at: m.created_at }))
      : (
          (await db
            .prepare("SELECT role, content, author_id, created_at FROM agent_messages WHERE conversation_id = ? AND role IN ('user', 'assistant') ORDER BY created_at, rowid LIMIT 500")
            .all(c.id)) as Array<{ role: string; content: string; author_id: string | null; created_at: string }>
        ).map((m) => ({ author: m.role === 'user' ? 'visitor' : m.author_id ? 'teammate' : 'agent', text: m.content, at: m.created_at }));
    if (messages.length === 0) lines.push([...base, '', '', ''].map(csvCell).join(','));
    for (const m of messages) lines.push([...base, m.at, m.author, m.text].map(csvCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
