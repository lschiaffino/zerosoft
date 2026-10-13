'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AgentStreamEvent } from '@/lib/agents-config';

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
  role: 'user' | 'assistant';
  text: string;
  tools: ChatToolCall[];
  pending?: boolean;
  error?: string | null;
  status?: string;
  handoff?: boolean;
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
}

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
}: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (storageKey) setConversationId(storageGet(storageKey));
    return () => abortRef.current?.abort();
  }, [storageKey]);

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
        patchLast((t) => ({ ...t, text: e.text || t.text, pending: false, status: e.status, handoff: e.handoff }));
        break;
      case 'error':
        patchLast((t) => ({ ...t, pending: false, error: e.code }));
        break;
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || disabledReason) return;
    setBusy(true);
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
        body: JSON.stringify({ ...extraBody, conversationId, message }),
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
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setTurns([]);
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

  return (
    <div className={`ag-chat ag-chat-${variant}`}>
      <div className="ag-chat-list" ref={listRef} aria-live="polite">
        {welcome && (
          <div className="ag-msg is-assistant">
            <p className="ag-msg-text">{welcome}</p>
          </div>
        )}
        {turns.map((t) => (
          <div key={t.key} className={`ag-msg is-${t.role}`}>
            {showTools && t.tools.length > 0 && (
              <div className="ag-tools">
                {t.tools.map((c) => (
                  <details key={c.id} className={`ag-tool${c.error ? ' is-error' : ''}${c.done ? '' : ' is-running'}`}>
                    <summary>
                      <span className="ag-tool-dot" aria-hidden="true" />
                      <span className="ag-tool-name">{labels.toolName(c.tool)}</span>
                      <span className="ag-tool-meta mono">
                        {c.tool}
                        {c.done && c.durationMs !== undefined ? ` · ${c.durationMs} ms` : ''}
                        {c.error ? ` · ${c.error}` : ''}
                      </span>
                    </summary>
                    <div className="ag-tool-body">
                      <p className="ag-tool-label">{labels.input}</p>
                      <pre>{pretty(c.input)}</pre>
                      {c.done && (
                        <>
                          <p className="ag-tool-label">{c.error ? labels.toolError : labels.output}</p>
                          <pre>{pretty(c.output)}</pre>
                        </>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
            {(t.text || t.role === 'user') && <p className="ag-msg-text">{t.text}</p>}
            {t.pending && !t.text && (
              <p className="ag-msg-text ag-thinking">
                <span className="ag-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="ag-sr-only">{labels.thinking}</span>
              </p>
            )}
            {t.error && <p className="ag-msg-error">{labels.error(t.error)}</p>}
            {t.handoff && <p className="ag-msg-note">{labels.handoff}</p>}
            {t.status === 'step_limit' && showTools && <p className="ag-msg-note">{labels.stepLimit}</p>}
          </div>
        ))}
      </div>
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
              <button type="button" className="ag-link" onClick={reset} disabled={busy}>
                {labels.newConversation}
              </button>
            )}
            <button type="submit" className="ag-send" disabled={busy || !draft.trim()}>
              {labels.send}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
