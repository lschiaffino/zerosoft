/**
 * Agents — canales externos del agente: Slack, Messenger, Instagram y
 * teléfono. Cada hilo externo (un hilo de Slack, una persona en Messenger o
 * Instagram, una llamada) es una conversación del canal 'api' con `source`
 * ('slack', 'messenger', 'instagram', 'voice') y `external_ref` (la clave del
 * hilo). Corre lo publicado (o la variante del test A/B) con las mismas
 * herramientas, aprobaciones, límites y derivación que el resto.
 *
 * Los eventos se marcan como procesados (agent_channel_events) antes de
 * contestar: si el servicio reintenta el webhook, no se contesta dos veces.
 * Server-only.
 */
import { getDb } from './db';
import type { AgentRow } from './db';
import type { AgentReplyUi } from './agents-config';

export const EXTERNAL_SOURCES = ['slack', 'messenger', 'instagram', 'voice'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

/** Reclama un evento del canal (compare-and-set). false = ya se procesó. */
export async function claimChannelEvent(agentId: string, eventId: string): Promise<boolean> {
  if (!eventId) return true;
  const res = await getDb()
    .prepare('INSERT OR IGNORE INTO agent_channel_events (id, agent_id, created_at) VALUES (?, ?, ?)')
    .run(`${agentId}:${eventId}`.slice(0, 300), agentId, new Date().toISOString());
  return res.changes > 0;
}

/** Limpieza (cron horario): los eventos de más de 3 días ya no se reintentan. */
export async function pruneChannelEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  return (await getDb().prepare('DELETE FROM agent_channel_events WHERE created_at < ?').run(cutoff)).changes;
}

/** Conversación del agente para un hilo externo (la crea si no existe). */
export async function conversationForExternal(agent: AgentRow, source: ExternalSource, externalRef: string, title: string): Promise<string> {
  const db = getDb();
  // Después de la redacción la clave queda como hash (h:…): se busca de las dos formas.
  const { hashValue } = await import('./agents-privacy');
  const hashed = `h:${hashValue(externalRef)}`;
  const found = (await db
    .prepare("SELECT id FROM agent_conversations WHERE agent_id = ? AND external_ref IN (?, ?) AND channel = 'api' ORDER BY created_at DESC LIMIT 1")
    .get(agent.id, externalRef, hashed)) as { id: string } | undefined;
  if (found) return found.id;
  const { createConversation } = await import('./agents');
  const conv = await createConversation(agent, 'api', { title: title.slice(0, 80) });
  await db.prepare('UPDATE agent_conversations SET source = ?, external_ref = ? WHERE id = ?').run(source, externalRef.slice(0, 300), conv.id);
  return conv.id;
}

export interface ExternalReply {
  text: string;
  ui: AgentReplyUi | null;
  handoff: boolean;
  /** La conversación ya estaba con una persona: el agente no contestó. */
  handedOff: boolean;
}

/**
 * Manda el mensaje del visitante al agente y devuelve la respuesta. Null si
 * no hay nada que contestar (agente pausado, AI apagada, límite).
 */
export async function replyOnExternal(input: {
  agent: AgentRow;
  source: ExternalSource;
  externalRef: string;
  text: string;
  title?: string;
}): Promise<ExternalReply | null> {
  const { agent } = input;
  if (agent.enabled !== 1) return null;
  const text = input.text.trim().slice(0, 4000);
  if (!text) return null;
  const conversationId = await conversationForExternal(agent, input.source, input.externalRef, input.title ?? text);
  const { sendAgentMessage, AgentError } = await import('./agents');
  try {
    const res = await sendAgentMessage({ agent, channel: 'api', text, conversationId, createdBy: null });
    if (res.result.status === 'handed_off') return { text: '', ui: null, handoff: true, handedOff: true };
    return { text: res.result.text, ui: res.result.ui ?? null, handoff: res.result.handoff, handedOff: false };
  } catch (err) {
    if (err instanceof AgentError) return null;
    console.error('[agents-channels] reply failed', input.source, err instanceof Error ? err.message : 'error');
    return null;
  }
}

/** Texto final para un canal de solo texto (las opciones de los botones, numeradas). */
export async function textWithUi(reply: Pick<ExternalReply, 'text' | 'ui'>): Promise<string> {
  const { uiAsText } = await import('./agents-ui-blocks');
  const extra = uiAsText(reply.ui);
  return extra ? `${reply.text}\n\n${extra}` : reply.text;
}
