'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import type { ThreadAction } from '@/lib/inbox/core';
import type { FolderDto, InboxAccountDto, InboxView, MessageDto, SnippetDto, ThreadDto } from '@/lib/inbox/types';
import type { MessageHit } from '@/lib/inbox/message-search';
import { api, INBOX_CHANGED, longWhen, notifyInboxChanged, shortWhen, typingIn } from './api';
import ChatRow from './wa/ChatRow';
import WaConversation, { type WaThreadDetail } from './wa/WaConversation';
import ContactPanel from './wa/ContactPanel';
import { ArchiveIcon, ArrowLeft } from '@/components/groups/wa/icons';
import { useChatStyle } from '@/components/chat-style/ChatStyle';
import { fetchIfChanged, ListCache, reuseRows } from '@/lib/conditional-fetch';
import { useWaLive } from '@/lib/wa-live-client';
import type { RealtimeMode } from '@/lib/realtime-client';
import { pushUrl, useShallowLinks } from '@/components/app/shallowNav';
import { useNearEnd } from '@/components/app/useNearEnd';
import DebouncedInput from '@/components/app/DebouncedInput';
import { inboxUrl, parseInboxPath, type InboxRoute } from './nav';
import Avatar from '@/components/groups/wa/Avatar';
import { chatName } from './wa/util';
import { useChatGestures, type SwipeActions } from '@/components/ui/chat-gestures';
import { dragIds } from '@/lib/chat-gestures';
import { flattenTree } from '@/lib/inbox/folder-tree';
import Conversation from './Conversation';
import type { ComposerHandle } from './Composer';
import WhenDialog, { type WhenKind } from './WhenDialog';
import ScheduleDialog, { type ScheduleTarget } from './ScheduleDialog';
import { ComposeDialog, FolderDialog, HelpDialog, MoreDialog, MoveDialog, type MoreAction } from './InboxDialogs';
import { WhatsappQrDialog } from './InboxSettings';

export interface InboxStateDto {
  accounts: InboxAccountDto[];
  folders: FolderDto[];
  counts: Record<string, number>;
  snippets: SnippetDto[];
  available: { whatsapp: boolean; gmail: boolean };
}

const TABS: InboxView[] = ['inbox', 'whatsapp', 'email', 'groups', 'unread'];
const UNDO: Partial<Record<ThreadAction['action'], ThreadAction['action']>> = {
  done: 'undone',
  undone: 'done',
  pin: 'unpin',
  unpin: 'pin',
  read: 'unread',
  unread: 'read',
  snooze: 'unsnooze',
  followUp: 'clearFollowUp',
  archive: 'unarchive',
  unarchive: 'archive',
};
/** Acciones que sacan el chat de la vista actual. */
const LEAVES: Partial<Record<InboxView, ThreadAction['action'][]>> = {
  inbox: ['done', 'snooze', 'archive'],
  whatsapp: ['done', 'snooze', 'archive'],
  email: ['done', 'snooze', 'archive'],
  groups: ['done', 'snooze', 'archive'],
  unread: ['done', 'snooze', 'read', 'archive'],
  reply: ['done', 'snooze', 'archive'],
  waiting: ['done', 'snooze', 'archive'],
  pinned: ['unpin', 'archive'],
  archived: ['unarchive'],
  snoozed: ['unsnooze', 'done'],
  done: ['undone', 'snooze', 'archive'],
};

interface Toast {
  id: number;
  text: string;
  bad?: boolean;
  undo?: () => void;
}

const HIT_MARK_START = '\u0002';

/** Chats por página de la lista (se piden más al llegar al final). */
const PAGE = 60;
/** Tope de filas que se refrescan de una vez (lo que la API devuelve como máximo). */
const MAX_HEAD = 1000;

interface ListPage {
  threads: ThreadDto[];
  next: string | null;
  /** Fijados que van adelante en la primera página (no cuentan para el tamaño de página). */
  pinned?: number;
}
/** Una lista ya vista (por vista o carpeta, y búsqueda): sus filas, el cursor para seguir y dónde quedó el scroll. */
interface CachedList extends ListPage {
  top: number;
}
type Detail = WaThreadDetail & { focus?: string; cursor?: string | null };

/** Texto de un resultado con lo encontrado resaltado (marcas \u0002…\u0003 del servidor; nunca HTML). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('\u0002') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

function viewHref(v: InboxView): string {
  return v === 'inbox' ? '/app/inbox' : `/app/inbox/v/${v}`;
}

/**
 * Inbox: la lista a la izquierda (como WhatsApp Web) y la conversación a la
 * derecha, manejable entera con el teclado (atajos de Superhuman). En
 * pantallas chicas se ve una cosa a la vez.
 */
export default function InboxApp(props: {
  view: InboxView;
  folder: FolderDto | null;
  initialThreads: ThreadDto[];
  /** Cursor de la página que sigue a initialThreads (null si no hay más). */
  initialNext?: string | null;
  /** Cuántos de initialThreads son los fijados de adelante. */
  initialPinned?: number;
  initialState: InboxStateDto;
  initialOpenId: string | null;
  /** Mensaje al que ir al abrir (desde Cmd+K). */
  initialFocusId?: string | null;
  composeOnLoad: boolean;
  /** Aviso en vivo de la lista: SSE, o polling corto (tests: con el stream abierto la página no llega a networkidle). */
  liveMode?: RealtimeMode;
}) {
  const t = useTranslations('inbox');
  const w = useTranslations('inboxWa');
  const { style: chatStyle } = useChatStyle();
  const locale = useLocale();
  const [state, setState] = useState(props.initialState);
  // La vista o carpeta sale de la URL. Cambiarla (pestañas, sidebar, atrás y adelante) solo cambia la lista:
  // la pantalla, el chat abierto y lo escrito en el composer quedan como están (ver ./nav.ts).
  const pathname = usePathname();
  const route = useMemo(() => parseInboxPath(pathname), [pathname]);
  const view = route ? route.view : props.view;
  const folderId = route ? route.folderId : (props.folder?.id ?? null);
  const folder = useMemo(
    () => (folderId ? (state.folders.find((f) => f.id === folderId) ?? (props.folder?.id === folderId ? props.folder : null)) : null),
    [folderId, state.folders, props.folder],
  );
  const [threads, setThreads] = useState(props.initialThreads);
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(props.initialOpenId);
  // Mensaje al que ir cuando se abre el chat (resultado de búsqueda).
  const focusRef = useRef<{ threadId: string; messageId: string } | null>(props.initialOpenId && props.initialFocusId ? { threadId: props.initialOpenId, messageId: props.initialFocusId } : null);
  const [msgHits, setMsgHits] = useState<MessageHit[]>([]);
  const [msgMore, setMsgMore] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const detailRef = useRef<Detail | null>(null);
  detailRef.current = detail;
  const [detailErr, setDetailErr] = useState('');
  const [listErr, setListErr] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [when, setWhen] = useState<{ kind: WhenKind; ids: string[]; text?: string } | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<ScheduleTarget | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // "Más" abierto desde una fila (deslizar o toque largo): actúa sobre ese chat y no sobre el abierto.
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [moreConfirm, setMoreConfirm] = useState(false);
  const moreActionRef = useRef<(a: MoreAction) => Promise<void>>(async () => {});
  const [infoOpen, setInfoOpen] = useState(false);
  // Otro chat: el panel de info se cierra (como en WhatsApp Web).
  useEffect(() => setInfoOpen(false), [openId]);
  const [compose, setCompose] = useState(props.composeOnLoad);
  const [help, setHelp] = useState(false);
  // Vincular WhatsApp con QR desde la bandeja vacía, sin pasar por Ajustes.
  const [qrOpen, setQrOpen] = useState(false);
  const [folderEdit, setFolderEdit] = useState<FolderDto | 'new' | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastUndo = useRef<(() => void) | null>(null);
  const seq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const gPending = useRef(0);

  const errText = useCallback((code?: string) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : code && w.has(`errors.${code}`) ? w(`errors.${code}`) : t('errors.generic')), [t, w]);
  const toast = useCallback((text: string, opts: { bad?: boolean; undo?: () => void } = {}) => {
    const id = ++seq.current;
    setToasts((x) => [...x.slice(-2), { id, text, ...opts }]);
    if (opts.undo) lastUndo.current = opts.undo;
    window.setTimeout(() => setToasts((x) => x.filter((i) => i.id !== id)), opts.undo ? 6000 : 4000);
  }, []);

  // ---- La lista: una entrada de caché por vista o carpeta (y búsqueda), páginas con cursor y pedidos que se cortan.
  const listKey = `${folderId ? `f:${folderId}` : `v:${view}`}|${q.trim()}`;
  const listBase = useMemo(() => {
    const p = new URLSearchParams();
    if (folderId) p.set('folder', folderId);
    else p.set('view', view);
    if (q.trim()) p.set('q', q.trim());
    return `/api/inbox/threads?${p.toString()}`;
  }, [folderId, view, q]);
  const [next, setNext] = useState<string | null>(props.initialNext ?? null);
  // De qué lista son las filas en pantalla: al cambiar de carpeta quedan las anteriores (atenuadas) hasta que llegan las nuevas.
  const [shownKey, setShownKey] = useState(listKey);
  const [loadingMore, setLoadingMore] = useState(false);
  const listCache = useRef(new ListCache<CachedList>(30)).current;
  const live = useRef({ want: listKey, base: listBase, shown: listKey, threads: props.initialThreads, next: props.initialNext ?? null, pinned: props.initialPinned ?? 0, etag: '', etagUrl: '', more: false });
  const listAbort = useRef<AbortController | null>(null);
  const moreAbort = useRef<AbortController | null>(null);
  const moreRef = useRef<HTMLLIElement>(null);
  const switching = shownKey !== listKey;

  const showList = useCallback((key: string, page: ListPage) => {
    const L = live.current;
    L.shown = key;
    L.threads = page.threads;
    L.next = page.next;
    if (page.pinned !== undefined) L.pinned = page.pinned;
    setThreads(page.threads);
    setNext(page.next);
    setShownKey(key);
  }, []);

  /**
   * Trae el principio de la lista `key`. Si es la que está en pantalla, refresca lo ya cargado (con ETag: sin
   * cambios no toca nada); si es otra, la pone en pantalla cuando llega. Un pedido anterior en curso se corta.
   */
  const fetchHead = useCallback(
    async (key: string, base: string) => {
      const L = live.current;
      const size = L.shown === key ? Math.min(Math.max(L.threads.length - L.pinned, PAGE), MAX_HEAD) : PAGE;
      const url = `${base}&cursor=&limit=${size}`;
      listAbort.current?.abort();
      const ctrl = new AbortController();
      listAbort.current = ctrl;
      const r = await fetchIfChanged<ListPage>(url, L.etagUrl === url ? L.etag : null, ctrl.signal);
      if (r.state === 'aborted' || live.current.want !== key) return;
      if (r.state === 'error') {
        // No llegó la lista pedida: no quedan a la vista las filas de la anterior (se ve el error con "Reintentar").
        if (L.shown !== key) showList(key, { threads: [], next: null, pinned: 0 });
        setListErr(true);
        return;
      }
      setListErr(false);
      if (r.state === 'same') return;
      L.etag = r.etag;
      L.etagUrl = url;
      const prev = L.shown === key ? L.threads : [];
      // Si hay más filas cargadas que las que cubre esta respuesta (se bajó más mientras llegaba, o pasan el tope),
      // las del fondo quedan como estaban y el cursor sigue siendo el de ellas.
      const ids = new Set(r.data.threads.map((t) => t.id));
      const covered = size + (r.data.pinned ?? 0);
      const tail = r.data.next !== null && prev.length > covered ? prev.slice(covered).filter((t) => !ids.has(t.id)) : [];
      showList(key, { threads: reuseRows(prev, tail.length ? [...r.data.threads, ...tail] : r.data.threads), next: tail.length ? L.next : r.data.next, pinned: r.data.pinned ?? 0 });
    },
    [showList],
  );

  const reloadList = useCallback(() => fetchHead(live.current.want, live.current.base), [fetchHead]);

  /** La página que sigue (al llegar al final de la lista). */
  const loadMore = useCallback(async () => {
    const L = live.current;
    if (!L.next || L.more || L.shown !== L.want) return;
    L.more = true;
    setLoadingMore(true);
    const key = L.shown;
    const ctrl = new AbortController();
    moreAbort.current = ctrl;
    const r = await fetchIfChanged<ListPage>(`${L.base}&cursor=${encodeURIComponent(L.next)}&limit=${PAGE}`, null, ctrl.signal);
    L.more = false;
    setLoadingMore(false);
    if (r.state !== 'fresh' || live.current.shown !== key || live.current.want !== key) return;
    const have = new Set(L.threads.map((t) => t.id));
    showList(key, { threads: [...L.threads, ...r.data.threads.filter((t) => !have.has(t.id))], next: r.data.next });
  }, [showList]);

  // Las filas en pantalla quedan en la caché de su lista (también lo que cambian las acciones).
  useEffect(() => {
    const L = live.current;
    L.threads = threads;
    listCache.set(L.shown, { threads, next: L.next, pinned: L.pinned, top: listCache.get(L.shown)?.top ?? 0 });
  }, [threads, next, shownKey, listCache]);

  // Otra vista, carpeta o búsqueda: si ya se vio, aparece al instante (con su scroll) y se revalida; si no,
  // quedan las filas anteriores atenuadas hasta que llega la nueva. Lo pedido para la lista anterior se corta.
  useEffect(() => {
    const L = live.current;
    if (L.want === listKey) return;
    const left = listCache.get(L.shown);
    if (left) left.top = listRef.current?.scrollTop ?? 0;
    L.want = listKey;
    L.base = listBase;
    moreAbort.current?.abort();
    setSelected(new Set());
    setCursor(0);
    const hit = listCache.get(listKey);
    if (hit) {
      showList(listKey, hit);
      requestAnimationFrame(() => {
        if (listRef.current && live.current.shown === listKey) listRef.current.scrollTop = hit.top;
      });
    }
    void fetchHead(listKey, listBase).then(() => {
      if (!hit && live.current.shown === listKey && listRef.current) listRef.current.scrollTop = 0;
    });
  }, [listKey, listBase, listCache, fetchHead, showList]);

  // Al llegar al final de la lista se pide la página que sigue (toda la historia, de a una página).
  const nearEnd = useCallback(() => void loadMore(), [loadMore]);
  useNearEnd(moreRef, !!next && !switching, nearEnd, threads.length);

  /** Va a otra vista o carpeta sin recargar la pantalla: el chat abierto sigue abierto. */
  const openRef = useRef(openId);
  openRef.current = openId;
  const go = useCallback((to: InboxRoute) => pushUrl(inboxUrl(to, openRef.current)), []);
  // Los links a una vista o carpeta (pestañas, carpetas del sidebar, "Archivados") cambian la lista acá mismo.
  // Un link con parámetros (?new=1, ?t=<chat>) pide otra cosa: navega como siempre.
  useShallowLinks((url) => {
    const to = url.search ? null : parseInboxPath(url.pathname);
    return to ? inboxUrl(to, openRef.current) : null;
  });
  // Otra vista o carpeta: la búsqueda se limpia (como al entrar).
  const routeKey = `${view}:${folderId ?? ''}`;
  const lastRoute = useRef(routeKey);
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    setQ('');
    // Pantalla chica (un panel por vez): con un chat abierto la lista no se ve, y elegir otra vista o carpeta es
    // ir a esa lista. En pantallas anchas el chat sigue abierto al lado.
    const pane = document.querySelector<HTMLElement>('.ib-list-pane');
    if (pane && window.getComputedStyle(pane).display === 'none') closeRef.current();
  }, [routeKey]);
  // La carpeta de la URL ya no existe (se borró): a la bandeja.
  useEffect(() => {
    if (folderId && !folder && state.folders !== props.initialState.folders) go({ view: 'inbox', folderId: null });
  }, [folderId, folder, state.folders, props.initialState.folders, go]);

  const stateEtag = useRef('');
  const reloadState = useCallback(async () => {
    const r = await fetchIfChanged<InboxStateDto>('/api/inbox/state', stateEtag.current);
    if (r.state !== 'fresh') return;
    stateEtag.current = r.etag;
    setState(r.data);
  }, []);

  // Chats ya abiertos: al volver a uno se ve al instante con lo último que se tenía, y se pone al día.
  const detailCache = useRef(new ListCache<Detail>(20)).current;
  const detailEtag = useRef({ id: '', etag: '' });
  const loadDetail = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setDetailErr('');
    const focus = !quiet && focusRef.current?.threadId === id ? focusRef.current.messageId : '';
    if (focus) focusRef.current = null;
    // Lo que se consulta cada pocos segundos va con ETag: sin cambios no se vuelve a dibujar la conversación.
    const r = await fetchIfChanged<Detail>(`/api/inbox/threads/${id}${focus ? `?around=${encodeURIComponent(focus)}` : ''}`, quiet && detailEtag.current.id === id ? detailEtag.current.etag : null);
    // Se abrió otro chat mientras llegaba la respuesta: no es para este.
    if (openRef.current !== id || r.state === 'same' || r.state === 'aborted') return;
    if (r.state === 'error') {
      if (!quiet) setDetailErr(r.code);
      return;
    }
    const data = r.data;
    if (focus) {
      detailEtag.current = { id: '', etag: '' };
      setDetail({ ...data, focus, extended: true });
      return;
    }
    detailEtag.current = { id, etag: r.etag };
    setDetail((d) => {
      // Con mensajes anteriores ya cargados: quedan los de antes de esta página y lo reciente se actualiza
      // (reacciones, tildes, borrados). Si no, la página nueva tal cual.
      if (!(quiet && d && d.thread.id === id && d.extended)) return data;
      const first = data.messages[0]?.sentAt;
      const older = first ? d.messages.filter((m) => m.sentAt < first) : d.messages;
      return { ...data, messages: [...older, ...data.messages], more: d.more, cursor: d.cursor, extended: true };
    });
  }, []);
  useEffect(() => {
    if (!detail) return;
    const { focus: _focus, ...rest } = detail;
    detailCache.set(detail.thread.id, rest);
  }, [detail, detailCache]);

  /** Los mensajes anteriores a los que hay (al subir en la conversación), con el cursor de la página más vieja. */
  const loadOlder = useCallback(async () => {
    const d = detailRef.current;
    const first = d?.messages[0];
    if (!d || !first) return;
    const id = d.thread.id;
    const r = await api<{ messages: MessageDto[]; more: boolean; cursor?: string | null }>(`/api/inbox/threads/${id}/messages?before=${encodeURIComponent(d.cursor ?? first.sentAt)}`);
    if (!r.ok) return;
    setDetail((cur) => {
      if (!cur || cur.thread.id !== id) return cur;
      const have = new Set(cur.messages.map((m) => m.id));
      return { ...cur, messages: [...r.data.messages.filter((m) => !have.has(m.id)), ...cur.messages], more: r.data.more, cursor: r.data.cursor ?? null, extended: true };
    });
  }, []);

  /** Mensajes que coinciden con la búsqueda (texto completo y filtros). */
  const searchMsgs = useCallback(
    async (more = false) => {
      const term = q.trim();
      if (!term) {
        setMsgHits([]);
        setMsgMore(false);
        return;
      }
      const last = more ? msgHits[msgHits.length - 1]?.sentAt : undefined;
      const r = await api<{ messages: MessageHit[]; more: boolean }>(`/api/inbox/search?q=${encodeURIComponent(term)}${last ? `&before=${encodeURIComponent(last)}` : ''}`);
      if (!r.ok) return;
      setMsgHits((h) => (more ? [...h, ...r.data.messages] : r.data.messages));
      setMsgMore(r.data.more);
    },
    [q, msgHits],
  );

  const openHit = (h: MessageHit) => {
    focusRef.current = { threadId: h.threadId, messageId: h.id };
    if (openId === h.threadId) void loadDetail(h.threadId);
    else {
      const idx = threads.findIndex((x) => x.id === h.threadId);
      if (idx >= 0) setCursor(idx);
      setOpenId(h.threadId);
    }
  };

  // Búsqueda: los mensajes que coinciden (la lista de chats la pide el cambio de `listKey`).
  useEffect(() => {
    if (!q.trim() && msgHits.length === 0) return;
    void searchMsgs();
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abrir un chat: lo trae, lo marca leído (y "volvió" visto) y deja la URL compartible.
  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    // Ya se abrió antes: se ve al instante y se pone al día sin esqueleto.
    const cached = focusRef.current?.threadId === openId ? undefined : detailCache.get(openId);
    if (cached) setDetail(cached);
    void loadDetail(openId, !!cached);
    const url = new URL(window.location.href);
    url.searchParams.set('t', openId);
    window.history.replaceState(window.history.state, '', url.toString());
    const th = threads.find((x) => x.id === openId);
    if (th && (th.unread > 0 || th.woke)) {
      void api(`/api/inbox/threads/${openId}`, { method: 'PATCH', json: { action: 'seen' } }).then(() => {
        setThreads((xs) => xs.map((x) => (x.id === openId ? { ...x, unread: 0, woke: '' } : x)));
        void reloadState();
      });
    }
  }, [openId]); // eslint-disable-line react-hooks/exhaustive-deps

  // En vivo: cada 8 s con la pestaña visible, y al volver a la pestaña.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void reloadList();
      void reloadState();
      if (openId) void loadDetail(openId, true);
    };
    const id = window.setInterval(tick, 8000);
    const onVis = () => tick();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener(INBOX_CHANGED, tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener(INBOX_CHANGED, tick);
    };
  }, [reloadList, reloadState, loadDetail, openId]);

  // Al instante: un mensaje que saca un chat de Archivados, archivar desde el teléfono, otra pestaña (lib/wa-live.ts).
  useWaLive(
    'inbox',
    (ids) => {
      void reloadList();
      void reloadState();
      const o = openRef.current;
      if (o && (!ids.length || ids.includes(o))) void loadDetail(o, true);
    },
    props.liveMode,
  );

  // Chat de WhatsApp abierto: cada 3 s (escribiendo…, tildes, reacciones), como en vivo.
  const openIsWa = detail?.thread.channel === 'whatsapp' && detail.thread.id === openId;
  useEffect(() => {
    if (!openId || !openIsWa) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDetail(openId, true);
    }, 3000);
    return () => window.clearInterval(id);
  }, [openId, openIsWa, loadDetail]);

  useEffect(() => {
    if (cursor >= threads.length && threads.length) setCursor(threads.length - 1);
  }, [threads.length, cursor]);

  // El cursor siempre a la vista.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const current = threads[cursor] ?? null;
  const targetIds = useCallback((): string[] => {
    if (selected.size) return [...selected];
    if (openId) return [openId];
    return current ? [current.id] : [];
  }, [selected, openId, current]);

  const runAction = useCallback(
    async (ids: string[], action: ThreadAction, opts: { silent?: boolean } = {}): Promise<boolean> => {
      if (!ids.length) return false;
      const r = await api('/api/inbox/threads', { method: 'POST', json: { ids, ...action } });
      if (!r.ok) {
        toast(errText(r.data.error), { bad: true });
        return false;
      }
      const leaves = !q && (folder ? ['done', 'snooze', 'archive'] : (LEAVES[view] ?? [])).includes(action.action);
      if (leaves) {
        const idx = threads.findIndex((x) => ids.includes(x.id));
        const rest = threads.filter((x) => !ids.includes(x.id));
        setThreads(rest);
        setSelected(new Set());
        if (openId && ids.includes(openId)) {
          const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
          setOpenId(next ? next.id : null);
          if (!next) {
            const url = new URL(window.location.href);
            url.searchParams.delete('t');
            window.history.replaceState(window.history.state, '', url.toString());
          }
        }
        setCursor(Math.min(Math.max(idx, 0), Math.max(rest.length - 1, 0)));
      } else {
        void reloadList();
      }
      if (openId && ids.includes(openId)) void loadDetail(openId, true);
      void reloadState();
      notifyInboxChanged();
      const inverse = UNDO[action.action];
      if (!opts.silent) {
        const undo = inverse || action.action === 'addFolder' ? () => {
          const back: ThreadAction = action.action === 'addFolder' ? { action: 'removeFolder', folderId: action.folderId } : ({ action: inverse } as ThreadAction);
          void api('/api/inbox/threads', { method: 'POST', json: { ids, ...back } }).then(() => {
            void reloadList();
            void reloadState();
            notifyInboxChanged();
          });
        } : undefined;
        toast(t(`toast.${action.action}`, { n: ids.length }), { undo });
      }
      return true;
    },
    [q, folder, view, threads, openId, toast, errText, t, reloadList, reloadState, loadDetail],
  );

  const act = useCallback(
    (name: string) => {
      const ids = targetIds();
      if (!ids.length) return;
      const th = threads.find((x) => x.id === ids[0]) ?? detail?.thread;
      switch (name) {
        case 'done':
        case 'undone':
          void runAction(ids, { action: name });
          break;
        case 'toggleDone':
          void runAction(ids, { action: th?.done ? 'undone' : 'done' });
          break;
        case 'snooze':
          setWhen({ kind: 'snooze', ids });
          break;
        case 'followUp':
          setWhen({ kind: 'followUp', ids });
          break;
        case 'move':
          setMoveIds(ids);
          break;
        case 'more':
          setMoreFor(null);
          setMoreConfirm(false);
          setMoreOpen(true);
          break;
        case 'delete':
          setMoreFor(null);
          setMoreConfirm(true);
          setMoreOpen(true);
          break;
        case 'aiDraft':
        case 'mute8h':
        case 'muteWeek':
        case 'unmute':
        case 'clearFollowUp':
        case 'unsnooze':
          void moreActionRef.current(name);
          break;
        case 'archive':
        case 'unarchive':
          void runAction(ids, { action: name });
          break;
        case 'unread':
          void runAction(ids, { action: th && th.unread > 0 ? 'read' : 'unread' });
          break;
        case 'pin':
          void runAction(ids, { action: th?.pinned ? 'unpin' : 'pin' });
          break;
      }
    },
    [targetIds, threads, detail, runAction],
  );

  /**
   * Chats soltados sobre una carpeta del sidebar. En la bandeja (o una vista)
   * se suman a la carpeta; dentro de otra carpeta se mueven (salen de la
   * actual). Deshacer vuelve exactamente a como estaban.
   */
  const dropOnFolder = useCallback(
    async ({ ids, folderId, folderName }: { ids: string[]; folderId: string; folderName: string }) => {
      const from = folder && folder.id !== folderId ? folder.id : null;
      const fresh = ids.filter((id) => !(threads.find((x) => x.id === id)?.folderIds ?? []).includes(folderId));
      const post = (list: string[], a: ThreadAction) => (list.length ? api('/api/inbox/threads', { method: 'POST', json: { ids: list, ...a } }) : Promise.resolve({ ok: true, status: 200, data: {} as { error?: string } }));
      const r = await post(fresh, { action: 'addFolder', folderId });
      const r2 = r.ok && from ? await post(ids, { action: 'removeFolder', folderId: from }) : r;
      if (!r.ok || !r2.ok) {
        toast(errText((r.ok ? r2 : r).data.error), { bad: true });
        return;
      }
      setSelected(new Set());
      const refresh = () => {
        void reloadList();
        void reloadState();
        notifyInboxChanged();
      };
      refresh();
      const undo = () =>
        void post(fresh, { action: 'removeFolder', folderId })
          .then(() => (from ? post(ids, { action: 'addFolder', folderId: from }) : null))
          .then(refresh);
      toast(t(from ? 'toast.movedTo' : 'toast.addedTo', { n: ids.length, name: folderName }), { undo });
    },
    [folder, threads, toast, errText, t, reloadList, reloadState],
  );

  const open = (id: string) => {
    const idx = threads.findIndex((x) => x.id === id);
    if (idx >= 0) setCursor(idx);
    setOpenId(id);
  };

  const closeConvo = useCallback(() => {
    setOpenId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('t');
    window.history.replaceState(window.history.state, '', url.toString());
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"] .ib-row-btn`)?.focus());
  }, [cursor]);
  closeRef.current = closeConvo;

  const moreAction = async (a: MoreAction) => {
    setMoreOpen(false);
    setMoreConfirm(false);
    const th = (moreFor ? threads.find((x) => x.id === moreFor) : null) ?? detail?.thread ?? current;
    if (!th) return;
    if (a === 'delete') {
      const r = await api(`/api/inbox/threads/${th.id}`, { method: 'DELETE' });
      if (!r.ok) {
        toast(errText(r.data.error), { bad: true });
        return;
      }
      setThreads((xs) => xs.filter((x) => x.id !== th.id));
      if (openId === th.id) closeConvo();
      toast(t('toast.deleted'));
      void reloadState();
      notifyInboxChanged();
      return;
    }
    if (a === 'mute8h' || a === 'muteWeek' || a === 'unmute') {
      const until = a === 'unmute' ? null : new Date(Date.now() + (a === 'mute8h' ? 8 : 168) * 3600_000).toISOString();
      await runAction([th.id], { action: 'mute', until });
      return;
    }
    if (a === 'unread') await runAction([th.id], { action: th.unread > 0 ? 'read' : 'unread' });
    if (a === 'pin') await runAction([th.id], { action: th.pinned ? 'unpin' : 'pin' });
    if (a === 'clearFollowUp') await runAction([th.id], { action: 'clearFollowUp' });
    if (a === 'unsnooze') await runAction([th.id], { action: 'unsnooze' });
    if (a === 'aiDraft') {
      // El borrador se escribe en la conversación: si "Más" vino de otra fila, primero se abre.
      if (moreFor && openId !== th.id) {
        open(th.id);
        window.setTimeout(() => composer.current?.draft(), 350);
      } else composer.current?.draft();
    }
  };
  moreActionRef.current = moreAction;

  const modalOpen = !!when || !!plan || !!moveIds || moreOpen || compose || help || qrOpen || !!folderEdit;

  // Atajos de una letra (fuera de los campos y sin modales abiertos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen || e.defaultPrevented || typingIn(document.activeElement) || document.querySelector('dialog[open]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = 0;
        const jump: Record<string, InboxView> = { i: 'inbox', d: 'done', s: 'snoozed', r: 'reply', w: 'waiting', l: 'scheduled', u: 'unread' };
        if (jump[k]) {
          e.preventDefault();
          go({ view: jump[k], folderId: null });
        }
        return;
      }
      const handled = () => e.preventDefault();
      switch (k) {
        case 'j':
        case 'ArrowDown':
          handled();
          setCursor((c) => {
            const n = Math.min(c + 1, threads.length - 1);
            if (openId && threads[n]) setOpenId(threads[n].id);
            return n;
          });
          break;
        case 'k':
        case 'ArrowUp':
          handled();
          setCursor((c) => {
            const n = Math.max(c - 1, 0);
            if (openId && threads[n]) setOpenId(threads[n].id);
            return n;
          });
          break;
        case 'Enter':
        case 'o':
          if (current) {
            handled();
            setOpenId(current.id);
          }
          break;
        case 'Escape':
          if (selected.size) setSelected(new Set());
          else if (infoOpen) setInfoOpen(false);
          else if (openId) closeConvo();
          else if (q) setQ('');
          break;
        case 'e':
          handled();
          act('toggleDone');
          break;
        case 'E':
          handled();
          act('undone');
          break;
        case 'h':
          handled();
          act('snooze');
          break;
        case 'f':
          handled();
          act('followUp');
          break;
        case 'u':
          handled();
          act('unread');
          break;
        case 'p':
          handled();
          act('pin');
          break;
        case 'v':
          handled();
          act('move');
          break;
        case 'x':
          if (current) {
            handled();
            setSelected((s) => {
              const n = new Set(s);
              if (n.has(current.id)) n.delete(current.id);
              else n.add(current.id);
              return n;
            });
          }
          break;
        case 'r':
          if (current || openId) {
            handled();
            if (!openId && current) setOpenId(current.id);
            window.setTimeout(() => composer.current?.focus(), openId ? 0 : 350);
          }
          break;
        case 'c':
          handled();
          setCompose(true);
          break;
        case '/':
          handled();
          searchRef.current?.focus();
          break;
        case 'z':
          if (lastUndo.current) {
            handled();
            const u = lastUndo.current;
            lastUndo.current = null;
            u();
            toast(t('toast.reverted'));
          }
          break;
        case '?':
          handled();
          setHelp(true);
          break;
        case 'g':
          gPending.current = Date.now();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, threads, current, openId, selected, q, act, closeConvo, go, toast, t, infoOpen]);

  const accounts = state.accounts;
  const noAccounts = accounts.length === 0;
  const detailAccount = detail ? accounts.find((a) => a.id === detail.thread.accountId) : null;
  const tabView = folder ? null : TABS.includes(view) ? view : null;

  const viewTitle = folder ? folder.name : q ? t('list.searchResults') : t(`views.${view}`);
  const loading = switching;
  // El título de la pestaña sigue a la vista (la página no se vuelve a pedir al cambiarla).
  const tabTitle = folder ? folder.name : t(`views.${view}`);
  useEffect(() => {
    document.title = `${tabTitle} · Inbox`;
  }, [tabTitle]);

  /**
   * Deslizar una fila, como WhatsApp (y como Lines): a la derecha, leído o no
   * leído (la principal) y fijar; a la izquierda, archivar (la principal) y
   * más. Con chats seleccionados no se desliza. Todo sigue en el menú y en los
   * atajos (U, P, V, M).
   */
  const swipeActions = (id: string): SwipeActions | null => {
    const th = threads.find((x) => x.id === id);
    if (!th || selected.size > 0) return null;
    return {
      right: [
        { key: 'unread', label: th.unread > 0 ? t('swipe.read') : t('swipe.unread'), icon: th.unread > 0 ? 'read' : 'unread', onSelect: () => void runAction([id], { action: th.unread > 0 ? 'read' : 'unread' }) },
        { key: 'pin', label: th.pinned ? t('swipe.unpin') : t('swipe.pin'), icon: th.pinned ? 'unpin' : 'pin', onSelect: () => void runAction([id], { action: th.pinned ? 'unpin' : 'pin' }) },
      ],
      left: [
        { key: 'archive', label: th.archived ? t('swipe.unarchive') : t('swipe.archive'), icon: th.archived ? 'unarchive' : 'archive', leaves: true, onSelect: () => void runAction([id], { action: th.archived ? 'unarchive' : 'archive' }) },
        { key: 'more', label: t('swipe.more'), icon: 'more', onSelect: () => openMoreFor(id) },
      ],
    };
  };
  const openMoreFor = (id: string) => {
    setMoreFor(id);
    setMoreConfirm(false);
    setMoreOpen(true);
  };
  const gestures = useChatGestures({
    scope: 'inbox',
    actionsFor: swipeActions,
    // Levantar un chat seleccionado lleva la selección entera.
    idsFor: (id) => dragIds(id, selected, threads.map((x) => x.id)),
    chipFor: (id, ids) => {
      const th = threads.find((x) => x.id === id);
      if (ids.length > 1 || !th) return { label: t('list.dragMany', { n: ids.length }) };
      const name = chatName(th, w('group'));
      return { label: name, avatar: <Avatar name={name} kind={th.kind === 'group' ? 'group' : 'dm'} src={th.avatar || undefined} seed={th.id} size={24} /> };
    },
    // Un chat puede estar en varias carpetas: no sirve soltarlo donde ya están todos.
    canDrop: (ids, target) => ids.some((id) => !(threads.find((x) => x.id === id)?.folderIds ?? []).includes(target)),
    onDrop: (ids, target, name) => void dropOnFolder({ ids, folderId: target, folderName: state.folders.find((f) => f.id === target)?.name ?? name }),
    onHoldTap: (id) => {
      if (selected.size === 0) openMoreFor(id);
    },
    tray: {
      title: t('swipe.dropTitle'),
      empty: t('swipe.dropEmpty'),
      items: flattenTree(state.folders).map(({ folder: f, depth }) => ({ id: f.id, name: f.name, depth })),
    },
  });

  const rowFor = (th: ThreadDto, i: number) => {
    const isSel = selected.has(th.id);
    const marker = th.woke === 'snooze' ? t('list.woke') : th.woke === 'followup' ? t('list.noReply') : '';
    return (
      <li
        key={th.id}
        data-idx={i}
        className={`ib-item${i === cursor ? ' is-cursor' : ''}${th.id === openId ? ' is-open' : ''}${th.unread ? ' is-unread' : ''}${isSel ? ' is-selected' : ''}`}
        {...gestures.rowProps(th.id)}
      >
        {gestures.actions(th.id)}
        <input
          type="checkbox"
          className="ib-check"
          checked={isSel}
          aria-label={t('list.select', { name: th.title })}
          onChange={() =>
            setSelected((s) => {
              const n = new Set(s);
              if (n.has(th.id)) n.delete(th.id);
              else n.add(th.id);
              return n;
            })
          }
        />
        <button
          type="button"
          className="ib-row-btn"
          aria-current={th.id === openId ? 'true' : undefined}
          onClick={(e) => {
            if (e.shiftKey || e.metaKey) {
              setSelected((s) => new Set(s).add(th.id));
              return;
            }
            open(th.id);
          }}
          onFocus={() => setCursor(i)}
        >
          <ChatRow
            th={th}
            timeLabel={view === 'snoozed' && th.snoozedUntil ? longWhen(th.snoozedUntil, locale) : undefined}
            extra={
              <>
                {th.channel === 'gmail' && <span className="ib-chan-dot" data-ch="gmail" role="img" aria-label="Gmail" />}
                {marker && <span className="ib-tag ib-tag-strong">{marker}</span>}
                {th.scheduledCount > 0 && <span className="ib-tag">{t('list.scheduled', { n: th.scheduledCount })}</span>}
              </>
            }
          />
        </button>
      </li>
    );
  };

  const anyConnected = accounts.some((a) => a.status === 'connected');
  const showInfo = infoOpen && !!openId && detail?.thread.channel === 'whatsapp' && detail.thread.id === openId;

  return (
    <div className={`ib-app gr-inbox${openId ? ' has-open' : ''}${showInfo ? ' has-details' : ''}`} data-chat-style={chatStyle}>
      <div className="ib-list-pane">
        <div className="ib-list-head">
          <div className="ib-list-title">
            <h1 className="ib-h1">{viewTitle}</h1>
            {folder && (
              <span className="ib-row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFolderEdit(folder)}>
                  {t('folders.edit')}
                </button>
              </span>
            )}
            <button type="button" className="btn btn-ghost btn-sm ib-compose-btn" onClick={() => setCompose(true)} title="C">
              {t('actions.compose')}
            </button>
          </div>
          <div className="ib-search">
            <label className="sr-only" htmlFor="ib-search">
              {t('list.search')}
            </label>
            <DebouncedInput
              id="ib-search"
              ref={searchRef}
              className="input"
              type="search"
              placeholder={t('list.searchPlaceholder')}
              value={q}
              maxLength={200}
              onCommit={setQ}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setQ('');
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                  setCursor(0);
                  listRef.current?.querySelector<HTMLElement>('.ib-row-btn')?.focus();
                }
              }}
            />
          </div>
          {tabView && !q && (
            <nav className="ui-tabs ib-tabs" aria-label={t('list.filters')}>
              {TABS.map((v) => (
                <Link key={v} href={viewHref(v)} prefetch={false} className={`ui-tab${v === view ? ' is-active' : ''}`} aria-current={v === view ? 'page' : undefined}>
                  {t(`tabs.${v}`)}
                </Link>
              ))}
            </nav>
          )}
          <div className="ib-mobile-views">
            <label className="sr-only" htmlFor="ib-view-select">
              {t('list.goTo')}
            </label>
            <select
              id="ib-view-select"
              className="select"
              value={folder ? `f:${folder.id}` : `v:${view}`}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':');
                go(kind === 'f' ? { view: 'inbox', folderId: id } : { view: id as InboxView, folderId: null });
              }}
            >
              {(['inbox', 'reply', 'waiting', 'unread', 'whatsapp', 'email', 'groups', 'pinned', 'snoozed', 'scheduled', 'done', 'archived'] as InboxView[]).map((v) => (
                <option key={v} value={`v:${v}`}>
                  {t(`views.${v}`)}
                </option>
              ))}
              {state.folders.map((f) => (
                <option key={f.id} value={`f:${f.id}`}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          {selected.size > 0 && (
            <div className="ib-bulk" role="toolbar" aria-label={t('list.bulk', { n: selected.size })}>
              <span>{t('list.bulk', { n: selected.size })}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('toggleDone')}>
                {view === 'done' ? t('actions.undone') : t('actions.done')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('snooze')}>
                {t('actions.snooze')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act('move')}>
                {t('actions.move')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(view === 'archived' ? 'unarchive' : 'archive')}>
                {view === 'archived' ? t('actions.unarchive') : t('actions.archive')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                {t('actions.clear')}
              </button>
            </div>
          )}
        </div>
        {!q && !folder && view !== 'archived' && (state.counts.archived ?? 0) > 0 && (
          <Link href={viewHref('archived')} prefetch={false} className="ib-archived-entry" data-testid="inbox-archived-entry">
            <ArchiveIcon size={20} />
            <span>{t('list.archivedEntry')}</span>
            <span className="ib-archived-n">{state.counts.archived}</span>
          </Link>
        )}
        {view === 'archived' && !q && !folder && (
          <Link href={viewHref('inbox')} prefetch={false} className="ib-archived-entry" data-testid="inbox-archived-back">
            <ArrowLeft size={20} />
            <span>{t('list.archivedBack')}</span>
          </Link>
        )}
        {listErr && threads.length === 0 ? (
          <div className="ib-list-msg" role="alert">
            <p>{t('errors.list')}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reloadList()}>
              {t('actions.retry')}
            </button>
          </div>
        ) : loading && threads.length === 0 ? (
          <div className="ib-list-msg" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="ui-skeleton ui-skeleton-row" />
            ))}
          </div>
        ) : threads.length === 0 && !(q.trim() && msgHits.length) ? (
          <div className="ib-list-empty">
            {noAccounts && !q ? (
              <EmptyState
                product="inbox"
                title={t('empty.connectTitle')}
                body={t('empty.connectBody')}
                action={
                  state.available.whatsapp ? (
                    <button type="button" className="btn btn-primary" data-testid="inbox-empty-qr" onClick={() => setQrOpen(true)}>
                      {t('empty.qrAction')}
                    </button>
                  ) : (
                    { label: t('empty.connectAction'), href: '/app/inbox/settings' }
                  )
                }
                secondary={
                  <>
                    {state.available.whatsapp && (
                      <>
                        <Link href="/app/inbox/settings">{t('empty.otherAccounts')}</Link>{' '}
                      </>
                    )}
                    <Link href="/app/inbox/settings#import">{t('empty.importLink')}</Link>
                  </>
                }
              />
            ) : (
              <EmptyState
                product="inbox"
                compact
                title={q ? t('empty.searchTitle') : t(`empty.view.${folder ? 'folder' : view}`)}
                body={q ? t('empty.searchBody') : view === 'inbox' && !folder ? t('empty.zeroBody') : undefined}
              />
            )}
          </div>
        ) : (
          <ul className={`ib-list${switching ? ' is-stale' : ''}`} ref={listRef} aria-label={viewTitle} aria-busy={loading || undefined} data-list={shownKey} data-chat-list>
            {threads.map(rowFor)}
            {next && !switching && (
              <li ref={moreRef} className="ib-list-more" role="presentation" aria-busy={loadingMore || undefined} data-testid="inbox-list-more">
                <span className="ui-skeleton ui-skeleton-row" />
              </li>
            )}
            {q.trim() !== '' && msgHits.length > 0 && (
              <li className="ib-hits" role="presentation">
                <h2 className="ib-hits-h" id="ib-hits-h">
                  {t('list.messagesFound')}
                </h2>
                <ul className="ib-hits-list" aria-labelledby="ib-hits-h">
                  {msgHits.map((h) => (
                    <li key={h.id}>
                      <button type="button" className="ib-hit" onClick={() => openHit(h)} data-testid="inbox-search-hit">
                        <span className="ib-hit-top">
                          <span className="ib-hit-chat">{h.threadTitle}</span>
                          <span className="ib-row-when">{shortWhen(h.sentAt, locale)}</span>
                        </span>
                        <span className="ib-hit-text">
                          <span className="ib-dim">{h.fromMe ? t('list.you') : h.kind === 'group' && h.senderName ? `${h.senderName}: ` : ''} </span>
                          {h.mediaName && !h.snippet.includes(HIT_MARK_START) && <span className="ib-tag">{h.mediaName}</span>}
                          <Highlighted text={h.snippet} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {msgMore && (
                  <button type="button" className="btn btn-ghost btn-sm ib-hits-more" onClick={() => void searchMsgs(true)}>
                    {t('list.moreMessages')}
                  </button>
                )}
              </li>
            )}
          </ul>
        )}
        <p className="ib-keys-hint">
          <button type="button" className="ib-link-btn" onClick={() => setHelp(true)}>
            {t('help.hint')}
          </button>
        </p>
      </div>
      <div className="ib-convo-pane">
        {openId && detailErr ? (
          <div className="ib-convo-msg" role="alert">
            <p>{errText(detailErr)}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadDetail(openId)}>
              {t('actions.retry')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={closeConvo}>
              {t('actions.back')}
            </button>
          </div>
        ) : openId && !detail ? (
          <div className="ib-convo-msg" aria-busy="true">
            <span className="ui-skeleton ui-skeleton-title" />
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : detail && openId && detail.thread.channel === 'whatsapp' ? (
          <WaConversation
            ref={composer}
            detail={detail}
            folders={state.folders}
            snippets={state.snippets}
            connected={detailAccount?.status === 'connected'}
            threads={threads}
            infoOpen={infoOpen}
            onBack={closeConvo}
            onAction={act}
            onSent={(messages: MessageDto[]) => {
              setDetail((d) => (d ? { ...d, messages } : d));
              void reloadList();
            }}
            onSendLater={(text) => setPlan({ threadId: detail.thread.id, channel: detail.thread.channel, text })}
            onScheduledChange={() => {
              void loadDetail(detail.thread.id, true);
              void reloadState();
              void reloadList();
            }}
            onError={(code) => toast(errText(code), { bad: true })}
            onToast={(text) => toast(text)}
            onToggleInfo={() => setInfoOpen((v) => !v)}
            onRename={async (title) => {
              const r = await api(`/api/inbox/threads/${detail.thread.id}`, { method: 'PATCH', json: { title } });
              if (!r.ok) toast(errText(r.data.error), { bad: true });
              void loadDetail(detail.thread.id, true);
              void reloadList();
            }}
            onRefresh={() => {
              void loadDetail(detail.thread.id, true);
              void reloadList();
            }}
            loadOlder={loadOlder}
          />
        ) : detail && openId ? (
          <Conversation
            ref={composer}
            detail={detail}
            folders={state.folders}
            snippets={state.snippets}
            connected={detailAccount?.status === 'connected'}
            onBack={closeConvo}
            onAction={act}
            onSent={(messages: MessageDto[]) => {
              setDetail((d) => (d ? { ...d, messages } : d));
              void reloadList();
            }}
            onSendLater={(text) => setPlan({ threadId: detail.thread.id, channel: detail.thread.channel, text })}
            onScheduledChange={() => {
              void loadDetail(detail.thread.id, true);
              void reloadState();
              void reloadList();
            }}
            onRename={async (title) => {
              const r = await api(`/api/inbox/threads/${detail.thread.id}`, { method: 'PATCH', json: { title } });
              if (!r.ok) toast(errText(r.data.error), { bad: true });
              void loadDetail(detail.thread.id, true);
              void reloadList();
            }}
            onError={(code) => toast(errText(code), { bad: true })}
            loadOlder={loadOlder}
          />
        ) : (
          <div className="ib-convo-blank">
            <p className="ib-dim">{anyConnected ? t('convo.pick') : t('convo.pickNoAccount')}</p>
            <p className="ib-dim ib-keys-inline">
              <span className="kbd">J</span> <span className="kbd">K</span> {t('convo.keysMove')} · <span className="kbd">E</span> {t('convo.keysDone')} · <span className="kbd">H</span> {t('convo.keysSnooze')} · <span className="kbd">?</span>
            </p>
          </div>
        )}
      </div>
      {showInfo && detail && (
        <ContactPanel
          thread={detail.thread}
          wa={detail.wa ?? null}
          onClose={() => setInfoOpen(false)}
          onOpenThread={(id) => {
            setInfoOpen(false);
            open(id);
          }}
          onStartChat={async (phone) => {
            const r = await api<{ thread: ThreadDto }>('/api/inbox/compose', { method: 'POST', json: { channel: 'whatsapp', to: phone } });
            if (!r.ok) {
              toast(errText(r.data.error), { bad: true });
              return;
            }
            setInfoOpen(false);
            setThreads((xs) => [r.data.thread, ...xs.filter((x) => x.id !== r.data.thread.id)]);
            setOpenId(r.data.thread.id);
          }}
          onMute={(until) => void runAction([detail.thread.id], { action: 'mute', until })}
          onError={(code) => toast(errText(code), { bad: true })}
          onToast={(text) => toast(text)}
          onChanged={() => void loadDetail(detail.thread.id, true)}
        />
      )}

      <WhenDialog
        kind={when?.kind ?? null}
        onClose={() => setWhen(null)}
        onPick={async (iso) => {
          const w = when;
          setWhen(null);
          if (!w) return;
          if (w.kind === 'sendLater') {
            const r = await api(`/api/inbox/threads/${w.ids[0]}/messages`, { method: 'POST', json: { body: w.text, sendAt: iso } });
            if (!r.ok) {
              toast(errText(r.data.error), { bad: true });
              return;
            }
            composer.current?.clear();
            toast(t('toast.scheduled', { when: longWhen(iso, locale) }));
            void loadDetail(w.ids[0], true);
            void reloadState();
            void reloadList();
            return;
          }
          await runAction(w.ids, w.kind === 'snooze' ? { action: 'snooze', until: iso } : { action: 'followUp', at: iso });
        }}
      />
      <ScheduleDialog
        target={plan}
        onClose={() => setPlan(null)}
        onDone={(_scheduled, sendAt) => {
          const p = plan;
          setPlan(null);
          if (!p) return;
          composer.current?.clear();
          toast(t('toast.scheduled', { when: longWhen(sendAt, locale) }));
          void loadDetail(p.threadId, true);
          void reloadState();
          void reloadList();
        }}
      />
      <MoveDialog
        open={!!moveIds}
        folders={state.folders}
        current={moveIds && moveIds.length === 1 ? (threads.find((x) => x.id === moveIds[0])?.folderIds ?? detail?.thread.folderIds ?? []) : []}
        onClose={() => setMoveIds(null)}
        onPick={async (folderId, add) => {
          const ids = moveIds ?? [];
          setMoveIds(null);
          await runAction(ids, add ? { action: 'addFolder', folderId } : { action: 'removeFolder', folderId });
        }}
        onNewFolder={() => {
          setMoveIds(null);
          setFolderEdit('new');
        }}
      />
      <MoreDialog
        open={moreOpen}
        thread={(moreFor ? threads.find((x) => x.id === moreFor) : null) ?? detail?.thread ?? current}
        onClose={() => {
          setMoreOpen(false);
          setMoreConfirm(false);
        }}
        startConfirm={moreConfirm}
        onAction={(a) => void moreAction(a)}
      />
      <ComposeDialog
        open={compose}
        accounts={accounts}
        onClose={() => setCompose(false)}
        onCreated={(th) => {
          setCompose(false);
          setThreads((xs) => [th, ...xs.filter((x) => x.id !== th.id)]);
          setCursor(0);
          setOpenId(th.id);
          void reloadState();
        }}
      />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <WhatsappQrDialog open={qrOpen} onClose={() => setQrOpen(false)} onLinked={() => void reloadState()} />
      <FolderDialog
        folder={folderEdit === 'new' ? null : folderEdit}
        folders={state.folders}
        open={!!folderEdit}
        onClose={() => setFolderEdit(null)}
        onSaved={(f, deleted) => {
          setFolderEdit(null);
          notifyInboxChanged();
          void reloadState();
          if (deleted) go({ view: 'inbox', folderId: null });
          else if (f && folder && f.id === folder.id) void reloadList();
          else if (f && folderEdit === 'new' && moveIds === null) toast(t('toast.folderCreated', { name: f.name }));
        }}
      />
      {gestures.layer}
      <div className="ui-toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`ui-toast${x.bad ? ' ui-toast-bad' : ''} ib-toast`}>
            <span>{x.text}</span>
            {x.undo && (
              <button
                type="button"
                className="ib-link-btn"
                onClick={() => {
                  x.undo?.();
                  lastUndo.current = null;
                  setToasts((xs) => xs.filter((i) => i.id !== x.id));
                }}
              >
                {t('toast.undo')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
