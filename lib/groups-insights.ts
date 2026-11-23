/**
 * Lines: la pestaña AI del panel de un chat (lib/wa-insights.ts). Solo con lo que quien mira ve: el chat pasa por
 * el acceso de Lines (canSeeChat: línea, etiquetas, asignación), las otras líneas del mismo chat solo si las ve
 * (sameChatIds), sin notas internas ni mensajes borrados, y con los teléfonos ocultos si quien mira no los ve. Nada se
 * guarda: la respuesta vuelve a quien la pidió. Server-only.
 */
import { AiError, aiEnabled } from './ai';
import { GroupsError, chatDisplayName, getChatRow, listMessages } from './groups';
import { canSeeChat, maskChat, maskMessage, maskPhoneText, type GroupsViewer } from './groups-access';
import { groupsAiFakeState, groupsObject } from './groups-ai';
import { sameChatIds } from './groups-same-chat';
import {
  INSIGHT_MAX_MESSAGES,
  cleanInsights,
  fakeInsights,
  insightsInstructions,
  insightsPrompt,
  insightsSchema,
  rangeSince,
  sliceUnread,
  type ChatInsights,
  type InsightMessage,
  type InsightRange,
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

/** Los mensajes del rango, como los ve quien mira (orden de llegada, del más viejo al más nuevo). */
export async function linesInsightMessages(viewer: GroupsViewer, chatId: string, range: InsightRange): Promise<{ name: string; group: boolean; messages: InsightMessage[] }> {
  if (!(await canSeeChat(viewer, chatId))) throw new GroupsError('not_found', 404);
  const chat = await getChatRow(viewer.ws, chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  const ids = await sameChatIds(viewer.ws, viewer, chat);
  const since = rangeSince(range);
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
      return { at: m.createdAt, fromMe: m.direction === 'out', who: hide(m.senderName || (m.senderPhone && !viewer.mask ? `+${m.senderPhone}` : '')), text: hide(text) };
    })
    .filter((m) => m.text);
  const messages = range.kind === 'unread' ? sliceUnread(all, range.unread) : all;
  return { name: maskChat(viewer, { name: chatDisplayName(chat), phone: chat.phone }).name, group: chat.kind === 'group', messages };
}

/** La pestaña AI de un chat de Lines: resumen, preguntas, compromisos, respuestas sugeridas y ánimo. */
export async function linesChatInsights(viewer: GroupsViewer, chatId: string, range: InsightRange, locale = 'en'): Promise<ChatInsights> {
  const { name, group, messages } = await linesInsightMessages(viewer, chatId, range);
  if (!messages.length) throw new GroupsError('no_messages');
  const state = await linesAiState();
  if (state === 'off') throw new AiError('ai_disabled');
  if (state === 'not_configured') throw new GroupsError('ai_not_configured', 503);
  const out = await groupsObject({
    ws: viewer.ws,
    feature: 'groups_insights',
    instructions: insightsInstructions(locale),
    prompt: insightsPrompt(name, group, messages, range),
    schema: insightsSchema,
    fake: () => fakeInsights(messages),
    maxOutputTokens: 1500,
  });
  return { ...cleanInsights(out), messages: messages.length, range };
}
