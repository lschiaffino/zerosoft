'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { ActionView } from '@/lib/assistant/engine';
import {
  ASSISTANT_APPLIED_EVENT,
  ASSISTANT_CHATS_EVENT,
  readEvents,
  toChatItems,
  type AssistantStatus,
  type ChatItem,
  type ChatPart,
  type StoredMessage,
} from './client';

export interface PageInfo {
  path: string;
  title?: string;
  selection?: string;
}

const ERROR_KEYS = new Set(['not_configured', 'ai_disabled', 'quota_exceeded', 'rate_limited', 'provider_auth', 'provider_error', 'network']);

function errorKey(code: string | undefined): string {
  return `errors.${code && ERROR_KEYS.has(code) ? code : 'provider_error'}`;
}

function short(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2) ?? '';
    return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s;
  } catch {
    return String(value);
  }
}

/** Tarjeta de una herramienta: colapsada, se expande con lo que pidió y lo que volvió. */
function ToolCard({ part }: { part: Extract<ChatPart, { type: 'tool' }> }) {
  const t = useTranslations('assistant');
  const status = part.running ? t('tool.running') : part.ok ? t('tool.ok') : t('tool.failed');
  return (
    <details className="asst-tool" data-testid="assistant-tool-card" data-tool={part.tool}>
      <summary>
        <span className="asst-tool-name">{t('tool.used', { tool: part.tool })}</span>
        <span className={`asst-tool-status${part.running ? ' is-running' : part.ok ? '' : ' is-failed'}`}>{status}</span>
      </summary>
      <div className="asst-tool-body">
        <p className="asst-tool-label">{t('tool.input')}</p>
        <pre>{short(part.input)}</pre>
        {!part.running && (
          <>
            <p className="asst-tool-label">{t('tool.output')}</p>
            <pre>{short(part.output)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

/** Valor de un campo de la tarjeta: completo; si es largo, se abre con un expansor (se ve todo lo que se va a escribir). */
function DetailValue({ value }: { value: string }) {
  const t = useTranslations('assistant');
  if (value.length <= 160 && !value.includes('\n')) return <span>{value}</span>;
  return (
    <details className="asst-action-long">
      <summary>
        {value.split('\n')[0].slice(0, 120)}… <span className="muted">({t('action.showAll', { count: value.length })})</span>
      </summary>
      <pre>{value}</pre>
    </details>
  );
}

/** Tarjeta de confirmación: resumen, qué cambia y Confirmar / Cancelar (tipeado si es destructiva). */
function ActionCard({ action, onDecided }: { action: ActionView; onDecided: (a: ActionView) => void }) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsText = action.destructive && action.confirmText;
  const matches = !needsText || typed.trim().toLowerCase() === action.confirmText!.trim().toLowerCase();

  async function decide(decision: 'confirm' | 'cancel') {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/assistant/actions/${action.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, typed, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { action?: ActionView; error?: string } | null;
    setBusy(false);
    if (data?.action) onDecided(data.action);
    if (!res?.ok) {
      setError(t(`actionErrors.${data?.error && ['forbidden', 'confirm_text_mismatch', 'not_pending', 'not_found'].includes(data.error) ? data.error : 'failed'}`));
      return;
    }
    if (decision === 'confirm' && data?.action?.status === 'done') {
      window.dispatchEvent(new CustomEvent(ASSISTANT_APPLIED_EVENT, { detail: { tool: action.tool } }));
      router.refresh();
    }
  }

  const pending = action.status === 'pending';
  return (
    <div className={`asst-action${action.destructive ? ' is-destructive' : ''}`} data-testid="assistant-action" data-status={action.status}>
      <p className="asst-action-kicker">{action.destructive ? t('action.destructive') : t('action.review')}</p>
      <p className="asst-action-summary">{action.summary}</p>
      {action.details.length > 0 && (
        <dl className="asst-action-details">
          {action.details.map((d, i) => (
            <div key={i}>
              <dt>{d.label}</dt>
              <dd>
                {d.before != null && d.before !== '' && (
                  <>
                    <del>{d.before}</del>
                    <span aria-hidden="true"> → </span>
                  </>
                )}
                <DetailValue value={d.after} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {pending ? (
        <>
          {needsText && (
            <label className="asst-action-typed">
              <span>{t('action.typeToConfirm', { text: action.confirmText! })}</span>
              <input
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches) {
                    e.preventDefault();
                    void decide('confirm');
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
          <div className="asst-action-buttons">
            <button
              type="button"
              className={`btn btn-sm btn-primary${action.destructive ? ' btn-danger' : ''}`}
              onClick={() => void decide('confirm')}
              disabled={busy || !matches}
            >
              {busy ? t('action.working') : t('action.confirm')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void decide('cancel')} disabled={busy}>
              {t('action.cancel')}
            </button>
          </div>
        </>
      ) : (
        <p className={`asst-action-result is-${action.status}`} role="status">
          {action.status === 'done'
            ? action.result?.message || t('action.done')
            : action.status === 'cancelled'
              ? t('action.cancelled')
              : action.status === 'running'
                ? t('action.working')
                : t('action.failed', { error: action.result?.error ?? '' })}
          {action.status === 'done' && action.result?.href && (
            <>
              {' '}
              <Link href={action.result.href}>{t('action.open')}</Link>
            </>
          )}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * La charla: mensajes, tarjetas de herramientas y de acciones, y el campo
 * para escribir. La comparten el panel lateral y la página del asistente.
 */
export default function AssistantChat({
  conversationId,
  onConversation,
  status,
  statusError,
  page,
  suggestions,
  initialPrompt,
  compact = false,
  inputRef: externalInputRef,
}: {
  conversationId: string | null;
  onConversation: (id: string, title: string) => void;
  status: AssistantStatus | null;
  statusError?: boolean;
  page: PageInfo | null;
  suggestions: string[];
  initialPrompt?: string | null;
  compact?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = externalInputRef ?? ownRef;
  const listRef = useRef<HTMLDivElement>(null);
  /** La charla que creó este componente al mandar (no se recarga encima del stream). */
  const createdRef = useRef<string | null>(null);
  const sentInitial = useRef(false);

  const [hasMore, setHasMore] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(false);
    const res = await fetch(`/api/assistant/conversations/${id}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { messages?: StoredMessage[]; actions?: ActionView[]; hasMore?: boolean } | null;
    setLoading(false);
    if (!res?.ok || !data?.messages) {
      setLoadError(true);
      setItems([]);
      return;
    }
    setItems(toChatItems(data.messages, data.actions ?? []));
    setHasMore(Boolean(data.hasMore));
  }, []);

  /** Charlas largas: los mensajes anteriores de a 100. */
  async function loadEarlier() {
    const oldest = items[0];
    if (!conversationId || !oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    const res = await fetch(`/api/assistant/conversations/${conversationId}?before=${encodeURIComponent(oldest.id)}`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { messages?: StoredMessage[]; actions?: ActionView[]; hasMore?: boolean } | null;
    setLoadingEarlier(false);
    if (!res?.ok || !data?.messages) return;
    setItems((prev) => [...toChatItems(data.messages!, data.actions ?? []), ...prev]);
    setHasMore(Boolean(data.hasMore));
  }

  useEffect(() => {
    if (!conversationId) {
      setItems([]);
      setLoadError(false);
      return;
    }
    if (createdRef.current === conversationId) return;
    void load(conversationId);
  }, [conversationId, load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, busy]);

  const updateAction = useCallback((a: ActionView) => {
    setItems((prev) => prev.map((m) => ({ ...m, parts: m.parts.map((p) => (p.type === 'action' && p.action.id === a.id ? { ...p, action: a } : p)) })));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setDraft('');
      setBusy(true);
      const userItem: ChatItem = { id: `u-${Date.now()}`, role: 'user', content: text, parts: [] };
      const replyId = `a-${Date.now()}`;
      setItems((prev) => [...prev, userItem, { id: replyId, role: 'assistant', content: '', parts: [], streaming: true }]);
      const patch = (fn: (m: ChatItem) => ChatItem) => setItems((prev) => prev.map((m) => (m.id === replyId ? fn(m) : m)));
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text, page, locale }),
      }).catch(() => null);
      if (!res || !res.ok || !res.body) {
        const data = (await res?.json().catch(() => null)) as { error?: string } | null;
        patch((m) => ({ ...m, streaming: false, error: data?.error ?? 'network' }));
        setBusy(false);
        return;
      }
      await readEvents(res, (e) => {
        if (e.type === 'conversation') {
          createdRef.current = e.id;
          onConversation(e.id, e.title);
          window.dispatchEvent(new CustomEvent(ASSISTANT_CHATS_EVENT));
        } else if (e.type === 'text') {
          patch((m) => ({ ...m, content: m.content + e.delta }));
        } else if (e.type === 'tool') {
          patch((m) => ({ ...m, parts: [...m.parts, { type: 'tool', callId: e.callId, tool: e.tool, input: e.input, running: true }] }));
        } else if (e.type === 'tool-result') {
          patch((m) => ({
            ...m,
            parts: m.parts.map((p) => (p.type === 'tool' && p.callId === e.callId ? { ...p, output: e.output, ok: e.ok, running: false } : p)),
          }));
        } else if (e.type === 'action') {
          patch((m) => ({ ...m, parts: [...m.parts, { type: 'action', action: e.action }] }));
        } else if (e.type === 'error') {
          patch((m) => ({ ...m, error: e.code }));
        } else if (e.type === 'done') {
          patch((m) => ({ ...m, streaming: false }));
        }
      }).catch(() => patch((m) => ({ ...m, error: m.error ?? 'network' })));
      patch((m) => ({ ...m, streaming: false, parts: m.parts.map((p) => (p.type === 'tool' && p.running ? { ...p, running: false } : p)) }));
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [busy, conversationId, page, locale, onConversation, inputRef],
  );

  // Pregunta que llega desde el inicio (?q=) o desde ⌘K: se manda una vez.
  useEffect(() => {
    if (!initialPrompt || sentInitial.current || status?.state !== 'ready') return;
    sentInitial.current = true;
    void send(initialPrompt);
  }, [initialPrompt, status, send]);

  if (statusError) {
    return (
      <div className="asst-state" role="alert">
        <p>{t('errors.status')}</p>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="asst-state" role="status">
        <p className="muted">{t('loading')}</p>
      </div>
    );
  }
  if (status.state !== 'ready') {
    return (
      <div className="asst-state" data-testid="assistant-not-configured">
        <p className="asst-state-title">{status.state === 'disabled' ? t('notConfigured.disabledTitle') : t('notConfigured.title')}</p>
        <p className="muted">{status.admin ? t('notConfigured.admin') : t('notConfigured.member')}</p>
      </div>
    );
  }

  return (
    <div className={`asst-chat${compact ? ' is-compact' : ''}`}>
      <div className="asst-messages" ref={listRef} aria-live="polite" aria-busy={busy || loading}>
        {loading ? (
          <p className="muted" role="status">
            {t('loading')}
          </p>
        ) : loadError ? (
          <p className="form-error" role="alert">
            {t('errors.load')}
          </p>
        ) : items.length === 0 ? (
          <div className="asst-empty">
            <p className="asst-empty-title">{t('empty.title')}</p>
            <p className="muted">{t('empty.body')}</p>
            <ul className="asst-suggestions" aria-label={t('empty.suggestions')}>
              {suggestions.map((s) => (
                <li key={s}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
          {hasMore && (
            <button type="button" className="btn btn-ghost btn-sm asst-load-earlier" onClick={() => void loadEarlier()} disabled={loadingEarlier}>
              {loadingEarlier ? t('loading') : t('loadEarlier')}
            </button>
          )}
          {items.map((m) => (
            <div key={m.id} className={`asst-msg asst-msg-${m.role}`} data-testid={`assistant-msg-${m.role}`}>
              {m.parts.map((p) =>
                p.type === 'tool' ? <ToolCard key={p.callId} part={p} /> : <ActionCard key={p.action.id} action={p.action} onDecided={updateAction} />,
              )}
              {m.content && <p className="asst-msg-text">{m.content}</p>}
              {m.streaming && !m.content && !m.error && (
                <p className="muted asst-thinking" role="status">
                  {t('thinking')}
                </p>
              )}
              {m.error && (
                <p className="form-error" role="alert">
                  {t(errorKey(m.error))}
                </p>
              )}
            </div>
          ))}
          </>
        )}
      </div>
      <form
        className="asst-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        {page?.selection && <p className="asst-context muted">{t('usingSelection')}</p>}
        <div className="asst-form-row">
          <label className="sr-only" htmlFor={compact ? 'asst-input-panel' : 'asst-input-page'}>
            {t('placeholder')}
          </label>
          <textarea
            id={compact ? 'asst-input-panel' : 'asst-input-page'}
            ref={inputRef}
            className="textarea"
            rows={2}
            value={draft}
            maxLength={4000}
            placeholder={t('placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()}>
            {busy ? t('sending') : t('send')}
          </button>
        </div>
        <p className="asst-foot muted">{t('foot')}</p>
      </form>
    </div>
  );
}
