/**
 * Lines: la pestaña AI del panel de un chat (lib/wa-insights.ts). Solo con lo que quien mira ve: el chat pasa por
 * el acceso de Lines (canSeeChat: línea, etiquetas, asignación), las otras líneas del mismo chat solo si las ve
 * (sameChatIds), sin notas internas ni mensajes borrados, y con los teléfonos ocultos si quien mira no los ve. Nada se
 * guarda: la respuesta vuelve a quien la pidió. Server-only.
 */
import { AiError, aiEnabled } from './ai';
import { GroupsError, getChatRow, listMessages } from './groups';
import { canSeeChat, maskMessage, maskPhoneText, maskedChatName, type GroupsViewer } from './groups-access';
import { groupsAiFakeState, groupsObject } from './groups-ai';
import { sameChatIds } from './groups-same-chat';
import {
  INSIGHT_MAX_MESSAGES,
  answerSchema,
  askInstructions,
  askPrompt,
  cleanAnswer,
  cleanQuestion,
  fakeAnswer,
  type ChatAnswer,
  type ProposalKind,
  cleanInsights,
  fakeInsights,
  fitMessages,
  insightsInstructions,
  insightsPrompt,
  insightsSchema,
  rangeSince,
  sliceUnread,
  type ChatInsights,
  type InsightMessage,
  type InsightRange,
  type InsightsOutput,
} from './wa-insights';

export type LinesAiState = 'ready' | 'off' | 'not_configured';

/** ¿Hay IA para la pestaña? (antes de pedir nada; con el modelo falso de e2e, la cookie groups_ai_fake=off la apaga). */
export async function linesAiState(): Promise<LinesAiState> {
  const fake = await groupsAiFakeState();
  if (fake === 'on') return 'ready';
  if (fake === 'off' || process.env.AI_ENABLED === 'false') return 'off';
  return aiEnabled() ? 'ready' : 'not_configured';
}

const MENTION_RE = /(^|[^\w@])@(\d{5,20})(?!\d)/g;

/** En Lines un seguimiento propuesto puede ser tarea (CRM › Tareas) o ticket. */
export const LINES_PROPOSAL_KINDS: readonly ProposalKind[] = ['task', 'ticket'];

/**
 * Los mensajes del rango, como los ve quien mira (orden de llegada, del más viejo al más nuevo). `range` null: los
 * últimos mensajes, sin rango (preguntarle a la IA sobre el chat).
 */
export async function linesInsightMessages(viewer: GroupsViewer, chatId: string, range: InsightRange | null): Promise<{ name: string; group: boolean; messages: InsightMessage[] }> {
  if (!(await canSeeChat(viewer, chatId))) throw new GroupsError('not_found', 404);
  const chat = await getChatRow(viewer.ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  const ids = await sameChatIds(viewer.ws, viewer, chat);
  const since = range ? rangeSince(range) : null;
  const rows = await listMessages(viewer.ws, chatId, { chatIds: ids, limit: INSIGHT_MAX_MESSAGES, ...(since ? { after: since } : {}) });
  const hide = (s: string) => (viewer.mask ? maskPhoneText(s) : s);
  const all = rows
    .filter((m) => (m.direction === 'in' || m.direction === 'out') && !m.deletedAt)
    .map((raw): InsightMessage => {
      const m = maskMessage(viewer, raw);
      // "@<dígitos>" → "@Nombre" cuando se sabe (como en la conversación); si no, con el teléfono oculto si corresponde.
      const body = (m.body ?? '').replace(MENTION_RE, (all, pre: string, d: string) => {
        const t = m.mentionNames?.[d];
        return t?.name ? `${pre}@${t.name}` : all;
      });
      const text = body || (m.media ? `[${m.media.kind || m.media.type || 'file'}]` : '');
      return { id: m.id, at: m.createdAt, fromMe: m.direction === 'out', who: hide(m.senderName || (m.senderPhone && !viewer.mask ? `+${m.senderPhone}` : '')), text: hide(text) };
    })
    .filter((m) => m.text);
  const messages = range?.kind === 'unread' ? sliceUnread(all, range.unread, range.from) : all;
  // El nombre del chat como lo ve quien mira (un 1:1 sin nombre ni teléfono no manda el id de WhatsApp a la vista).
  return { name: hide(maskedChatName(viewer, chat)), group: chat.kind === 'group', messages };
}

/** La pestaña AI de un chat de Lines: resumen, preguntas, compromisos, respuestas sugeridas y ánimo. */
export async function linesChatInsights(viewer: GroupsViewer, chatId: string, range: InsightRange, locale = 'en'): Promise<ChatInsights> {
  // La IA primero: apagada, no se lee nada.
  const state = await linesAiState();
  if (state === 'off') throw new AiError('ai_disabled');
  if (state === 'not_configured') throw new GroupsError('ai_not_configured', 503);
  const read = await linesInsightMessages(viewer, chatId, range);
  const messages = fitMessages(read.messages);
  if (!messages.length) throw new GroupsError('no_messages');
  let out: InsightsOutput;
  try {
    out = await groupsObject({
      ws: viewer.ws,
      feature: 'groups_insights',
      instructions: insightsInstructions(locale, LINES_PROPOSAL_KINDS),
      prompt: insightsPrompt(read.name, read.group, messages, range),
      schema: insightsSchema,
      fake: () => fakeInsights(messages, LINES_PROPOSAL_KINDS),
      maxOutputTokens: 1500,
    });
  } catch (err) {
    // Cuota, rate limit o IA apagada: su código. Lo demás (el proveedor falló): ai_failed, sin detalles.
    if (err instanceof AiError || err instanceof GroupsError) throw err;
    throw new GroupsError('ai_failed', 502);
  }
  const clean = cleanInsights(out, LINES_PROPOSAL_KINDS);
  // Con los teléfonos ocultos, lo que vuelve del modelo tampoco los trae (pudo copiar uno de un texto).
  const hide = (v: string) => (viewer.mask ? maskPhoneText(v) : v);
  const masked = viewer.mask
    ? {
        ...clean,
        summary: hide(clean.summary),
        sentimentNote: hide(clean.sentimentNote),
        questions: clean.questions.map(hide),
        commitments: clean.commitments.map((c) => ({ ...c, text: hide(c.text) })),
        replies: clean.replies.map(hide),
        proposals: clean.proposals.map((p) => ({ ...p, title: hide(p.title), notes: hide(p.notes) })),
      }
    : clean;
  return { ...masked, messages: messages.length, range };
}

/** Preguntarle a la IA sobre el chat: responde solo con los últimos mensajes que quien mira ve. */
export async function linesChatAsk(viewer: GroupsViewer, chatId: string, question: string, locale = 'en'): Promise<ChatAnswer> {
  const q = cleanQuestion(question);
  if (!q) throw new GroupsError('empty_question');
  const state = await linesAiState();
  if (state === 'off') throw new AiError('ai_disabled');
  if (state === 'not_configured') throw new GroupsError('ai_not_configured', 503);
  const read = await linesInsightMessages(viewer, chatId, null);
  const messages = fitMessages(read.messages);
  if (!messages.length) throw new GroupsError('no_messages');
  let out: { answer: string };
  try {
    out = await groupsObject({
      ws: viewer.ws,
      feature: 'groups_chat_ask',
      instructions: askInstructions(locale),
      prompt: askPrompt(read.name, read.group, messages, q),
      schema: answerSchema,
      plain: (text) => ({ answer: text }),
      fake: () => fakeAnswer(messages, q),
      maxOutputTokens: 800,
    });
  } catch (err) {
    if (err instanceof AiError || err instanceof GroupsError) throw err;
    throw new GroupsError('ai_failed', 502);
  }
  const answer = cleanAnswer(out.answer);
  if (!answer) throw new GroupsError('empty_result', 502);
  return { answer: viewer.mask ? maskPhoneText(answer) : answer, messages: messages.length };
}
