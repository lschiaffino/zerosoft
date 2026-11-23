/**
 * Lines: la pestaña IA del panel del chat. Preguntarle a la IA sobre el chat
 * y leer el sentimiento con las tareas que propone (reglas en
 * lib/groups-ai-rules.ts). Lee solo los mensajes del chat que la persona ve
 * (quien llama ya pasó chatGuard), sin los borrados ni las notas internas; con
 * los teléfonos ocultos para quien los ve ocultos, el modelo tampoco los
 * recibe. No crea nada: las propuestas vuelven para aprobarlas. Server-only.
 */
import { getDb } from './db';
import { GroupsError, chatDisplayName, getChatRow, type MessageRow } from './groups';
import { maskPhoneText } from './groups-mask';
import { linesRowTexts } from './groups-wa-names';
import { groupsObject } from './groups-ai';
import {
  answerSchema,
  askPrompt,
  cleanAnswer,
  cleanInsights,
  cleanQuestion,
  fakeAnswer,
  fakeInsights,
  insightsPrompt,
  insightsSchema,
  type ChatAnswer,
  type ChatInsights,
  type ChatTranscript,
  type ProposalKind,
} from './groups-ai-rules';

/** En Lines una propuesta puede ser tarea (CRM › Tareas) o ticket. */
export const LINES_PROPOSAL_KINDS: readonly ProposalKind[] = ['task', 'ticket'];

const MAX_MESSAGES = 200;

/** Los últimos mensajes del chat como transcripción para el modelo. */
export async function linesTranscript(ws: string, chatId: string, opts: { maskPhones?: boolean } = {}): Promise<ChatTranscript> {
  const chat = await getChatRow(ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM (SELECT * FROM groups_messages WHERE chat_id = ? AND user_id = ? AND direction IN ('in', 'out') AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT ?) ORDER BY created_at ASC`,
    )
    .all(chat.id, ws, MAX_MESSAGES)) as MessageRow[];
  if (rows.length === 0) throw new GroupsError('no_messages');
  const hide = opts.maskPhones === true;
  const bodies = await linesRowTexts(ws, rows, { mask: hide });
  const lines = rows.map((m, i) => {
    const who = m.direction === 'out' ? 'Team' : m.sender_name || (m.sender_phone && !hide ? `+${m.sender_phone}` : 'Customer');
    const text = (bodies[i] || (m.media_type ? `[${m.media_type}]` : '')).replace(/\s+/g, ' ').slice(0, 600);
    return `[${m.created_at.slice(0, 16).replace('T', ' ')}] ${hide ? maskPhoneText(who) : who}: ${hide ? maskPhoneText(text) : text}`;
  });
  const name = chatDisplayName(chat);
  return { header: `${chat.kind === 'group' ? 'WhatsApp group' : 'WhatsApp chat with'} "${hide ? maskPhoneText(name) : name}".`, lines, us: 'Team' };
}

export async function askLinesChat(ws: string, chatId: string, question: string, opts: { locale?: string; maskPhones?: boolean } = {}): Promise<ChatAnswer> {
  const q = cleanQuestion(question);
  if (!q) throw new GroupsError('empty_question');
  const t = await linesTranscript(ws, chatId, opts);
  const { instructions, prompt } = askPrompt(t, q, opts.locale ?? 'en');
  const res = await groupsObject({
    ws,
    feature: 'groups_chat_ask',
    instructions,
    prompt,
    schema: answerSchema,
    plain: (text) => ({ answer: text }),
    fake: () => fakeAnswer(t, q),
    maxOutputTokens: 800,
  });
  const answer = cleanAnswer(res.answer);
  if (!answer) throw new GroupsError('empty_result');
  // Con los teléfonos ocultos, tampoco vuelven en la respuesta (el modelo pudo copiar uno de un texto).
  return { answer: opts.maskPhones ? maskPhoneText(answer) : answer, messages: t.lines.length };
}

export async function linesChatInsights(ws: string, chatId: string, opts: { locale?: string; maskPhones?: boolean } = {}): Promise<ChatInsights> {
  const t = await linesTranscript(ws, chatId, opts);
  const { instructions, prompt } = insightsPrompt(t, opts.locale ?? 'en', LINES_PROPOSAL_KINDS);
  const raw = await groupsObject({
    ws,
    feature: 'groups_chat_insights',
    instructions,
    prompt,
    schema: insightsSchema,
    fake: () => fakeInsights(t, LINES_PROPOSAL_KINDS),
    maxOutputTokens: 1200,
  });
  const out = cleanInsights(raw, t.lines.length, LINES_PROPOSAL_KINDS);
  if (!opts.maskPhones) return out;
  return {
    ...out,
    reason: maskPhoneText(out.reason),
    proposals: out.proposals.map((p) => ({ ...p, title: maskPhoneText(p.title), notes: maskPhoneText(p.notes) })),
  };
}
