'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { AgentConversationDto, AgentMessageDto, AgentToolCallDto } from '@/lib/agents-config';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { ToolCalls } from './AgentChat';
import { api, errorText, toolName } from './agents-ui';

interface Detail {
  conversation: AgentConversationDto;
  messages: AgentMessageDto[];
  toolCalls: AgentToolCallDto[];
}

const CHANNELS = ['all', 'chat', 'public', 'api', 'playground'] as const;

function Thumb({ down = false }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
      <path
        d="M7 11v9H4v-9h3Zm2 9h8.2a2 2 0 0 0 2-1.6l1.3-6.4A2 2 0 0 0 18.5 9.6H14l.7-3.6a2 2 0 0 0-3.6-1.5L9 9.4V20Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

/** Historial de conversaciones del agente (todos los canales), con feedback y log de herramientas. */
export default function AgentConversations({
  agentId,
  initialConversationId,
  onOpenPlayground,
}: {
  agentId: string;
  initialConversationId: string | null;
  onOpenPlayground?: () => void;
}) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('all');
  const [list, setList] = useState<AgentConversationDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string | null>(initialConversationId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  // Los cambios de feedback se mandan en orden (pulgar y después la nota).
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setListError(null);
    const q = channel === 'all' ? '' : `?channel=${channel}`;
    void api<{ conversations?: AgentConversationDto[] }>(`/api/agents/${agentId}/conversations${q}`).then((res) => {
      if (cancelled) return;
      if (res.ok) setList(res.data.conversations ?? []);
      else setListError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, channel, t, reloadKey]);

  const load = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setError(null);
      const res = await api<Detail>(`/api/agents/${agentId}/conversations/${id}`);
      setDetailLoading(false);
      if (res.ok) setDetail(res.data);
      else setError(errorText(t, res.data.error));
    },
    [agentId, t],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!selected) {
      setDetail(null);
      url.searchParams.delete('c');
      window.history.replaceState(null, '', url.toString());
      return;
    }
    void load(selected);
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
  const toolLabels = {
    name: (tool: string) => toolName(t, tool),
    input: t('chat.input'),
    output: t('chat.output'),
    error: t('chat.toolError'),
    running: t('chat.running'),
  };

  // Sin conversaciones en ningún canal: un solo estado vacío, sin el panel partido.
  if (channel === 'all' && list && list.length === 0) {
    return (
      <EmptyState
        product="agents"
        title={t('conversations.emptyTitle')}
        body={t('conversations.emptyBody')}
        action={
          onOpenPlayground ? (
            <button type="button" className="btn btn-primary" onClick={onOpenPlayground}>
              {t('conversations.tryPlayground')}
            </button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="ag-convs" data-view={selected ? 'detail' : 'list'}>
      <aside className="ag-convs-list" aria-label={t('tabs.conversations')}>
        <div className="ag-convs-filter">
          <div className="btn-group" role="group" aria-label={t('conversations.filter')}>
            {CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                className="btn btn-secondary btn-sm"
                aria-pressed={channel === c}
                onClick={() => setChannel(c)}
              >
                {c === 'all' ? t('conversations.all') : t(`channelNames.${c}`)}
              </button>
            ))}
          </div>
        </div>
        {listError ? (
          <div className="ag-pad">
            <p className="ui-error" role="alert">
              {listError}
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
              {t('conversations.retry')}
            </button>
          </div>
        ) : list === null ? (
          <div className="ag-pad ui-loading-stack" aria-busy="true">
            <span className="sr-only">{t('conversations.loading')}</span>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="ui-skeleton ui-skeleton-row" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="ui-help ag-pad">{t('conversations.empty')}</p>
        ) : (
          <ul className="ag-conv-items">
            {list.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="ag-conv-item"
                  aria-current={selected === c.id || undefined}
                  onClick={() => setSelected(c.id)}
                >
                  <span className="ag-conv-title">{c.title || t('conversations.untitled')}</span>
                  <span className="ag-conv-meta">
                    {t(`channelNames.${c.channel}`)} · {t('conversations.messages', { count: c.messageCount ?? 0 })} ·{' '}
                    <span suppressHydrationWarning>{format.relativeTime(new Date(c.updatedAt), now)}</span>
                  </span>
                  {c.handedOff && <span className="badge badge-warn ag-conv-badge">{t('conversations.handedOff')}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="ag-convs-detail" aria-live="polite" aria-busy={detailLoading || undefined}>
        {selected && (
          <button type="button" className="btn btn-ghost btn-sm ag-convs-back" onClick={() => setSelected(null)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {t('conversations.back')}
          </button>
        )}
        {error && (
          <p className="ui-error ag-pad" role="alert">
            {error}
          </p>
        )}
        {!selected ? (
          <p className="ui-help ag-pad">{t('conversations.pick')}</p>
        ) : detailLoading && !detail ? (
          <div className="ag-pad ui-loading-stack">
            <span className="sr-only">{t('conversations.loadingDetail')}</span>
            <span className="ui-skeleton ui-skeleton-title" />
            <span className="ui-skeleton ui-skeleton-text" />
            <span className="ui-skeleton ui-skeleton-block" />
          </div>
        ) : detail ? (
          <>
            <header className="ag-convs-head">
              <h3 className="ag-convs-title">{detail.conversation.title || t('conversations.untitled')}</h3>
              <span className="badge">{t(`channelNames.${detail.conversation.channel}`)}</span>
              {detail.conversation.handedOff && <span className="badge badge-warn">{t('conversations.handedOff')}</span>}
              {detail.conversation.chatConversationId && (
                <Link className="btn btn-ghost btn-sm ag-convs-inbox" href={`/app/chat/inbox/${detail.conversation.chatConversationId}`}>
                  {t('conversations.openInbox')}
                </Link>
              )}
            </header>
            <div className="ag-transcript">
              {detail.messages.map((m) => (
                <div key={m.id} className={`ag-msg is-${m.role}`}>
                  {m.runId && callsByRun.get(m.runId) && <ToolCalls calls={callsByRun.get(m.runId)!} labels={toolLabels} />}
                  <p className="ag-msg-text">{m.content}</p>
                  {m.role === 'assistant' && (
                    <div className="ag-rate">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        data-tone="ok"
                        aria-pressed={m.rating === 1}
                        aria-label={t('conversations.thumbsUp')}
                        title={t('conversations.thumbsUp')}
                        onClick={() => rate(m, m.rating === 1 ? 0 : 1)}
                      >
                        <Thumb />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-icon"
                        data-tone="bad"
                        aria-pressed={m.rating === -1}
                        aria-label={t('conversations.thumbsDown')}
                        title={t('conversations.thumbsDown')}
                        onClick={() => {
                          void rate(m, m.rating === -1 ? 0 : -1);
                          setNoteFor(m.rating === -1 ? null : m.id);
                          setNoteDraft(m.note ?? '');
                        }}
                      >
                        <Thumb down />
                      </button>
                      {m.note && noteFor !== m.id && <span className="ui-help ag-rate-note">“{m.note}”</span>}
                    </div>
                  )}
                  {noteFor === m.id && (
                    <form
                      className="ag-add-row"
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
                        aria-label={t('conversations.notePlaceholder')}
                        placeholder={t('conversations.notePlaceholder')}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setNoteFor(null);
                        }}
                      />
                      <button type="submit" className="btn btn-secondary btn-sm">
                        {t('conversations.saveNote')}
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            {unmatched.length > 0 && (
              <div className="ag-calllog">
                <h4 className="label">{t('conversations.toolLog')}</h4>
                <ToolCalls calls={unmatched} labels={toolLabels} />
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
