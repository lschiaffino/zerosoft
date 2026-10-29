/**
 * Agents — canal Chat. Un widget con bot_source = 'agent' delega en el agente
 * asignado (agent_id). Igual que el bot AI de Chat: responde cada mensaje del
 * visitante mientras ningún humano haya contestado y no haya derivado; corre
 * en segundo plano (after) y el widget recibe la respuesta en su polling.
 * Ante cualquier falla cae al bot por keywords. Server-only.
 */
import type { ChatConversationRow, ChatMessageRow, ChatWidgetRow } from './db';
import { agentsAiEnabled } from './agents-ai';
import { createChatMessage, getChatConversation, maybeRunChatBot } from './chat-data';
import {
  clearBotTyping,
  describeMessage,
  humanHasReplied,
  markHandoff,
  recentMessages,
  setBotTyping,
  toModelMessages,
  wasHandedOff,
  type ScheduleTask,
} from './chat-bot-ai';
import { AgentError, assertAgentLimits, conversationForChat, getAgentRowById, runAgent } from './agents';
import type { AgentRow } from './db';

export type AgentChatStatus = 'replied' | 'handoff' | 'skipped' | 'fallback' | 'rate_limited';

export interface AgentChatOutcome {
  status: AgentChatStatus;
  message: ChatMessageRow | null;
}

/** Agente asignado al widget, si existe, es del mismo workspace y está activo. */
export async function widgetAgent(widget: Pick<ChatWidgetRow, 'user_id' | 'bot_source' | 'agent_id'>): Promise<AgentRow | null> {
  if (widget.bot_source !== 'agent' || !widget.agent_id) return null;
  const agent = await getAgentRowById(widget.agent_id);
  if (!agent || agent.user_id !== widget.user_id || agent.enabled !== 1) return null;
  return agent;
}

/**
 * ¿El agente del widget contesta los emails que llegan a la dirección del
 * widget (canal email de Chat)? Solo si el dueño lo activó en el agente.
 */
export async function agentAnswersEmail(widget: Pick<ChatWidgetRow, 'user_id' | 'bot_source' | 'agent_id' | 'bot_enabled'>): Promise<boolean> {
  if (widget.bot_enabled !== 1) return false;
  const agent = await widgetAgent(widget);
  if (!agent) return false;
  const { parseSettings } = await import('./agents-config');
  return parseSettings(agent.settings).answerEmails === true;
}

/**
 * Genera y publica la respuesta del agente. Con `triggerMessageId`, si ya
 * llegó un mensaje más nuevo del visitante no hace nada (lo contesta la
 * ejecución disparada por ese mensaje).
 */
export async function runAgentChatReply(
  widget: ChatWidgetRow,
  agent: AgentRow,
  conversationId: string,
  triggerMessageId?: string,
): Promise<AgentChatOutcome> {
  try {
    const conversation = await getChatConversation(conversationId);
    if (!conversation || conversation.widget_id !== widget.id) return { status: 'skipped', message: null };
    if ((await humanHasReplied(conversationId)) || (await wasHandedOff(conversationId))) {
      return { status: 'skipped', message: null };
    }
    const rows = await recentMessages(conversationId, 20);
    const visitorRows = rows.filter((m) => m.sender_type === 'visitor');
    const lastVisitor = visitorRows[visitorRows.length - 1];
    if (!lastVisitor) return { status: 'skipped', message: null };
    if (triggerMessageId && lastVisitor.id !== triggerMessageId) return { status: 'skipped', message: null };

    const agentConv = await conversationForChat(agent, conversationId, describeMessage(visitorRows[0]).slice(0, 80));
    try {
      await assertAgentLimits(agent.user_id, agentConv.id);
    } catch (err) {
      if (err instanceof AgentError) return { status: 'rate_limited', message: null };
      throw err;
    }

    // Visitante bloqueado desde Conversaciones: el agente no le contesta (el equipo sí puede).
    const { isChatVisitorBlocked } = await import('./agents-privacy');
    if (await isChatVisitorBlocked(agent.id, conversation.visitor_id)) return { status: 'skipped', message: null };
    // Identidad firmada por el sitio (lib/chat-identity.ts): contexto y memoria del visitante.
    const { chatVisitorIdentity, memoryRefFor, setConversationIdentity } = await import('./agents-context');
    const identity = await chatVisitorIdentity(conversationId);
    if (identity && !agentConv.visitor_ref) {
      await setConversationIdentity(agentConv.id, identity, memoryRefFor('chat', { identity }));
      agentConv.visitor_email = identity.email;
      agentConv.visitor_ref = memoryRefFor('chat', { identity });
    }

    // Test A/B: la conversación corre con la versión que le tocó.
    const { variantRow } = await import('./agents-ab');
    const runRow = await variantRow(agent, agentConv);
    let result;
    try {
      const messages = toModelMessages(rows);
      if (messages.length === 0) return { status: 'skipped', message: null };
      result = await runAgent({ agent: runRow, conversation: agentConv, messages, channel: 'chat', identity });
    } catch (err) {
      console.error('[agents-chat] run failed', err);
      const message = await maybeRunChatBot(widget, conversation, describeMessage(lastVisitor));
      return { status: 'fallback', message };
    }

    // Si un humano contestó mientras el agente pensaba, no se mete.
    if (await humanHasReplied(conversationId)) return { status: 'skipped', message: null };
    // Por email no hay botones ni formularios: van como texto en el mismo mensaje.
    const isEmail = conversation.channel === 'email';
    const { uiAsText } = await import('./agents-ui-blocks');
    const extra = isEmail && result.ui ? uiAsText(result.ui) : '';
    const body = extra ? `${result.text}\n\n${extra}` : result.text;
    let message = body ? await createChatMessage(conversationId, 'bot', { body }) : null;
    if (message && result.ui && !isEmail) {
      const { getDb: db } = await import('./db');
      await db().prepare('UPDATE chat_messages SET ui = ? WHERE id = ?').run(JSON.stringify(result.ui), message.id);
      message = { ...message, ui: JSON.stringify(result.ui) };
    }
    // La conversación del agente queda con actividad (puntaje, memoria y redacción miran updated_at).
    const { getDb } = await import('./db');
    await getDb().prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), agentConv.id);
    if (result.handoff) {
      await markHandoff(widget, conversation, `the agent "${agent.name}"`);
      return { status: 'handoff', message };
    }
    return { status: 'replied', message };
  } finally {
    await clearBotTyping(conversationId).catch(() => {});
  }
}

/** Entrada desde dispatchChatBot (lib/chat-bot-ai.ts) para widgets con agente. */
export async function dispatchAgentChat(
  widget: ChatWidgetRow,
  conversation: ChatConversationRow,
  visitorMessage: Pick<ChatMessageRow, 'id' | 'body'>,
  schedule?: ScheduleTask,
): Promise<ChatMessageRow | null> {
  const agent = await widgetAgent(widget);
  if (!agent || !(await agentsAiEnabled())) return maybeRunChatBot(widget, conversation, visitorMessage.body);
  if ((await humanHasReplied(conversation.id)) || (await wasHandedOff(conversation.id))) return null;

  await setBotTyping(conversation.id).catch(() => {});
  const task = async () => (await runAgentChatReply(widget, agent, conversation.id, visitorMessage.id)).message;
  if (schedule) {
    schedule(async () => {
      try {
        await task();
      } catch (err) {
        console.error('[agents-chat] reply failed', err);
      }
    });
    return null;
  }
  try {
    return await task();
  } catch (err) {
    console.error('[agents-chat] reply failed', err);
    return null;
  }
}

/** Formulario de un agente enviado desde el widget de Chat: validado contra lo publicado (o la variante). */
export async function validateChatAgentForm(
  widget: ChatWidgetRow,
  chatConversationId: string,
  input: { id: string; values: Record<string, unknown> },
): Promise<{ agent: AgentRow; text: string; values: Record<string, string>; formId: string } | null> {
  const widgetAgentRow = await widgetAgent(widget);
  if (!widgetAgentRow) return null;
  const { getDb } = await import('./db');
  const db = getDb();
  // El último mensaje del bot tiene que traer ese formulario (o lo espera un paso de procedimiento).
  const lastBot = (await db
    .prepare("SELECT ui FROM chat_messages WHERE conversation_id = ? AND sender_type = 'bot' AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(chatConversationId)) as { ui: string | null } | undefined;
  const { parseUi, validateFormSubmission } = await import('./agents-ui-blocks');
  const ui = parseUi(lastBot?.ui ?? null);
  const agentConv = (await db.prepare('SELECT * FROM agent_conversations WHERE chat_conversation_id = ?').get(chatConversationId)) as
    | import('./db').AgentConversationRow
    | undefined;
  // Con la configuración de la variante del test A/B que atiende la conversación.
  const { variantRow } = await import('./agents-ab');
  const agent = agentConv ? await variantRow(widgetAgentRow, agentConv) : widgetAgentRow;
  const { parseSettings } = await import('./agents-config');
  const settings = parseSettings(agent.settings);
  let shown = ui?.kind === 'form' && ui.formId === input.id && !ui.consumed;
  if (!shown && agentConv) {
    const { formShownInConversation } = await import('./agents-forms');
    shown = await formShownInConversation(agentConv, input.id, settings.procedures);
  }
  if (!shown) return null;
  const form = settings.forms.find((f) => f.id === input.id);
  const sub = validateFormSubmission(form, input.values);
  if (!sub.ok) return null;
  // Válido: se consume una sola vez (el del bot o el del paso del procedimiento).
  const { consumeShownChatForm, consumeShownForm } = await import('./agents-forms');
  const consumed = ui?.kind === 'form' && ui.formId === input.id ? await consumeShownChatForm(chatConversationId, input.id) : agentConv ? await consumeShownForm(agentConv, input.id) : false;
  return consumed ? { agent, text: sub.text, values: sub.values, formId: input.id } : null;
}

/** Guarda lo enviado (registro y, si el formulario lo pide, contacto del CRM). */
export async function saveChatAgentForm(
  widget: ChatWidgetRow,
  chatConversationId: string,
  sub: { agent: AgentRow; values: Record<string, string>; formId: string },
): Promise<void> {
  const { parseSettings } = await import('./agents-config');
  const form = parseSettings(sub.agent.settings).forms.find((f) => f.id === sub.formId);
  if (!form) return;
  const conversation = await conversationForChat(sub.agent, chatConversationId);
  const { saveFormSubmission } = await import('./agents-forms');
  await saveFormSubmission({ agent: sub.agent, conversation, form, values: sub.values, dryRun: false });
  void widget;
}
