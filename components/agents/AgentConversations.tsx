'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { AgentConversationDto, AgentMessageDto, AgentToolCallDto } from '@/lib/agents-config';
import { Link } from '@/i18n/navigation';
import { api, errorText, toolName } from './agents-ui';

interface Detail {
  conversation: AgentConversationDto;
  messages: AgentMessageDto[];
  toolCalls: AgentToolCallDto[];
}

const CHANNELS = ['all', 'chat', 'public', 'api', 'playground'] as const;

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Historial de conversaciones del agente (todos los canales), con feedback y log de herramientas. */
export default function AgentConversations({
  agentId,
  initialConversationId,
}: {
  agentId: string;
  initialConversationId: string | null;
}) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('all');
  const [list, setList] = useState<AgentConversationDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initialConversationId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  // Los cambios de feedback se mandan en orden (pulgar y después la nota).
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const q = channel === 'all' ? '' : `?channel=${channel}`;
    void api<{ conversations?: AgentConversationDto[] }>(`/api/agents/${agentId}/conversations${q}`).then((res) => {
      if (cancelled) return;
      if (res.ok) setList(res.data.conversations ?? []);
      else setError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, channel, t]);

  const load = useCallback(
    async (id: string) => {
      const res = await api<Detail>(`/api/agents/${agentId}/conversations/${id}`);
      if (res.ok) setDetail(res.data);
      else setError(errorText(t, res.data.error));
    },
    [agentId, t],
  );

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void load(selected);
    const url = new URL(window.location.href);
    url.searchParams.set('c', selected);
    window.history.replaceState(null, '', url.toString());
  }, [selected, load]);

  async function rate(m: AgentMessageDto, rating: 1 | -1 | 0, note?: string) {
    if (!detail) return;
    setDetail({
      ...detail,
      messages: detail.messages.map((x) => (x.id === m.id ? { ...x, rating: rating || null, note: note ?? x.note } : x)),
    });
    const body = JSON.stringify({ conversationId: detail.conversation.id, messageId: m.id, rating, note: note ?? m.note ?? '' });
    const next = queue.current.then(() => api(`/api/agents/${agentId}/feedback`, { method: 'POST', body }));
    queue.current = next.catch(() => null);
    const res = await next;
    if (!res.ok) setError(errorText(t, res.data.error));
  }

  const callsByRun = new Map<string, AgentToolCallDto[]>();
  for (const c of detail?.toolCalls ?? []) {
    const arr = callsByRun.get(c.runId) ?? [];
    arr.push(c);
    callsByRun.set(c.runId, arr);
  }
  const shownRuns = new Set((detail?.messages ?? []).map((m) => m.runId).filter(Boolean) as string[]);
  const unmatched = (detail?.toolCalls ?? []).filter((c) => !shownRuns.has(c.runId));

  function renderCalls(calls: AgentToolCallDto[]) {
    return (
      <div className="ag-tools">
        {calls.map((c) => (
          <details key={c.id} className={`ag-tool${c.error ? ' is-error' : ''}`}>
            <summary>
              <span className="ag-tool-dot" aria-hidden="true" />
              <span className="ag-tool-name">{toolName(t, c.tool)}</span>
              <span className="ag-tool-meta mono">
                {c.tool} · {c.durationMs} ms{c.error ? ` · ${c.error}` : ''}
              </span>
            </summary>
            <div className="ag-tool-body">
              <p className="ag-tool-label">{t('chat.input')}</p>
              <pre>{pretty(c.input)}</pre>
              <p className="ag-tool-label">{c.error ? t('chat.toolError') : t('chat.output')}</p>
              <pre>{pretty(c.output)}</pre>
            </div>
          </details>
        ))}
      </div>
    );
  }

  return (
    <div className="ag-convs">
      <aside className="ag-convs-list">
        <div className="ag-segment" role="group" aria-label={t('conversations.filter')}>
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              className={channel === c ? 'is-active' : ''}
              aria-pressed={channel === c}
              onClick={() => setChannel(c)}
            >
              {c === 'all' ? t('conversations.all') : t(`channelNames.${c}`)}
            </button>
          ))}
        </div>
        {error && <p className="ag-error">{error}</p>}
        {list === null ? (
          <p className="muted ag-pad">{t('conversations.loading')}</p>
        ) : list.length === 0 ? (
          <p className="muted ag-pad">{t('conversations.empty')}</p>
        ) : (
          <ul>
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`ag-conv-item${selected === c.id ? ' is-active' : ''}`}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="ag-conv-title">{c.title || t('conversations.untitled')}</span>
                  <span className="ag-conv-meta mono">
                    {t(`channelNames.${c.channel}`)} · {t('conversations.messages', { count: c.messageCount ?? 0 })} ·{' '}
                    <span suppressHydrationWarning>{format.relativeTime(new Date(c.updatedAt), now)}</span>
                    {c.handedOff ? ` · ${t('conversations.handedOff')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="ag-convs-detail" aria-live="polite">
        {!detail ? (
          <p className="muted ag-pad">{t('conversations.pick')}</p>
        ) : (
          <>
            <header className="ag-convs-head">
              <h3>{detail.conversation.title || t('conversations.untitled')}</h3>
              <span className="muted mono">
                {t(`channelNames.${detail.conversation.channel}`)}
                {detail.conversation.handedOff ? ` · ${t('conversations.handedOff')}` : ''}
              </span>
              {detail.conversation.chatConversationId && (
                <Link className="ag-link" href={`/app/chat/inbox/${detail.conversation.chatConversationId}`}>
                  {t('conversations.openInbox')}
                </Link>
              )}
            </header>
            <div className="ag-transcript">
              {detail.messages.map((m) => (
                <div key={m.id} className={`ag-msg is-${m.role}`}>
                  {m.runId && callsByRun.get(m.runId) && renderCalls(callsByRun.get(m.runId)!)}
                  <p className="ag-msg-text">{m.content}</p>
                  {m.role === 'assistant' && (
                    <div className="ag-rate">
                      <button
                        type="button"
                        className={m.rating === 1 ? 'is-on' : ''}
                        aria-pressed={m.rating === 1}
                        aria-label={t('conversations.thumbsUp')}
                        onClick={() => rate(m, m.rating === 1 ? 0 : 1)}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                          <path d="M7 11v9H4v-9h3Zm2 9h8.2a2 2 0 0 0 2-1.6l1.3-6.4A2 2 0 0 0 18.5 9.6H14l.7-3.6a2 2 0 0 0-3.6-1.5L9 9.4V20Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={m.rating === -1 ? 'is-on is-down' : ''}
                        aria-pressed={m.rating === -1}
                        aria-label={t('conversations.thumbsDown')}
                        onClick={() => {
                          void rate(m, m.rating === -1 ? 0 : -1);
                          setNoteFor(m.rating === -1 ? null : m.id);
                          setNoteDraft(m.note ?? '');
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style={{ transform: 'rotate(180deg)' }}>
                          <path d="M7 11v9H4v-9h3Zm2 9h8.2a2 2 0 0 0 2-1.6l1.3-6.4A2 2 0 0 0 18.5 9.6H14l.7-3.6a2 2 0 0 0-3.6-1.5L9 9.4V20Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </button>
                      {m.note && noteFor !== m.id && <span className="muted ag-rate-note">“{m.note}”</span>}
                    </div>
                  )}
                  {noteFor === m.id && (
                    <form
                      className="ag-inline-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void rate(m, -1, noteDraft.trim());
                        setNoteFor(null);
                      }}
                    >
                      <input
                        className="input"
                        value={noteDraft}
                        maxLength={1000}
                        autoFocus
                        placeholder={t('conversations.notePlaceholder')}
                        onChange={(e) => setNoteDraft(e.target.value)}
                      />
                      <button type="submit" className="btn btn-small">
                        {t('conversations.saveNote')}
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            {unmatched.length > 0 && (
              <div className="ag-calllog">
                <h4 className="ag-section-title">{t('conversations.toolLog')}</h4>
                {renderCalls(unmatched)}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
