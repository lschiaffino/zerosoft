/**
 * Groups: resumen AI de un chat o grupo (lo hablado, pendientes y preguntas
 * sin responder). Usa lib/ai.ts: con la AI apagada, sin cuota o con rate
 * limit tira AiError y la ruta responde el código para que la UI lo explique.
 * Server-only.
 */
import { aiGenerateText } from './ai';
import { getDb } from './db';
import { GroupsError, chatDisplayName, getChatRow, type MessageRow } from './groups';

const LOCALE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };

export function summaryPrompt(chatName: string, lines: string[], locale: string): string {
  return [
    `WhatsApp conversation "${chatName}" (oldest first). Write a short summary in ${LOCALE_NAME[locale] ?? 'English'} for the support team.`,
    'Use three short sections with plain-text headings: "Summary", "Open items" (who owes what) and "Unanswered questions".',
    'Only use what is in the messages. If a section is empty, write "None".',
    '',
    ...lines,
  ].join('\n');
}

export async function summarizeChat(
  ws: string,
  chatId: string,
  opts: { days?: number; locale?: string } = {},
): Promise<{ summary: string; messages: number }> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  const since = new Date(Date.now() - (opts.days ?? 7) * 86_400_000).toISOString();
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM (SELECT * FROM groups_messages WHERE chat_id = ? AND direction IN ('in', 'out') AND created_at >= ?
       ORDER BY created_at DESC LIMIT 300) ORDER BY created_at ASC`,
    )
    .all(chat.id, since)) as MessageRow[];
  if (rows.length === 0) throw new GroupsError('no_messages');
  const lines = rows.map((m) => {
    const who = m.direction === 'out' ? 'Team' : m.sender_name || (m.sender_phone ? `+${m.sender_phone}` : 'Customer');
    const text = (m.body || (m.media_type ? `[${m.media_type}]` : '')).replace(/\s+/g, ' ').slice(0, 600);
    return `[${m.created_at.slice(0, 16).replace('T', ' ')}] ${who}: ${text}`;
  });
  const res = await aiGenerateText({
    workspaceId: ws,
    feature: 'groups_summary',
    prompt: summaryPrompt(chatDisplayName(chat), lines, opts.locale ?? 'en'),
    maxOutputTokens: 700,
    temperature: 0.2,
  });
  return { summary: res.text.trim(), messages: rows.length };
}
