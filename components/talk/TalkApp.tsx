'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TalkBootstrap } from '@/lib/talk-boot';
import type { TalkChannelDto, TalkEvent, TalkMessageDto } from '@/lib/talk';
import type { TalkDraftDto } from '@/lib/talk-extras';
import { useRealtime, type RealtimeMode } from '@/lib/realtime-client';
import { setTopbarLabel } from '@/components/app/AppTopbar';
import ChannelPane from './ChannelPane';
import ThreadPane from './ThreadPane';
import Sidebar, { sidebarOrder } from './Sidebar';
import TalkDialogs from './Dialogs';
import { ActivityView, BrowseView, DraftsView, FilesView, LaterView, SearchView, ThreadsView } from './Views';
import { RecapView } from './AiViews';
import { useHuddleManager } from './Huddle';
import { TalkContext, draftKey, talkFetch, type TalkBusEvent, type TalkCtx, type TalkDialog, type TalkView } from './talk-context';

const LAST_KEY = 'talk.lastChannel';
const VIEWS: TalkView[] = ['threads', 'activity', 'later', 'drafts', 'files', 'search', 'browse', 'recap'];

interface Props {
  locale: string;
  initial: TalkBootstrap;
  initialChannelId: string | null;
  initialView: TalkView | null;
  initialMessageId: string | null;
  initialThreadId: string | null;
  initialQuery: string;
  initialTab?: 'canvas' | 'lists' | null;
  initialListId?: string | null;
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
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [extraChannel, setExtraChannel] = useState<TalkChannelDto | null>(null);
  const [missing, setMissing] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [mobilePane, setMobilePane] = useState<'side' | 'main' | 'thread'>(props.initialChannelId || props.initialView ? (props.initialThreadId ? 'thread' : 'main') : 'side');
  const listeners = useRef(new Set<(e: TalkBusEvent) => void>());
  // Huddles: sus pedidos aceleran el polling (la señalización WebRTC viaja por el feed).
  const nudgeRef = useRef<() => void>(() => undefined);
  const huddleApi = useCallback(async <T,>(url: string, init?: RequestInit & { json?: unknown }) => {
    const res = await talkFetch<T>(url, init);
    if (init?.method && init.method !== 'GET') nudgeRef.current();
    return res;
  }, []);
  const huddleError = useCallback((code: string) => toastRef.current(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'), 'error'), [t]);
  const toastRef = useRef<(text: string, kind?: 'ok' | 'error') => void>(() => undefined);
  const huddle = useHuddleManager(huddleApi, huddleError);
  const huddleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshHuddles = useCallback(() => {
    if (huddleTimer.current) clearTimeout(huddleTimer.current);
    huddleTimer.current = setTimeout(() => {
      void talkFetch<{ huddles: TalkBootstrap['huddles'] }>('/api/talk/huddles')
        .then((r) => setBoot((b) => ({ ...b, huddles: r.huddles })))
        .catch(() => undefined);
    }, 300);
  }, []);
  const bootTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const people = useMemo(() => new Map([...(boot.formerPeople ?? []), ...boot.people].map((p) => [p.id, p])), [boot.people, boot.formerPeople]);
  // La presencia "activo" vence sola (3 min sin latido): se recalcula cada minuto.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPresenceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const presence = useMemo(() => {
    const now = Date.now();
    return new Map(
      boot.presence.map((p) => [p.userId, { ...p, active: !p.away && !!p.lastSeenAt && now - new Date(p.lastSeenAt).getTime() < 3 * 60_000 }]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.presence, presenceTick]);
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
  toastRef.current = toast;

  const publish = useCallback((e: TalkBusEvent) => {
    for (const fn of listeners.current) fn(e);
  }, []);

  // Estado completo: al reconectar, si el servidor avisa un hueco o después de
  // una acción propia que cambia varias cosas. Si falla, reintenta con backoff.
  const bootTry = useRef(0);
  const refreshBoot = useCallback(() => {
    if (bootTimer.current) clearTimeout(bootTimer.current);
    const run = (delay: number) => {
      bootTimer.current = setTimeout(() => {
        void talkFetch<TalkBootstrap>('/api/talk/bootstrap')
          .then((b) => {
            bootTry.current = 0;
            setBoot(b);
          })
          .catch(() => {
            bootTry.current += 1;
            if (bootTry.current <= 6) run(Math.min(30_000, 1000 * 2 ** bootTry.current));
          });
      }, delay);
    };
    run(250);
  }, []);

  // Un canal puntual (tiempo real): se agrega, actualiza o saca del sidebar sin pedir todo.
  const channelTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const refreshChannel = useCallback((id: string) => {
    const timers = channelTimers.current;
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void talkFetch<TalkChannelDto>(`/api/talk/channels/${id}`)
          .then((c) =>
            setBoot((b) => {
              const rest = b.channels.filter((x) => x.id !== id);
              return { ...b, channels: c.isMember ? [...rest, c] : rest };
            }),
          )
          .catch(() => setBoot((b) => ({ ...b, channels: b.channels.filter((x) => x.id !== id) })));
      }, 150),
    );
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
        const fallback = boot.channels.find((c) => c.kind === 'public' && c.name === 'general') ?? sidebarOrder(boot.channels, boot.sections)[0];
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
      if (v === 'search' || v === 'browse') setQuery(target.query ?? '');
      setMobilePane('main');
      syncUrl({ view: v, channelId: null, query: target.query });
    },
    [boot.channels, boot.sections, syncUrl],
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
    const target = (last && boot.channels.find((c) => c.id === last)) || boot.channels.find((c) => c.kind === 'public' && c.name === 'general') || sidebarOrder(boot.channels, boot.sections)[0];
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
      .then((r) => {
        setDrafts(new Map(r.drafts.map((d) => [draftKey(d.channelId, d.parentId), d.body])));
        setDraftsLoaded(true);
      })
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

  // Presencia: con SSE la marca el stream; sin SSE (polling), un latido por minuto con la pestaña visible.
  const liveRef = useRef(false);
  useEffect(() => {
    const beat = () => {
      if (liveRef.current || document.visibilityState !== 'visible') return;
      void talkFetch('/api/talk/me', { method: 'POST' }).catch(() => undefined);
    };
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
      if (events.some((e) => e.kind === 'signal' || e.kind === 'huddle')) huddle.onEvents(events);
      const meaningful = events.filter((e) => e.kind !== 'typing' && e.kind !== 'signal');
      if (!meaningful.length) return;
      publish({ type: 'events', events: meaningful });
      applyEvents(meaningful);
      const gone = meaningful.find((e) => e.kind === 'channel' && (e.payload as { change?: string; id?: string }).change === 'deleted' && (e.payload as { id?: string }).id === channelId);
      if (gone) open({ view: 'channel' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publish, channelId, open],
  );

  // Aplica los eventos al estado del sidebar de a poco (sin rehacer el bootstrap).
  const activeRef = useRef<string | null>(null);
  activeRef.current = view === 'channel' ? channelId : null;
  function applyEvents(evs: TalkEvent[]) {
    const me = boot.me;
    const toFetch = new Set<string>();
    let fullRefresh = false;
    setBoot((b) => {
      let channels = b.channels;
      let presenceList = b.presence;
      let unreadThreadIds = b.unreadThreadIds ?? [];
      let counts = b.counts;
      const patch = (id: string, fn: (c: TalkChannelDto) => TalkChannelDto) => {
        channels = channels.map((c) => (c.id === id ? fn(c) : c));
      };
      for (const e of evs) {
        const p = e.payload as Record<string, unknown>;
        if (e.kind === 'message' && p.change === 'new' && e.channelId) {
          const known = channels.find((c) => c.id === e.channelId);
          const channelLevel = !p.parentId || !!p.alsoInChannel;
          if (!known) {
            // Un DM nuevo o uno que había cerrado: se pide ese canal.
            toFetch.add(e.channelId);
          } else if (e.actorId !== me && channelLevel) {
            const looking = activeRef.current === e.channelId && document.visibilityState === 'visible' && document.hasFocus();
            const mentioned =
              known.kind === 'dm' || known.kind === 'group' || (Array.isArray(p.mentions) && (p.mentions as string[]).includes(me)) || !!p.broadcast;
            patch(e.channelId, (c) => ({
              ...c,
              lastMessageAt: (p.at as string) ?? c.lastMessageAt,
              unread: looking ? c.unread : true,
              mentions: looking ? c.mentions : c.mentions + (mentioned ? 1 : 0),
            }));
          } else if (channelLevel) {
            patch(e.channelId, (c) => ({ ...c, lastMessageAt: (p.at as string) ?? c.lastMessageAt }));
          }
          if (p.parentId && e.actorId !== me && Array.isArray(p.followers) && (p.followers as string[]).includes(me) && !unreadThreadIds.includes(p.parentId as string)) {
            unreadThreadIds = [...unreadThreadIds, p.parentId as string];
          }
          if (p.scheduled && e.actorId === me) counts = { ...counts, scheduled: Math.max(0, counts.scheduled - 1) };
        } else if (e.kind === 'read') {
          if (p.all) channels = channels.map((c) => ({ ...c, unread: false, mentions: 0, lastReadAt: e.at }));
          else if (typeof p.threadId === 'string') unreadThreadIds = unreadThreadIds.filter((id) => id !== p.threadId);
          else if (typeof p.channelId === 'string') {
            const c = channels.find((x) => x.id === p.channelId);
            const at = typeof p.at === 'string' ? p.at : e.at;
            if (c && (!c.lastMessageAt || at >= c.lastMessageAt)) patch(c.id, (x) => ({ ...x, unread: false, mentions: 0, lastReadAt: at }));
            else toFetch.add(p.channelId);
          }
        } else if (e.kind === 'channel') {
          if (p.change === 'deleted' && typeof p.id === 'string') channels = channels.filter((c) => c.id !== p.id);
          else if (p.change === 'left' && typeof p.id === 'string') channels = channels.filter((c) => c.id !== p.id);
          else if (e.channelId) toFetch.add(e.channelId);
        } else if (e.kind === 'presence' && p.presence) {
          const dto = p.presence as (typeof presenceList)[number];
          presenceList = [...presenceList.filter((x) => x.userId !== dto.userId), dto];
        } else if (e.kind === 'saved' || e.kind === 'profile' || e.kind === 'section') {
          fullRefresh = true;
        } else if (e.kind === 'huddle') {
          refreshHuddles();
        }
      }
      return { ...b, channels, presence: presenceList, unreadThreadIds, unreadThreads: unreadThreadIds.length, counts };
    });
    for (const id of toFetch) refreshChannel(id);
    if (fullRefresh) refreshBoot();
  }

  const { status, nudge } = useRealtime<TalkEvent>({
    streamUrl: '/api/talk/stream',
    pollUrl: '/api/talk/events',
    cursor: props.initial.cursor,
    mode: props.realtimeMode,
    onEvents,
    // Reconexión o hueco grande: el estado se rehace una vez.
    onConnect: refreshBoot,
    onReset: refreshBoot,
    onRevoked: () => setRevoked(true),
  });
  liveRef.current = status === 'live';
  nudgeRef.current = nudge;

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
        const order = sidebarOrder(boot.channels, boot.sections);
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
  }, [boot.channels, boot.sections, channelId, open, api, refreshBoot, toast, t]);

  const ctx: TalkCtx = {
    boot: { ...boot, counts: { ...boot.counts, drafts: draftsLoaded ? drafts.size : boot.counts.drafts } },
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
    huddle,
  };

  const channel = channelId ? (channelById.get(channelId) ?? null) : null;
  const back = () => setMobilePane('side');

  // Banda de arriba: "Talk / #canal" (o la vista abierta).
  const crumbLabel =
    view === 'channel' ? (channel ? (channel.kind === 'public' || channel.kind === 'private' ? `#${channel.name}` : channelTitle(channel)) : null) : view === 'search' ? t('search.title') : view === 'browse' ? t('browse.title') : t(`nav.${view}`);
  useEffect(() => {
    const path = view === 'channel' && channelId ? `/app/talk/${channelId}` : '/app/talk';
    setTopbarLabel(path, crumbLabel);
  }, [crumbLabel, view, channelId]);
  useEffect(() => () => setTopbarLabel('', null), []);

  let main: React.ReactNode = null;
  if (view === 'threads') main = <ThreadsView onBack={back} />;
  else if (view === 'activity') main = <ActivityView onBack={back} />;
  else if (view === 'later') main = <LaterView onBack={back} />;
  else if (view === 'drafts') main = <DraftsView onBack={back} />;
  else if (view === 'files') main = <FilesView onBack={back} />;
  else if (view === 'search') main = <SearchView query={query} onBack={back} />;
  else if (view === 'browse') main = <BrowseView onBack={back} archivedOnly={query === 'archived'} />;
  else if (view === 'recap') main = <RecapView onBack={back} />;
  else if (channel)
    main = (
      <ChannelPane
        channel={channel}
        highlightId={highlightId}
        onBack={back}
        initialTab={channel.id === props.initialChannelId ? props.initialTab ?? null : null}
        initialListId={channel.id === props.initialChannelId ? props.initialListId ?? null : null}
      />
    );
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
  if (revoked) {
    return (
      <div className="talk-app talk-app-revoked" role="alert">
        <div className="ui-empty talk-empty">
          <p className="ui-empty-title">{t('revoked.title')}</p>
          <p className="ui-empty-body">{t('revoked.body')}</p>
          <div className="ui-empty-actions">
            <a className="btn btn-primary btn-sm" href={`/${locale}/app`}>
              {t('revoked.action')}
            </a>
          </div>
        </div>
      </div>
    );
  }

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
