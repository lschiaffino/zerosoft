'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkBootstrap } from '@/lib/talk-boot';
import type { TalkChannelDto, TalkEvent, TalkMessageDto } from '@/lib/talk';
import type { TalkDraftDto } from '@/lib/talk-extras';
import { useRealtime, type RealtimeMode } from '@/lib/realtime-client';
import ChannelPane from './ChannelPane';
import ThreadPane from './ThreadPane';
import Sidebar, { sidebarOrder } from './Sidebar';
import TalkDialogs from './Dialogs';
import { ActivityView, BrowseView, DraftsView, FilesView, LaterView, SearchView, ThreadsView } from './Views';
import { TalkContext, draftKey, talkFetch, type TalkBusEvent, type TalkCtx, type TalkDialog, type TalkView } from './talk-context';

const LAST_KEY = 'talk.lastChannel';
const VIEWS: TalkView[] = ['threads', 'activity', 'later', 'drafts', 'files', 'search', 'browse'];

interface Props {
  locale: string;
  initial: TalkBootstrap;
  initialChannelId: string | null;
  initialView: TalkView | null;
  initialMessageId: string | null;
  initialThreadId: string | null;
  initialQuery: string;
  realtimeMode: RealtimeMode;
}

export default function TalkApp(props: Props) {
  const t = useTranslations('talk');
  const { locale } = props;
  const [boot, setBoot] = useState(props.initial);
  const [view, setView] = useState<TalkView>(props.initialView ?? 'channel');
  const [channelId, setChannelId] = useState<string | null>(props.initialChannelId);
  const [highlightId, setHighlightId] = useState<string | null>(props.initialMessageId);
  const [threadId, setThreadId] = useState<string | null>(props.initialThreadId);
  const [query, setQuery] = useState(props.initialQuery);
  const [dialog, setDialog] = useState<TalkDialog | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: 'ok' | 'error' }>>([]);
  const [typing, setTyping] = useState<Map<string, Map<string, number>>>(new Map());
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [extraChannel, setExtraChannel] = useState<TalkChannelDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [mobilePane, setMobilePane] = useState<'side' | 'main' | 'thread'>(props.initialChannelId || props.initialView ? (props.initialThreadId ? 'thread' : 'main') : 'side');
  const listeners = useRef(new Set<(e: TalkBusEvent) => void>());
  const bootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const people = useMemo(() => new Map(boot.people.map((p) => [p.id, p])), [boot.people]);
  const presence = useMemo(() => new Map(boot.presence.map((p) => [p.userId, p])), [boot.presence]);
  const channelById = useMemo(() => {
    const m = new Map(boot.channels.map((c) => [c.id, c]));
    if (extraChannel && !m.has(extraChannel.id)) m.set(extraChannel.id, extraChannel);
    return m;
  }, [boot.channels, extraChannel]);

  const personName = useCallback((id: string | null | undefined) => (id ? (people.get(id)?.name ?? t('common.someone')) : ''), [people, t]);
  const channelTitle = useCallback(
    (c: Pick<TalkChannelDto, 'kind' | 'name' | 'memberIds'>) => {
      if (c.kind === 'public' || c.kind === 'private') return c.name;
      if (!c.memberIds.length) return t('nav.you', { name: personName(boot.me) });
      return c.memberIds.map((id) => personName(id)).join(', ');
    },
    [personName, boot.me, t],
  );

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const publish = useCallback((e: TalkBusEvent) => {
    for (const fn of listeners.current) fn(e);
  }, []);

  const refreshBoot = useCallback(() => {
    if (bootTimer.current) clearTimeout(bootTimer.current);
    bootTimer.current = setTimeout(() => {
      void talkFetch<TalkBootstrap>('/api/talk/bootstrap')
        .then(setBoot)
        .catch(() => undefined);
    }, 250);
  }, []);

  // Ruta → estado (atrás / adelante del navegador).
  const syncUrl = useCallback(
    (next: { view: TalkView; channelId: string | null; messageId?: string | null; threadId?: string | null; query?: string }, replace = false) => {
      const base = `/${locale}/app/talk`;
      const qs = new URLSearchParams();
      let path = base;
      if (next.view === 'channel' && next.channelId) {
        path = `${base}/${next.channelId}`;
        if (next.messageId) qs.set('m', next.messageId);
        if (next.threadId) qs.set('thread', next.threadId);
      } else if (next.view !== 'channel') {
        qs.set('view', next.view);
        if (next.view === 'search' && next.query) qs.set('q', next.query);
      }
      const url = `${path}${qs.size ? `?${qs}` : ''}`;
      if (url === `${window.location.pathname}${window.location.search}`) return;
      if (replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    },
    [locale],
  );

  const open = useCallback<TalkCtx['open']>(
    (target) => {
      if (target.channelId) {
        setView('channel');
        setChannelId(target.channelId);
        setHighlightId(target.messageId ?? null);
        setThreadId(target.threadId ?? null);
        setMobilePane(target.threadId ? 'thread' : 'main');
        try {
          localStorage.setItem(LAST_KEY, target.channelId);
        } catch {
          /* sin storage */
        }
        syncUrl({ view: 'channel', channelId: target.channelId, messageId: target.messageId, threadId: target.threadId });
        return;
      }
      const v = target.view ?? 'channel';
      if (v === 'channel') {
        // Sin canal: el último abierto o #general.
        const fallback = boot.channels.find((c) => c.kind === 'public' && c.name === 'general') ?? sidebarOrder(boot.channels)[0];
        if (fallback) {
          setView('channel');
          setChannelId(fallback.id);
          setHighlightId(null);
          setThreadId(null);
          setMobilePane('main');
          syncUrl({ view: 'channel', channelId: fallback.id });
        }
        return;
      }
      setView(v);
      setThreadId(null);
      if (v === 'search') setQuery(target.query ?? '');
      setMobilePane('main');
      syncUrl({ view: v, channelId: null, query: target.query });
    },
    [boot.channels, syncUrl],
  );

  const openThread = useCallback(
    (rootId: string | null) => {
      setThreadId(rootId);
      setMobilePane(rootId ? 'thread' : 'main');
      if (view === 'channel' && channelId) syncUrl({ view: 'channel', channelId, messageId: highlightId, threadId: rootId }, true);
    },
    [view, channelId, highlightId, syncUrl],
  );

  useEffect(() => {
    function onPop() {
      const path = window.location.pathname.split('/app/talk')[1] ?? '';
      const sp = new URLSearchParams(window.location.search);
      const id = path.replace(/^\//, '').split('/')[0] || null;
      const v = sp.get('view') as TalkView | null;
      if (id) {
        setView('channel');
        setChannelId(id);
        setHighlightId(sp.get('m'));
        setThreadId(sp.get('thread'));
      } else if (v && VIEWS.includes(v)) {
        setView(v);
        setQuery(sp.get('q') ?? '');
      }
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Al entrar sin canal: el último abierto (o #general).
  useEffect(() => {
    if (props.initialChannelId || props.initialView) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_KEY);
    } catch {
      /* sin storage */
    }
    const target = (last && boot.channels.find((c) => c.id === last)) || boot.channels.find((c) => c.kind === 'public' && c.name === 'general') || sidebarOrder(boot.channels)[0];
    if (target) {
      setChannelId(target.id);
      syncUrl({ view: 'channel', channelId: target.id }, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canal que no está en mi sidebar (público sin unirme, o un link): se pide aparte.
  useEffect(() => {
    setMissing(false);
    if (!channelId || boot.channels.some((c) => c.id === channelId)) {
      setExtraChannel(null);
      return;
    }
    let alive = true;
    void talkFetch<TalkChannelDto>(`/api/talk/channels/${channelId}`)
      .then((c) => alive && setExtraChannel(c))
      .catch(() => alive && setMissing(true));
    return () => {
      alive = false;
    };
  }, [channelId, boot.channels]);

  // Borradores (para precargar el editor de cada canal e hilo).
  useEffect(() => {
    void talkFetch<{ drafts: TalkDraftDto[] }>('/api/talk/views?view=drafts')
      .then((r) => setDrafts(new Map(r.drafts.map((d) => [draftKey(d.channelId, d.parentId), d.body]))))
      .catch(() => undefined);
  }, []);

  const setDraft = useCallback((cid: string, parentId: string | null, body: string) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      if (body.trim()) next.set(draftKey(cid, parentId), body);
      else next.delete(draftKey(cid, parentId));
      return next;
    });
  }, []);

  // Presencia: latido cada minuto con la pestaña visible.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === 'visible') void talkFetch('/api/talk/me', { method: 'POST' }).catch(() => undefined);
    };
    beat();
    const id = setInterval(beat, 60_000);
    document.addEventListener('visibilitychange', beat);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', beat);
    };
  }, []);

  const onEvents = useCallback(
    (events: TalkEvent[]) => {
      const typingEvents = events.filter((e) => e.kind === 'typing');
      if (typingEvents.length) {
        setTyping((prev) => {
          const next = new Map(prev);
          for (const e of typingEvents) {
            const p = e.payload as { userId?: string; parentId?: string | null };
            if (!p.userId || !e.channelId) continue;
            const key = `${e.channelId}|${p.parentId ?? ''}`;
            const m = new Map(next.get(key) ?? []);
            // Si el evento es viejo (llegó tarde), no se muestra.
            if (Date.now() - new Date(e.at).getTime() < 8000) m.set(p.userId, Date.now() + 6000);
            next.set(key, m);
          }
          return next;
        });
      }
      // Quien escribió un mensaje deja de "estar escribiendo".
      const posted = events.filter((e) => e.kind === 'message' && (e.payload as { change?: string }).change === 'new' && e.actorId);
      if (posted.length) {
        setTyping((prev) => {
          const next = new Map(prev);
          for (const e of posted) {
            const p = e.payload as { parentId?: string | null };
            const key = `${e.channelId}|${p.parentId ?? ''}`;
            const m = new Map(next.get(key) ?? []);
            m.delete(e.actorId!);
            next.set(key, m);
          }
          return next;
        });
      }
      const meaningful = events.filter((e) => e.kind !== 'typing');
      if (!meaningful.length) return;
      publish({ type: 'events', events: meaningful });
      refreshBoot();
      const gone = meaningful.find((e) => e.kind === 'channel' && (e.payload as { change?: string; id?: string }).change === 'deleted' && (e.payload as { id?: string }).id === channelId);
      if (gone) open({ view: 'channel' });
    },
    [publish, refreshBoot, channelId, open],
  );

  const { status, nudge } = useRealtime<TalkEvent>({
    streamUrl: '/api/talk/stream',
    pollUrl: '/api/talk/events',
    cursor: props.initial.cursor,
    mode: props.realtimeMode,
    onEvents,
  });

  const api = useCallback<TalkCtx['api']>(
    async <T,>(url: string, init?: RequestInit & { json?: unknown }) => {
      const res = await talkFetch<T>(url, init);
      if (init?.method && init.method !== 'GET') nudge();
      return res;
    },
    [nudge],
  );

  const subscribe = useCallback((fn: (e: TalkBusEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // Atajos de teclado como Slack.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const order = sidebarOrder(boot.channels);
        const list = e.shiftKey ? order.filter((c) => c.unread || c.id === channelId) : order;
        if (!list.length) return;
        e.preventDefault();
        const i = list.findIndex((c) => c.id === channelId);
        const d = e.key === 'ArrowDown' ? 1 : -1;
        const next = list[(i + d + list.length) % list.length] ?? list[0];
        if (next) open({ channelId: next.id });
        return;
      }
      if (e.key === 'Escape' && e.shiftKey && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        void api('/api/talk/channels/all/read', { method: 'POST' }).then(() => {
          refreshBoot();
          toast(t('nav.allRead'));
        });
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        open({ view: 'threads' });
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        open({ view: 'activity' });
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setMobilePane('side');
        document.querySelector<HTMLInputElement>('[data-testid="talk-search-input"]')?.focus();
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        setDialog({ kind: 'shortcuts' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boot.channels, channelId, open, api, refreshBoot, toast, t]);

  const ctx: TalkCtx = {
    boot,
    locale,
    people,
    presence,
    channels: boot.channels,
    channelById,
    channelTitle,
    personName,
    open,
    openThread,
    refreshBoot,
    toast,
    api,
    patchMessage: (m: TalkMessageDto) => publish({ type: 'patch', message: m }),
    removeMessage: (id: string) => publish({ type: 'remove', id }),
    dialog: setDialog,
    typing,
    subscribe,
    drafts,
    setDraft,
  };

  const channel = channelId ? (channelById.get(channelId) ?? null) : null;
  const back = () => setMobilePane('side');

  let main: React.ReactNode = null;
  if (view === 'threads') main = <ThreadsView onBack={back} />;
  else if (view === 'activity') main = <ActivityView onBack={back} />;
  else if (view === 'later') main = <LaterView onBack={back} />;
  else if (view === 'drafts') main = <DraftsView onBack={back} />;
  else if (view === 'files') main = <FilesView onBack={back} />;
  else if (view === 'search') main = <SearchView query={query} onBack={back} />;
  else if (view === 'browse') main = <BrowseView onBack={back} />;
  else if (channel) main = <ChannelPane channel={channel} highlightId={highlightId} onBack={back} />;
  else if (missing)
    main = (
      <section className="talk-pane talk-view">
        <div className="ui-empty talk-empty">
          <p className="ui-empty-title">{t('channel.notFound')}</p>
          <p className="ui-empty-body">{t('channel.notFoundBody')}</p>
          <div className="ui-empty-actions">
            <button type="button" className="btn btn-sm" onClick={() => open({ view: 'browse' })}>
              {t('nav.browse')}
            </button>
          </div>
        </div>
      </section>
    );
  else
    main = (
      <section className="talk-pane talk-view">
        <div className="ui-empty talk-empty">
          <p className="ui-empty-title">{t('empty.title')}</p>
          <p className="ui-empty-body">{t('empty.body')}</p>
          <div className="ui-empty-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'create-channel' })}>
              {t('nav.addChannel')}
            </button>
          </div>
        </div>
      </section>
    );

  const threadChannel = threadId ? channel : null;

  return (
    <TalkContext.Provider value={ctx}>
      <div className={`talk-app${threadId && threadChannel ? ' has-thread' : ''}`} data-pane={mobilePane} data-realtime={status}>
        <Sidebar activeId={channelId} view={view} onNavigate={() => setMobilePane('main')} />
        <div className="talk-main">{main}</div>
        {threadId && threadChannel && view === 'channel' && <ThreadPane rootId={threadId} channel={threadChannel} onClose={() => openThread(null)} />}
        <TalkDialogs dialog={dialog} />
        <div className="ui-toasts" role="status" aria-live="polite">
          {toasts.map((x) => (
            <div key={x.id} className="ui-toast" data-tone={x.kind === 'error' ? 'error' : undefined}>
              {x.text}
            </div>
          ))}
        </div>
        <span className="sr-only" aria-live="polite">
          {status === 'offline' ? t('nav.offline') : ''}
        </span>
      </div>
    </TalkContext.Provider>
  );
}
