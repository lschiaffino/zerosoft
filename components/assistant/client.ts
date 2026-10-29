'use client';

import type { ActionView, AssistantEvent } from '@/lib/assistant/engine';

/** Evento de window que abre (o alterna) el panel del asistente. */
export const ASSISTANT_EVENT = 'zs:assistant';
/** Avisa que una acción confirmada cambió datos (las listas pueden recargar). */
export const ASSISTANT_APPLIED_EVENT = 'zs:assistant-applied';
/** Avisa que cambió la lista de charlas (nueva, renombrada, borrada). */
export const ASSISTANT_CHATS_EVENT = 'zs:assistant-chats';

export interface OpenAssistantDetail {
  prompt?: string;
  conversationId?: string;
}

export function openAssistant(detail: OpenAssistantDetail = {}): void {
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail }));
}

export type ChatPart =
  | { type: 'tool'; callId: string; tool: string; input: unknown; output?: unknown; ok?: boolean; running: boolean }
  | { type: 'action'; action: ActionView };

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: ChatPart[];
  error?: string;
  streaming?: boolean;
}

export interface AssistantStatus {
  state: 'ready' | 'not_configured' | 'disabled';
  admin: boolean;
  model: string;
  tools: Array<{ name: string; app: string | null; kind: 'read' | 'write' }>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: Array<{ type: 'tool'; tool: string; input: unknown; output: unknown; ok: boolean } | { type: 'action'; actionId: string }>;
}

/** Mensajes guardados → ítems de la UI (las acciones con su estado actual). */
export function toChatItems(messages: StoredMessage[], actions: ActionView[]): ChatItem[] {
  const byId = new Map(actions.map((a) => [a.id, a]));
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    parts: m.parts.flatMap((p, i): ChatPart[] => {
      if (p.type === 'tool') return [{ type: 'tool', callId: `${m.id}-${i}`, tool: p.tool, input: p.input, output: p.output, ok: p.ok, running: false }];
      const a = byId.get(p.actionId);
      return a ? [{ type: 'action', action: a }] : [];
    }),
  }));
}

/** Lee el stream NDJSON de POST /api/assistant/chat y llama `on` por evento. */
export async function readEvents(res: Response, on: (e: AssistantEvent) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          on(JSON.parse(line) as AssistantEvent);
        } catch {
          // Línea cortada: se ignora.
        }
      }
      nl = buf.indexOf('\n');
    }
  }
  const rest = buf.trim();
  if (rest) {
    try {
      on(JSON.parse(rest) as AssistantEvent);
    } catch {
      // nada
    }
  }
}
