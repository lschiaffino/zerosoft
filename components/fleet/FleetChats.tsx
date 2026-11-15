'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalText from '@/components/ui/LocalText';
import { SendIcon, Ticks } from '@/components/groups/wa/icons';
import type { RealtimeMode } from '@/lib/realtime-client';
import type { MessageDto, SessionDto } from '@/lib/fleet/types';
import { useFleetLive } from './useFleetLive';
import AgentText from './AgentText';
import { Ago, ChecksMark, DeployMark, StatusLabel, initials } from './ui';

export interface ChatsProps {
  sessions: SessionDto[];
  archived: SessionDto[];
  activeId: string | null;
  initialMessages: MessageDto[] | null;
  cursor: number;
  realtimeMode?: RealtimeMode;
  /** Ruta base: /app/fleet/chats, o la de Inbox / Lines cuando la conversación se ve desde ahí. */
  base?: string;
  /** 'query': la sesión va en ?s=<id> (Lines, que no tiene ruta con id para esto). */
  linkMode?: 'path' | 'query';
}

/**
 * Chats con los agentes, como WhatsApp: la lista de sesiones a la izquierda y la conversación a la derecha (en el
 * teléfono, una u otra). Tus prompts y respuestas a la derecha, lo que dice el agente a la izquierda, los avisos al
 * medio. Lo que escribís acá queda en cola y lo entrega el Stop hook: reloj mientras espera, dos tildes al
 * entregarse y azules cuando el agente ya respondió después.
 */
export default function FleetChats(props: ChatsProps) {
  const t = useTranslations('fleet');
  const base = props.base ?? '/app/fleet/chats';
  const hrefOf = (id: string) => (props.linkMode === 'query' ? `${base}?s=${encodeURIComponent(id)}` : `${base}/${id}`);
  const [sessions, setSessions] = useState(props.sessions);
  const [archived, setArchived] = useState(props.archived);
  const [showArchived, setShowArchived] = useState(Boolean(props.activeId && props.archived.some((s) => s.id === props.activeId)));
  const [q, setQ] = useState('');
  const [tick, setTick] = useState(0);
  const touched = useRef<Set<string>>(new Set());

  const reloadList = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetch('/api/fleet/board', { cache: 'no-store' }), fetch('/api/fleet/board?archived=1', { cache: 'no-store' })]);
      if (a.ok) setSessions(((await a.json()) as { sessions: SessionDto[] }).sessions);
      if (b.ok) setArchived(((await b.json()) as { sessions: SessionDto[] }).sessions);
    } catch {
      /* sin red */
    }
  }, []);

  useFleetLive({
    cursor: props.cursor,
    mode: props.realtimeMode,
    onChange: (events) => {
      for (const e of events) if (e.kind === 'message' || e.kind === 'session') touched.current.add(e.ref);
      void reloadList();
      setTick((n) => n + 1);
    },
  });

  const list = showArchived ? archived : sessions;
  const needle = q.trim().toLowerCase();
  const visible = needle ? list.filter((s) => `${s.title} ${s.project} ${s.branch} ${s.lastText}`.toLowerCase().includes(needle)) : list;
  const active = [...sessions, ...archived].find((s) => s.id === props.activeId) ?? null;

  return (
    <div className={`flt-chat${props.activeId ? ' has-active' : ''}`} data-testid="fleet-chats">
      <aside className="flt-chat-list" aria-label={t('chats.listLabel')}>
        <div className="flt-chat-list-head">
          <h1 className="flt-chat-h1">{showArchived ? t('chats.archived') : t('nav.chats')}</h1>
          <button type="button" className="flt-icon-btn" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)} data-testid="fleet-chats-archived" title={t('chats.archived')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="5" rx="1" />
              <path d="M5 9v10h14V9M10 13h4" />
            </svg>
            <span className="sr-only">{t('chats.archived')}</span>
          </button>
        </div>
        <div className="flt-chat-search">
          <input type="search" className="flt-chat-search-input" placeholder={t('chats.search')} aria-label={t('chats.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {visible.length === 0 ? (
          <div className="flt-chat-empty">
            <EmptyState compact quiet body={list.length ? t('empty.noMatch') : showArchived ? t('chats.noArchived') : t('empty.noAgents')} action={list.length || showArchived ? undefined : { label: t('empty.connectAgents'), href: '/app/fleet/settings#agents' }} />
          </div>
        ) : (
          <ul className="flt-chat-rows" role="list">
            {visible.map((s) => (
              <li key={s.id}>
                <Link href={hrefOf(s.id)} className="flt-chat-row" aria-current={s.id === props.activeId ? 'true' : undefined} data-testid="fleet-chat-row" data-session={s.id}>
                  <span className="flt-avatar" data-status={s.status} aria-hidden="true">
                    {initials(s.project || s.title)}
                  </span>
                  <span className="flt-chat-row-main">
                    <span className="flt-chat-row-top">
                      <span className="flt-chat-row-title">{s.title}</span>
                      <Ago iso={s.lastEventAt} className="flt-chat-time" />
                    </span>
                    <span className="flt-chat-row-bottom">
                      <StatusLabel status={s.status} compact />
                      <span className="flt-chat-preview">{s.lastText || s.project}</span>
                      {s.unread > 0 && (
                        <span className="flt-unread" aria-label={t('card.unread', { n: s.unread })}>
                          {s.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="flt-chat-thread" aria-label={active?.title ?? t('nav.chats')}>
        {props.activeId && active ? (
          <Thread
            key={props.activeId}
            session={active}
            initialMessages={props.initialMessages}
            base={base}
            tick={tick}
            touched={touched}
            onSessionChange={(next) => {
              setSessions((l) => l.map((x) => (x.id === next.id ? next : x)));
              setArchived((l) => l.map((x) => (x.id === next.id ? next : x)));
            }}
            onReloadList={reloadList}
          />
        ) : (
          <div className="flt-chat-placeholder">
            <EmptyState product="fleet" title={t('chats.pickTitle')} body={t('chats.pickBody')} />
          </div>
        )}
      </section>
    </div>
  );
}

function sameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function Thread({
  session,
  initialMessages,
  base,
  tick,
  touched,
  onSessionChange,
  onReloadList,
}: {
  session: SessionDto;
  initialMessages: MessageDto[] | null;
  base: string;
  tick: number;
  touched: MutableRefObject<Set<string>>;
  onSessionChange: (s: SessionDto) => void;
  onReloadList: () => Promise<void>;
}) {
  const t = useTranslations('fleet');
  const locale = useLocale();
  const router = useRouter();
  const [messages, setMessages] = useState<MessageDto[] | null>(initialMessages);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/sessions/${session.id}?read=1`, { cache: 'no-store' });
      if (!res.ok) throw new Error('load');
      const body = (await res.json()) as { session: SessionDto; messages: MessageDto[] };
      setMessages(body.messages);
      onSessionChange(body.session);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tick && touched.current.has(session.id)) {
      touched.current.delete(session.id);
      void load();
    }
  }, [tick, touched, session.id, load]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  // El menú se cierra con un clic afuera o con Esc desde cualquier lado.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // El último mensaje del agente: una respuesta entregada antes de eso ya la leyó (tildes azules).
  const lastAgentAt = useMemo(() => [...(messages ?? [])].reverse().find((m) => m.role === 'agent')?.createdAt ?? '', [messages]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError('');
    try {
      const res = await fetch(`/api/fleet/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body }) });
      const data = (await res.json().catch(() => ({}))) as { message?: MessageDto; error?: string };
      if (!res.ok || !data.message) throw new Error(data.error ?? 'error');
      setMessages((m) => [...(m ?? []), data.message!]);
      setText('');
      input.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error && err.message === 'too_many_pending' ? t('errors.too_many_pending') : t('errors.send'));
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  async function cancel(id: string) {
    const res = await fetch(`/api/fleet/sessions/${session.id}/messages/${id}`, { method: 'DELETE' });
    if (res.ok) setMessages((m) => (m ?? []).map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)));
    else void load();
  }

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/fleet/sessions/${session.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      onSessionChange(((await res.json()) as { session: SessionDto }).session);
      await onReloadList();
    }
  }

  async function remove() {
    const res = await fetch(`/api/fleet/sessions/${session.id}`, { method: 'DELETE' });
    setConfirmDelete(false);
    if (res.ok) {
      await onReloadList();
      router.push(base);
    }
  }

  const tickStatus = (m: MessageDto) => (m.status === 'pending' ? 'pending' : m.status === 'delivered' ? (lastAgentAt && m.deliveredAt && lastAgentAt > m.deliveredAt ? 'read' : 'delivered') : 'sent');
  const waitingOnAgent = session.status === 'working';

  return (
    <>
      <header className="flt-thread-head">
        <Link href={base} className="flt-icon-btn flt-back" aria-label={t('chats.back')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <span className="flt-avatar" data-status={session.status} aria-hidden="true">
          {initials(session.project || session.title)}
        </span>
        <div className="flt-thread-title">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setRenaming(false);
                void patch({ title });
              }}
            >
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label={t('chats.rename')}
                autoFocus
                maxLength={140}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTitle(session.title);
                    setRenaming(false);
                  }
                }}
                data-testid="fleet-rename-input"
              />
            </form>
          ) : (
            <h2 className="flt-thread-name" data-testid="fleet-thread-title">
              {session.title}
            </h2>
          )}
          <span className="flt-thread-sub">
            <StatusLabel status={session.status} />
            {session.project && <span>{session.project}</span>}
            {session.branch && <span className="flt-mono">{session.branch}</span>}
          </span>
        </div>
        <div className="flt-thread-links">
          {session.pr && (
            <a href={session.pr.url} target="_blank" rel="noopener noreferrer" className="flt-chip-link">
              <ChecksMark state={session.pr.checks} />
              {t('card.pr', { n: session.pr.number })}
            </a>
          )}
          {session.deploy && (
            <a href={session.deploy.url} target="_blank" rel="noopener noreferrer" className="flt-chip-link">
              <DeployMark state={session.deploy.state} />
            </a>
          )}
        </div>
        <div className="flt-menu-wrap" ref={menuRef}>
          <button type="button" className="flt-icon-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} data-testid="fleet-thread-menu" aria-label={t('chats.more')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="12" cy="19" r="1.8" />
            </svg>
          </button>
          {menu && (
            <ul
              className="flt-menu"
              role="menu"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMenu(false);
              }}
            >
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    setMenu(false);
                    setRenaming(true);
                  }}
                  data-testid="fleet-rename"
                >
                  {t('chats.rename')}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    void patch({ archived: !session.archived });
                  }}
                  data-testid="fleet-archive"
                >
                  {session.archived ? t('chats.unarchive') : t('chats.archive')}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="flt-danger"
                  onClick={() => {
                    setMenu(false);
                    setConfirmDelete(true);
                  }}
                  data-testid="fleet-delete"
                >
                  {t('chats.delete')}
                </button>
              </li>
            </ul>
          )}
        </div>
      </header>
      <div className="flt-thread-body" ref={scroller} data-testid="fleet-thread">
        {messages === null ? (
          loadError ? (
            <p className="flt-system" role="alert">
              {t('errors.load')}{' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
                {t('common.retry')}
              </button>
            </p>
          ) : (
            <div className="ui-loading-stack" aria-busy="true">
              <span className="sr-only" role="status">
                {t('chats.loading')}
              </span>
              {[0, 1, 2].map((i) => (
                <span key={i} className="ui-skeleton ui-skeleton-row" />
              ))}
            </div>
          )
        ) : messages.length === 0 ? (
          <p className="flt-system">{t('chats.noMessages')}</p>
        ) : (
          messages.map((m, i) => {
            const day = i === 0 || !sameDay(messages[i - 1].createdAt, m.createdAt);
            const out = m.role === 'prompt' || m.role === 'reply';
            return (
              <div key={m.id} className="flt-msg-wrap">
                {day && (
                  <p className="flt-day">
                    <LocalText>{new Date(m.createdAt).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</LocalText>
                  </p>
                )}
                {m.role === 'notice' ? (
                  <p className="flt-system" data-testid="fleet-msg" data-role="notice">
                    {noticeText(t, m)}
                  </p>
                ) : (
                  <div className={`flt-msg ${out ? 'is-out' : 'is-in'}${m.status === 'cancelled' ? ' is-cancelled' : ''}`} data-testid="fleet-msg" data-role={m.role} data-status={m.status || undefined}>
                    <div className="flt-bubble">
                      {m.role === 'prompt' && <span className="flt-bubble-from">{t('chats.fromTerminal')}</span>}
                      {m.role === 'reply' && m.source !== 'web' && <span className="flt-bubble-from">{t(`chats.from.${m.source === 'whatsapp' ? 'whatsapp' : m.source === 'lines' ? 'lines' : 'inbox'}`)}</span>}
                      {m.role === 'agent' ? <AgentText text={m.text} /> : <p className="flt-p flt-pre-wrap">{m.text}</p>}
                      <span className="flt-bubble-meta">
                        {m.status === 'cancelled' && <span>{t('chats.cancelled')}</span>}
                        <LocalText>{new Date(m.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</LocalText>
                        {m.role === 'reply' && m.status !== 'cancelled' && (
                          <span data-testid="fleet-ticks" data-tick={tickStatus(m)}>
                            <Ticks status={tickStatus(m)} label={t(`chats.tick.${tickStatus(m)}`)} />
                          </span>
                        )}
                      </span>
                    </div>
                    {m.role === 'reply' && m.status === 'pending' && (
                      <button type="button" className="flt-cancel" onClick={() => void cancel(m.id)} data-testid="fleet-cancel-reply">
                        {t('chats.cancel')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <form className="flt-composer" onSubmit={send}>
        <textarea
          ref={input}
          className="flt-composer-input"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={t('chats.placeholder')}
          aria-label={t('chats.placeholder')}
          maxLength={4000}
          data-testid="fleet-composer"
        />
        <button type="submit" className="flt-send" disabled={!text.trim() || sending} aria-label={t('chats.send')} data-testid="fleet-send">
          <SendIcon size={22} />
        </button>
      </form>
      <p className="flt-composer-hint" aria-live="polite">
        {sendError ? <span className="ui-error">{sendError}</span> : waitingOnAgent ? t('chats.hintWorking') : t('chats.hintIdle')}
      </p>
      <ConfirmDialog
        open={confirmDelete}
        title={t('chats.deleteTitle')}
        body={t('chats.deleteBody')}
        confirmLabel={t('chats.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function noticeText(t: ReturnType<typeof useTranslations>, m: MessageDto): string {
  const [event, detail = ''] = m.event.split(':');
  switch (event) {
    case 'SessionStart':
      return t('notice.start', { source: detail || 'startup' });
    case 'SessionEnd':
      return t('notice.end');
    case 'SubagentStop':
      return m.text ? t('notice.subagentText', { agent: detail || t('notice.subagent'), text: m.text }) : t('notice.subagentDone', { agent: detail || t('notice.subagent') });
    case 'StopFailure':
      return t('notice.failed', { error: detail || 'unknown' });
    default:
      return m.text;
  }
}
