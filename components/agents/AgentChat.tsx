'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { isSimulatedOutput, type AgentReplyUi, type AgentStreamEvent } from '@/lib/agents-config';
import AgentReplyBlock from './AgentReplyBlock';

export interface ChatToolCall {
  id: string;
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string | null;
  durationMs?: number;
  done: boolean;
}

export interface ChatTurn {
  key: string;
  /** teammate: respuesta de una persona del equipo después de derivar. */
  role: 'user' | 'assistant' | 'teammate';
  text: string;
  tools: ChatToolCall[];
  pending?: boolean;
  error?: string | null;
  status?: string;
  handoff?: boolean;
  /** Botones o formulario de la respuesta. */
  ui?: AgentReplyUi | null;
}

export interface AgentChatLabels {
  placeholder: string;
  send: string;
  thinking: string;
  newConversation: string;
  handoff: string;
  stepLimit: string;
  input: string;
  output: string;
  toolError: string;
  running: string;
  /** Aviso fijo cuando la conversación ya está con una persona del equipo. */
  handedOffNotice?: string;
  /** Etiqueta de las respuestas de una persona del equipo. */
  teammate?: string;
  /** Herramienta simulada (playground en modo dry run) y lo que habría hecho. */
  simulated?: string;
  wouldRun?: string;
  /** Botón para guardar la pregunta como caso de prueba. */
  saveTest?: string;
  /** Formularios del chat: enviar, obligatorio y elegir. */
  formSend?: string;
  formRequired?: string;
  formChoose?: string;
  /** Mensaje para un código de error (agents.errors.*). */
  error: (code: string) => string;
  toolName: (tool: string) => string;
}

interface Props {
  endpoint: string;
  labels: AgentChatLabels;
  welcome?: string;
  /** Campos extra del body (p. ej. visitorKey en la página pública). */
  extraBody?: Record<string, unknown>;
  /** Muestra las herramientas con su input/output (playground). */
  showTools?: boolean;
  /** Clave de localStorage para recordar la conversación (página pública). */
  storageKey?: string;
  disabledReason?: string | null;
  /** Avisa el id de conversación (playground → refrescar historial). */
  onConversation?: (id: string | null) => void;
  variant?: 'panel' | 'page';
  /**
   * URL del historial de la conversación (página pública). Con ella el chat
   * recupera la conversación guardada y, si está derivada, consulta cada
   * pocos segundos las respuestas del equipo.
   */
  historyUrl?: (conversationId: string) => string;
  /** Guarda la pregunta de un turno como caso de prueba (playground). */
  onSaveTest?: (question: string) => void;
}

interface HistoryResponse {
  handedOff: boolean;
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'teammate'; content: string; ui?: AgentReplyUi | null }>;
}

const POLL_MS = 5000;

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* modo privado */
  }
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Chat con un agente sobre el stream NDJSON de /api/agents/**: texto en vivo,
 * herramientas (playground) y derivación. Sin dependencias de UI de AI SDK.
 */
export default function AgentChat({
  endpoint,
  labels,
  welcome,
  extraBody,
  showTools = false,
  storageKey,
  disabledReason,
  onConversation,
  variant = 'panel',
  historyUrl,
  onSaveTest,
}: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [handedOff, setHandedOff] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const historyRef = useRef(historyUrl);
  historyRef.current = historyUrl;

  useEffect(() => {
    if (storageKey) setConversationId(storageGet(storageKey));
    return () => abortRef.current?.abort();
  }, [storageKey]);

  // Historial del servidor (fuente de verdad): al volver a la página y, con
  // la conversación derivada, cada POLL_MS para traer las respuestas del equipo.
  async function loadHistory(id: string): Promise<void> {
    const url = historyRef.current?.(id);
    if (!url || busyRef.current) return;
    const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json().catch(() => null)) as HistoryResponse | null;
    if (!data || busyRef.current) return;
    setHandedOff(data.handedOff);
    setTurns(data.messages.map((m) => ({ key: m.id, role: m.role, text: m.content, tools: [], ui: m.ui ?? null })));
  }

  const canLoad = Boolean(historyUrl);
  useEffect(() => {
    if (conversationId && canLoad) void loadHistory(conversationId);
    // Solo al recuperar la conversación guardada (no en cada mensaje).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad, storageKey, conversationId === null]);

  useEffect(() => {
    if (!handedOff || !conversationId || !canLoad) return;
    const timer = window.setInterval(() => void loadHistory(conversationId), POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handedOff, conversationId, canLoad]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  function patchLast(fn: (t: ChatTurn) => ChatTurn) {
    setTurns((list) => {
      const copy = list.slice();
      const i = copy.length - 1;
      if (i >= 0) copy[i] = fn(copy[i]);
      return copy;
    });
  }

  function handle(e: AgentStreamEvent) {
    switch (e.type) {
      case 'start':
        setConversationId(e.conversationId);
        if (storageKey) storageSet(storageKey, e.conversationId);
        onConversation?.(e.conversationId);
        break;
      case 'text':
        patchLast((t) => ({ ...t, text: t.text + e.delta }));
        break;
      case 'tool-start':
        patchLast((t) => ({ ...t, tools: [...t.tools, { id: e.id, tool: e.tool, input: e.input, done: false }] }));
        break;
      case 'tool-end':
        patchLast((t) => ({
          ...t,
          tools: t.tools.map((c) =>
            c.id === e.id ? { ...c, output: e.output, error: e.error, durationMs: e.durationMs, done: true } : c,
          ),
        }));
        break;
      case 'done':
        if (e.handoff) setHandedOff(true);
        if (e.status === 'handed_off') {
          // Ya está con una persona: no hay respuesta del agente que mostrar.
          setTurns((list) => {
            const last = list[list.length - 1];
            return last && last.role === 'assistant' && !last.text ? list.slice(0, -1) : list;
          });
          break;
        }
        patchLast((t) => ({ ...t, text: e.text || t.text, pending: false, status: e.status, handoff: e.handoff, ui: e.ui ?? null }));
        break;
      case 'error':
        patchLast((t) => ({ ...t, pending: false, error: e.code }));
        break;
    }
  }

  async function send(text: string, form?: { id: string; values: Record<string, string> }) {
    const message = text.trim();
    if (!message || busy || disabledReason) return;
    setBusy(true);
    busyRef.current = true;
    setDraft('');
    const stamp = Date.now();
    setTurns((list) => [
      ...list,
      { key: `u${stamp}`, role: 'user', text: message, tools: [] },
      { key: `a${stamp}`, role: 'assistant', text: '', tools: [], pending: true },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...extraBody, conversationId, message, ...(form ? { form } : {}) }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        handle({ type: 'error', code: data?.error ?? (res.status === 429 ? 'rate_limited' : 'generic') });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              handle(JSON.parse(line) as AgentStreamEvent);
            } catch {
              /* línea parcial o inválida */
            }
          }
          nl = buffer.indexOf('\n');
        }
      }
      patchLast((t) => (t.pending ? { ...t, pending: false } : t));
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') handle({ type: 'error', code: 'network' });
    } finally {
      setBusy(false);
      busyRef.current = false;
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setTurns([]);
    setHandedOff(false);
    setConversationId(null);
    if (storageKey) storageSet(storageKey, null);
    onConversation?.(null);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  }

  // Botones y formularios: solo en la última respuesta (si el visitante ya contestó, quedan atrás).
  const lastAssistant = turns.length > 0 && turns[turns.length - 1].role === 'assistant' ? turns.length - 1 : -1;

  return (
    <div className={`ag-chat ag-chat-${variant}`}>
      <div className="ag-chat-list" ref={listRef} aria-live="polite">
        {welcome && (
          <div className="ag-msg is-assistant">
            <p className="ag-msg-text">{welcome}</p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={t.key} className={`ag-msg is-${t.role === 'teammate' ? 'assistant' : t.role}`}>
            {t.role === 'teammate' && labels.teammate && <p className="ag-msg-author label">{labels.teammate}</p>}
            {showTools && t.tools.length > 0 && (
              <ToolCalls
                calls={t.tools}
                labels={{
                  name: labels.toolName,
                  input: labels.input,
                  output: labels.output,
                  error: labels.toolError,
                  running: labels.running,
                  simulated: labels.simulated,
                  wouldRun: labels.wouldRun,
                }}
              />
            )}
            {(t.text || t.role === 'user') && <p className="ag-msg-text">{t.text}</p>}
            {t.role === 'user' && onSaveTest && labels.saveTest && (
              <button type="button" className="btn btn-ghost btn-sm ag-save-test" onClick={() => onSaveTest(t.text)}>
                {labels.saveTest}
              </button>
            )}
            {t.pending && !t.text && (
              <div className="ag-thinking" aria-busy="true">
                <span className="ui-skeleton ui-skeleton-text" />
                <span className="ui-skeleton ui-skeleton-text ag-thinking-short" />
                <span className="sr-only">{labels.thinking}</span>
              </div>
            )}
            {t.role === 'assistant' && t.ui && !t.pending && i === lastAssistant && !busy && !disabledReason && (
              <AgentReplyBlock
                ui={t.ui}
                labels={{ send: labels.formSend ?? labels.send, required: labels.formRequired ?? '', choose: labels.formChoose ?? '' }}
                onChoose={(option) => void send(option)}
                onSubmit={(formId, values, text) => void send(text, { id: formId, values })}
              />
            )}
            {t.error && <p className="ui-error">{labels.error(t.error)}</p>}
            {t.handoff && <p className="ui-help">{labels.handoff}</p>}
            {t.status === 'step_limit' && showTools && <p className="ui-help">{labels.stepLimit}</p>}
          </div>
        ))}
      </div>
      {handedOff && labels.handedOffNotice && (
        <p className="ag-chat-handed ui-help" role="status">
          {labels.handedOffNotice}
        </p>
      )}
      {disabledReason ? (
        <p className="ag-chat-disabled">{disabledReason}</p>
      ) : (
        <form className="ag-chat-form" onSubmit={onSubmit}>
          <textarea
            className="ag-chat-input"
            rows={1}
            value={draft}
            maxLength={4000}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="ag-chat-actions">
            {turns.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
                {labels.newConversation}
              </button>
            )}
            <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()} aria-busy={busy || undefined}>
              {labels.send}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export interface ToolCallView {
  id: string;
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string | null;
  durationMs?: number;
  done?: boolean;
}

/** Llamadas a herramientas de un turno: una fila por llamada, entrada y salida al abrirla. */
export function ToolCalls({
  calls,
  labels,
}: {
  calls: ToolCallView[];
  labels: {
    name: (tool: string) => string;
    input: string;
    output: string;
    error: string;
    running: string;
    simulated?: string;
    wouldRun?: string;
  };
}) {
  return (
    <ul className="ag-tools">
      {calls.map((c) => {
        const done = c.done !== false;
        const sim = done && !c.error && isSimulatedOutput(c.output);
        return (
          <li key={c.id}>
            <details className="ag-tool">
              <summary>
                <svg className="ag-tool-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
                <span className="ag-tool-name">{labels.name(c.tool)}</span>
                {!done ? (
                  <span className="badge">{labels.running}</span>
                ) : c.error ? (
                  <span className="badge badge-bad">{labels.error}</span>
                ) : sim && labels.simulated ? (
                  <span className="badge badge-warn">{labels.simulated}</span>
                ) : null}
                {done && c.durationMs !== undefined && <span className="ag-tool-ms data">{c.durationMs} ms</span>}
              </summary>
              <div className="ag-tool-body">
                <p className="label">{labels.input}</p>
                <pre className="data">{pretty(c.input)}</pre>
                {done && sim && isSimulatedOutput(c.output) ? (
                  <>
                    <p className="label">{labels.wouldRun ?? labels.output}</p>
                    <pre className="data">{pretty(c.output.wouldRun)}</pre>
                  </>
                ) : done ? (
                  <>
                    <p className="label">{c.error ? `${labels.error}: ${c.error}` : labels.output}</p>
                    <pre className="data">{pretty(c.output)}</pre>
                  </>
                ) : null}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
