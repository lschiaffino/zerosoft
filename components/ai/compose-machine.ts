/**
 * Estados de la barra "Ayudame a escribir". Función pura (sin React ni red)
 * para poder probarla: el hook (useAiCompose) le manda eventos y dibuja lo que
 * sale.
 *
 *   idle ──start──▶ working ──done──▶ review ──start──▶ working ...
 *                      │ fail / cancel / texto vacío
 *                      ▼
 *            vuelve a review si había un borrador, si no a idle
 *
 * Cada pedido lleva un número (`run`, lo elige quien lo manda y nunca se
 * repite). Lo que llega de un pedido viejo (cancelado o pisado por otro) se
 * ignora: nunca pisa lo que se está viendo.
 */
import type { ComposeChange } from '@/lib/ai-compose';

export type ComposeRequest =
  /** Mensaje nuevo desde una descripción. Sin instrucción: sugerir la respuesta al último mensaje. */
  | { kind: 'draft'; instruction: string }
  /** Cambiar un texto: uno de los cambios fijos, o `custom` con la instrucción escrita. */
  | { kind: 'rewrite'; text: string; change: ComposeChange | 'custom'; instruction?: string }
  | { kind: 'translate'; text: string; to: string };

export interface ComposeVersion {
  text: string;
  /** De dónde salió (respuestas rápidas, páginas), si el producto lo informa. */
  sources: string[];
  /** El pedido que la produjo, para "Otra versión". */
  request: ComposeRequest;
}

export interface ComposeState {
  phase: 'idle' | 'working' | 'review';
  /** El borrador que se está revisando. */
  current: ComposeVersion | null;
  /** Texto que va llegando del pedido en curso. */
  partial: string;
  /** Pedido en curso. `replace`: es "Otra versión" (pisa la actual en vez de apilarla). */
  pending: { request: ComposeRequest; replace: boolean } | null;
  /** Versiones anteriores (la más nueva al final). */
  history: ComposeVersion[];
  /** Código de error del último pedido (la UI lo pasa a una frase). */
  error: string | null;
  /** Número del pedido en curso; 0 si no hay ninguno. */
  run: number;
}

export type ComposeEvent =
  | { type: 'start'; run: number; request: ComposeRequest; replace?: boolean }
  | { type: 'chunk'; run: number; text: string }
  | { type: 'done'; run: number; text: string; sources?: string[] }
  | { type: 'fail'; run: number; code: string }
  | { type: 'cancel' }
  | { type: 'back' }
  | { type: 'discard' };

const MAX_HISTORY = 10;

export const initialCompose: ComposeState = { phase: 'idle', current: null, partial: '', pending: null, history: [], error: null, run: 0 };

function settle(s: ComposeState, error: string | null): ComposeState {
  return { ...s, phase: s.current ? 'review' : 'idle', partial: '', pending: null, error, run: 0 };
}

export function composeReducer(s: ComposeState, e: ComposeEvent): ComposeState {
  switch (e.type) {
    case 'start':
      return { ...s, phase: 'working', partial: '', pending: { request: e.request, replace: e.replace === true }, error: null, run: e.run };
    case 'chunk':
      if (s.phase !== 'working' || e.run !== s.run) return s;
      return { ...s, partial: e.text };
    case 'done': {
      if (s.phase !== 'working' || e.run !== s.run || !s.pending) return s;
      const text = e.text.trim();
      if (!text) return settle(s, 'empty_result');
      const history = s.current && !s.pending.replace ? [...s.history, s.current].slice(-MAX_HISTORY) : s.history;
      return { ...s, phase: 'review', current: { text, sources: e.sources ?? [], request: s.pending.request }, partial: '', pending: null, history, error: null, run: 0 };
    }
    case 'fail':
      if (s.phase !== 'working' || e.run !== s.run) return s;
      return settle(s, e.code);
    case 'cancel':
      if (s.phase !== 'working') return s;
      return settle(s, null);
    case 'back': {
      if (s.phase !== 'review' || s.history.length === 0) return s;
      return { ...s, current: s.history[s.history.length - 1], history: s.history.slice(0, -1), error: null };
    }
    case 'discard':
      return initialCompose;
  }
}

/** Lo que se muestra en la vista previa: lo que va llegando, o el borrador actual. */
export function shownDraft(s: ComposeState): string {
  return s.phase === 'working' ? s.partial : (s.current?.text ?? '');
}

/**
 * Qué pedir cuando la persona aprieta Enter en el campo. Con un borrador a la
 * vista (o con texto propio en el composer) el campo describe un cambio; con
 * todo vacío, describe el mensaje.
 */
export function requestFromPrompt(s: ComposeState, composerText: string, prompt: string): ComposeRequest | null {
  const ask = prompt.trim();
  if (!ask) return null;
  const base = s.current?.text ?? composerText.trim();
  if (base) return { kind: 'rewrite', text: base, change: 'custom', instruction: ask };
  return { kind: 'draft', instruction: ask };
}
