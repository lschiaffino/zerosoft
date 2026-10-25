'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { AgentConversationDto, AgentMessageDto, AgentPendingActionDto, AgentToolCallDto } from '@/lib/agents-config';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import { ToolCalls } from './AgentChat';
import { api, errorText, toolName } from './agents-ui';
import AgentApprovals from './AgentApprovals';
import { parseDbUtc } from '@/lib/utils';

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
  // El tiempo relativo depende del reloj: se calcula recién en el cliente para no romper la hidratación.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
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
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  /** Acciones que pidieron aprobación en la conversación abierta, y pendientes por conversación (lista). */
  const [actions, setActions] = useState<AgentPendingActionDto[]>([]);
  const [pendingBy, setPendingBy] = useState<Map<string, number>>(new Map());
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
    void api<{ actions?: AgentPendingActionDto[] }>(`/api/agents/${agentId}/approvals?status=pending`).then((res) => {
      if (cancelled || !res.ok) return;
      const counts = new Map<string, number>();
      for (const a of res.data.actions ?? []) counts.set(a.conversationId, (counts.get(a.conversationId) ?? 0) + 1);
      setPendingBy(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, channel, t, reloadKey]);

  const load = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      setError(null);
      const [res, acts] = await Promise.all([
        api<Detail>(`/api/agents/${agentId}/conversations/${id}`),
        api<{ actions?: AgentPendingActionDto[] }>(`/api/agents/${agentId}/approvals?conversationId=${encodeURIComponent(id)}`),
      ]);
      setDetailLoading(false);
      setActions(acts.ok ? (acts.data.actions ?? []) : []);
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
    simulated: t('chat.simulated'),
    wouldRun: t('chat.wouldRun'),
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

  async function sendReply() {
    if (!detail || replying || !reply.trim()) return;
    setReplying(true);
    setReplyError(null);
    const res = await api<{ message?: AgentMessageDto }>(`/api/agents/${agentId}/conversations/${detail.conversation.id}`, {
      method: 'POST',
      body: JSON.stringify({ message: reply }),
    });
    setReplying(false);
    if (!res.ok || !res.data.message) {
      setReplyError(errorText(t, res.data.error));
      return;
    }
    const message = res.data.message;
    setReply('');
    setDetail((d) => (d ? { ...d, conversation: { ...d.conversation, handedOff: true }, messages: [...d.messages, message] } : d));
  }

  return (
    <div className="ag-convs" data-view={selected ? 'detail' : 'list'}>
      <aside className="ag-convs-list" aria-label={t('tabs.conversations')}>
        <div className="ui-tabs ag-convs-filter" role="group" aria-label={t('conversations.filter')}>
          {CHANNELS.map((c) => (
            <button
              key={c}
              type="button"
              className={`ui-tab${channel === c ? ' active' : ''}`}
              aria-pressed={channel === c}
              onClick={() => setChannel(c)}
            >
              {c === 'all' ? t('conversations.all') : t(`channelNames.${c}`)}
            </button>
          ))}
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
                    {t(`channelNames.${c.source ?? c.channel}`)} · {t('conversations.messages', { count: c.messageCount ?? 0 })} ·{' '}
                    <time dateTime={c.updatedAt}>{mounted ? format.relativeTime(parseDbUtc(c.updatedAt), now) : ''}</time>
                  </span>
                  {c.handedOff && <span className="badge badge-warn ag-conv-badge">{t('conversations.handedOff')}</span>}
                  {(pendingBy.get(c.id) ?? 0) > 0 && (
                    <span className="badge badge-warn ag-conv-badge">{t('approvals.pendingBadge', { count: pendingBy.get(c.id) ?? 0 })}</span>
                  )}
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
              <span className="badge">{t(`channelNames.${detail.conversation.source ?? detail.conversation.channel}`)}</span>
              {detail.conversation.handedOff && <span className="badge badge-warn">{t('conversations.handedOff')}</span>}
              {detail.conversation.chatConversationId && (
                <Link className="btn btn-ghost btn-sm ag-convs-inbox" href={`/app/chat/inbox/${detail.conversation.chatConversationId}`}>
                  {t('conversations.openInbox')}
                </Link>
              )}
            </header>
            <AgentApprovals
              agentId={agentId}
              actions={actions}
              onChange={(a) => {
                setActions((prev) => prev.map((x) => (x.id === a.id ? a : x)));
                setPendingBy((prev) => {
                  const next = new Map(prev);
                  next.set(a.conversationId, Math.max(0, (next.get(a.conversationId) ?? 1) - 1));
                  return next;
                });
                // La decisión entra al log de herramientas.
                if (detail) void load(detail.conversation.id);
              }}
            />
            <div className="ag-transcript">
              {detail.messages.map((m) => (
                <div key={m.id} className={`ag-msg is-${m.role}`}>
                  {m.teammate && <p className="ag-msg-author label">{t('chat.teammate')}</p>}
                  {m.runId && callsByRun.get(m.runId) && <ToolCalls calls={callsByRun.get(m.runId)!} labels={toolLabels} />}
                  <p className="ag-msg-text">{m.content}</p>
                  {m.role === 'assistant' && !m.teammate && (
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
            {(detail.conversation.channel === 'public' || detail.conversation.channel === 'api') && (
              <form
                className="ag-reply ag-pad"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendReply();
                }}
              >
                <label className="label" htmlFor="ag-reply-text">
                  {t('conversations.replyLabel')}
                </label>
                <textarea
                  id="ag-reply-text"
                  className="textarea"
                  rows={3}
                  maxLength={4000}
                  value={reply}
                  placeholder={t('conversations.replyPlaceholder')}
                  onChange={(e) => setReply(e.target.value)}
                />
                <p className="ui-help">
                  {detail.conversation.channel === 'public' ? t('conversations.replyHintPublic') : t('conversations.replyHintApi')}
                </p>
                {replyError && (
                  <p className="ui-error" role="alert">
                    {replyError}
                  </p>
                )}
                <div className="ag-reply-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!reply.trim()} aria-busy={replying || undefined}>
                    {t('conversations.replySend')}
                  </button>
                </div>
              </form>
            )}
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
