/**
 * Conversaciones del chat de una reunión ("Nuevo chat" abre otra, el
 * historial las lista). Los mensajes guardados antes de esto no tienen
 * `thread`: son la primera conversación ('').
 */
import type { VoiceChatMessage } from './voice-types';

export interface ChatThread {
  id: string;
  /** La primera pregunta. */
  title: string;
  /** Preguntas hechas. */
  turns: number;
  lastAt: string;
}

/** Conversaciones con al menos una pregunta, la más reciente primero. */
export function chatThreads(messages: VoiceChatMessage[]): ChatThread[] {
  const map = new Map<string, ChatThread>();
  for (const m of messages) {
    const id = m.thread ?? '';
    const cur = map.get(id) ?? { id, title: '', turns: 0, lastAt: m.at };
    if (m.role === 'user') {
      if (!cur.title) cur.title = m.text.length > 60 ? `${m.text.slice(0, 59)}…` : m.text;
      cur.turns += 1;
    }
    if (m.at > cur.lastAt) cur.lastAt = m.at;
    map.set(id, cur);
  }
  return [...map.values()].filter((x) => x.turns > 0).sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

export function newThreadId(): string {
  return Math.random().toString(36).slice(2, 10);
}
