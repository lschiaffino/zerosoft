'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, GroupsPerson, LabelDto, PropertyDef } from '@/lib/groups';
import type { SavedListDto, SavedListFilters } from '@/lib/groups-org';
import { cleanHubspotFilters, type HubspotPropFilter } from '@/lib/groups-hubspot-shared';
import FilterPanel, { FilterChips } from '@/components/ui/FilterPanel';
import { filterChips, type ChipStrings, type FilterCategory, type FilterField, type FilterOption, type FilterValues } from '@/lib/filter-panel';
import {
  LINES_TABS,
  ME,
  NONE,
  PROP_SET,
  PROP_UNSET,
  activeTabs,
  applyTab,
  countFilters,
  filtersToValues,
  isEmptyFilters,
  linesFiltersFromParam,
  parseLinesFilters,
  propFieldId,
  serializeLinesFilters,
  valuesToFilters,
  withoutSearch,
  type LinesFilters,
  type LinesTab,
  type PropKinds,
} from '@/lib/groups-filters';
import HubspotFilter from './HubspotFilter';
import { LISTS_CHANGED, notifyListsChanged } from './GroupsListsBranch';
import { filterOptions } from './PropertyInput';
import { ScheduledAllButton } from './Scheduled';
import { LabelTag, Modal, api, markChatSwitch, useErrorText, useMediaText, useRelativeTime, useSwitchingTo, useToast } from './ui';
import Avatar from './wa/Avatar';
import { duration, listTime } from './wa/format';
import { plainWa } from './wa/rich';
import { ArchiveIcon, ArrowLeft, Ban, CheckIcon, Chevron, Close, FilterIcon, Mic, MuteIcon, PinIcon, Search, Ticks } from './wa/icons';
import { MessageMenu, type MenuItem } from './ThreadParts';
import type { ImportStatus } from '@/lib/groups-import';
import { useChatStyle } from '@/components/chat-style/ChatStyle';
import type { LineFolderDto } from '@/lib/groups-lines';
import { FOLDERS_CHANGED, FolderSelect, LineBadge, LineSelector, MoveToFolderModal, notifyFoldersChanged, type LineOption } from './LineFolders';
import { useChatGestures, type SwipeActions } from '@/components/ui/chat-gestures';
import { ContextMenu, openInNewWindow, useRowContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { requestChatInfo } from '@/lib/chat-info-request';
import { dragIds } from '@/lib/chat-gestures';
import { flattenTree } from '@/lib/inbox/folder-tree';
import { useCollapsedBranch, useShellBranch } from '@/components/app/useShellBranch';
import PanelSplitters from './PanelSplitters';
import { useDetailsHidden } from './details-hidden';
import { fetchIfChanged, ListCache, reuseRows } from '@/lib/conditional-fetch';
import { useWaLive } from '@/lib/wa-live-client';
import { pushUrl, useShallowLinks } from '@/components/app/shallowNav';
import { useNearEnd } from '@/components/app/useNearEnd';
import DebouncedInput from '@/components/app/DebouncedInput';

/** El color de cada etiqueta (los de .gr-label-* en styles/groups.css), para el punto de la opción en el panel de filtros. */
const LABEL_HEX: Record<string, string> = {
  gray: 'var(--dim)',
  red: '#d93a40',
  orange: '#f2611d',
  yellow: '#e6b400',
  green: '#12a150',
  teal: '#00b8a9',
  blue: '#2f6bff',
  purple: '#7b4dff',
  pink: '#e23d7f',
};

/** El campo del panel que cada pestaña pone: su chip no se repite debajo de la búsqueda. */
const TAB_FIELD: Record<Exclude<LinesTab, 'all'>, string> = {
  unread: 'unread',
  groups: 'kind',
  unanswered: 'waiting',
  mine: 'assignee',
  unassigned: 'assignee',
  flagged: 'flagged',
  closed: 'status',
};

/** Texto con lo buscado en negrita (sin HTML). */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: ReactNode[] = [];
  let i = 0;
  const lower = text.toLowerCase();
  for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, i)) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<b key={at}>{text.slice(at, at + needle.length)}</b>);
    i = at + needle.length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

function readDraft(chatId: string): string {
  try {
    return window.sessionStorage.getItem(`gr-draft:${chatId}`) ?? '';
  } catch {
    return '';
  }
}
const STORE = 'zs-groups-inbox';
const NO_HS: HubspotPropFilter[] = [];
/** Chats por página de la lista (se piden más al llegar al final). */
const PAGE = 60;
/** Tope de filas que se refrescan de una vez (lo que la API devuelve como máximo). */
const MAX_HEAD = 1000;

interface ListData {
  rows: ChatDto[];
  next: string | null;
  /** Fijados que van adelante en la primera página (no cuentan para el tamaño de página). */
  pinned?: number;
  imports?: ImportStatus[];
  unreadChats?: number;
  archived?: { total: number; unread: number };
  dropped?: DroppedNumber[];
  hubspot?: boolean;
}
/** Una lista ya vista (por carpeta, línea, filtros y búsqueda): sus filas, el cursor para seguir y dónde quedó el scroll. */
interface CachedList {
  rows: ChatDto[];
  next: string | null;
  pinned: number;
  top: number;
}

interface InboxCtx {
  rows: ChatDto[];
  refresh: () => void;
}
const Ctx = createContext<InboxCtx>({ rows: [], refresh: () => {} });

interface DroppedNumber {
  id: string;
  name: string;
  phone: string;
  status: string;
  qr: boolean;
}
export const useGroupsInbox = () => useContext(Ctx);

/** Los filtros que quedaron puestos en esta pestaña del navegador (también los guardados con el formato anterior). */
function readSaved(): LinesFilters | null {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    return raw ? withoutSearch(linesFiltersFromParam(raw)) : null;
  } catch {
    return null;
  }
}

function chatIdFromPath(pathname: string): string | null {
  const m = /\/app\/lines\/inbox\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Bandeja de Groups: la lista con filtros y búsqueda (esta columna) y el
 * chat abierto (la página hija). Vive en el layout: la lista no se recarga
 * al cambiar de chat. Se refresca cada 5 s con la pestaña visible.
 * Las listas guardadas (?list=<id>) cargan sus filtros en los controles y se
 * guardan, renombran y borran desde acá. Teclado: J/K o flechas para
 * moverse, / para buscar, X marca el chat abierto para una acción en masa,
 * Esc limpia la selección.
 */
/** Query de la bandeja: la lista guardada y la carpeta abierta viajan al cambiar de chat. */
function inboxQuery(listId: string | null, folder: string): string {
  const p = new URLSearchParams();
  if (listId) p.set('list', listId);
  if (folder) p.set('folder', folder);
  const q = p.toString();
  return q ? `?${q}` : '';
}

const IMPORTS_CLOSED_KEY = 'zs-lines-imports-closed';
/** Una importación terminada: otra importación del mismo número (otros totales) vuelve a avisar. */
const importKey = (im: { numberId: string; chatsTotal: number; messages: number }) => `${im.numberId}:${im.chatsTotal}:${im.messages}`;

export default function InboxShell({
  labels,
  people = [],
  teams = [],
  properties = [],
  me = '',
  initialLists = [],
  numbers = [],
  initialLine = 'all',
  banner = null,
  children,
}: {
  labels: LabelDto[];
  people?: GroupsPerson[];
  teams?: Array<{ id: string; name: string }>;
  properties?: PropertyDef[];
  me?: string;
  initialLists?: SavedListDto[];
  /** Líneas que esta persona ve (visibilidad por línea). */
  numbers?: LineOption[];
  /** Línea elegida la última vez ('all' = todas). */
  initialLine?: string;
  /** Aviso arriba de la lista (datos de ejemplo). */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('groups');
  const tf = useTranslations('common.ui.filter');
  const { style: chatStyle } = useChatStyle();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const rel = useRelativeTime();
  const mediaText = useMediaText();
  const locale = useLocale();
  const [imports, setImports] = useState<ImportStatus[]>([]);
  const [archivedView, setArchivedView] = useState(false);
  const [archivedInfo, setArchivedInfo] = useState({ total: 0, unread: 0 });
  const [dropped, setDropped] = useState<DroppedNumber[]>([]);
  const [hiding, setHiding] = useState<ChatDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name || p.email])), [people]);
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const listId = params.get('list');
  const current = chatIdFromPath(pathname);
  const switchingTo = useSwitchingTo();
  const [line, setLine] = useState(numbers.some((n) => n.id === initialLine) ? initialLine : 'all');
  // La carpeta abierta vive en la URL (?folder=): la eligen el sidebar o el selector de la bandeja.
  const folderSel = params.get('folder') ?? '';
  const sideBranch = useShellBranch();
  // Con el sidebar colapsado las carpetas van como íconos en el lateral (GroupsFoldersBranch).
  const railBranch = useCollapsedBranch();
  const [folderData, setFolderData] = useState<{ folders: LineFolderDto[]; unfiled: { unread: number; chats: number } }>({ folders: [], unfiled: { unread: 0, chats: 0 } });
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const lineNames = useMemo(() => new Map(numbers.map((n) => [n.id, n.name])), [numbers]);
  // Los filtros de la lista (pestañas y panel) y, aparte, lo escrito en la búsqueda.
  const [filters, setFilters] = useState<LinesFilters>({});
  const [q, setQ] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  // El campo con el que se abre el panel (al tocar un chip).
  const [panelField, setPanelField] = useState<string | null>(null);
  const filterBtn = useRef<HTMLButtonElement>(null);
  const searchRow = useRef<HTMLDivElement>(null);
  // HubSpot conectado en el workspace: la bandeja ofrece el filtro de vinculados.
  const [hubspotOn, setHubspotOn] = useState(false);
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<ChatDto[]>([]);
  // Las filas a la vista, para los gestos (deslizar, arrastrar) que corren fuera del render.
  const rowsRef = useRef<ChatDto[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const [next, setNext] = useState<string | null>(null);
  // De qué lista son las filas en pantalla: al cambiar de carpeta o filtro quedan las anteriores (atenuadas) hasta que llegan las nuevas.
  const [shownKey, setShownKey] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [lists, setLists] = useState<SavedListDto[]>(initialLists);
  const [saving, setSaving] = useState<'new' | 'rename' | null>(null);
  const { hidden: detailsHidden } = useDetailsHidden();
  // "Importación terminada" se puede cerrar y queda cerrado (por navegador) hasta la próxima importación.
  const [importsClosed, setImportsClosed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(IMPORTS_CLOSED_KEY) ?? '[]') as unknown;
      if (Array.isArray(raw)) setImportsClosed(raw.filter((x): x is string => typeof x === 'string').slice(-50));
    } catch {
      /* sin almacenamiento: vale para esta vista */
    }
  }, []);
  // Una línea que se reconecta saca su aviso cerrado de la lista: si se vuelve a caer, avisa de nuevo.
  useEffect(() => {
    if (!loaded) return;
    const down = new Set(dropped.map((n) => `drop:${n.id}`));
    setImportsClosed((cur) => {
      const next = cur.filter((k) => !k.startsWith('drop:') || down.has(k));
      if (next.length === cur.length) return cur;
      try {
        window.localStorage.setItem(IMPORTS_CLOSED_KEY, JSON.stringify(next));
      } catch {
        /* vale para esta vista */
      }
      return next;
    });
  }, [dropped, loaded]);
  const closeImport = (key: string) => {
    const next = [...importsClosed.filter((k) => k !== key), key].slice(-50);
    setImportsClosed(next);
    try {
      window.localStorage.setItem(IMPORTS_CLOSED_KEY, JSON.stringify(next));
    } catch {
      /* igual queda cerrado en esta vista */
    }
  };
  const [removing, setRemoving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const moreRef = useRef<HTMLLIElement>(null);
  const listCache = useRef(new ListCache<CachedList>(30)).current;
  const live = useRef({ want: '', shown: '', rows: [] as ChatDto[], next: null as string | null, pinned: 0, kept: 0, etag: '', etagUrl: '', more: false, unreadOnly: false, current: null as string | null });
  const listAbort = useRef<AbortController | null>(null);
  const moreAbort = useRef<AbortController | null>(null);
  const activeList = lists.find((l) => l.id === listId) ?? null;

  useEffect(() => {
    void api<{ me: boolean }>('/api/groups/availability').then((r) => setAvailable(r.data ? r.data.me : true));
    if (listId) return;
    const saved = readSaved();
    if (saved) {
      setFilters(saved);
      // Con líneas elegidas en los filtros, el selector de línea no las recorta.
      if (saved.lines?.length) setLine('all');
    }
    // Solo al entrar: una lista abierta manda sobre lo guardado en la pestaña.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Abrir una lista carga sus filtros (también al volver a la misma desde el sidebar).
  useEffect(() => {
    if (!activeList) return;
    const f = parseLinesFilters(activeList.filters);
    setFilters(withoutSearch(f));
    setQ(f.q ?? '');
    setDebounced(f.q ?? '');
    // Una lista con líneas elegidas se ve entera: el selector de línea no la recorta.
    if (f.lines?.length) setLine('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeList?.id, activeList?.updatedAt]);
  const filtersKey = serializeLinesFilters(filters);
  useEffect(() => {
    if (listId) return;
    try {
      window.sessionStorage.setItem(STORE, filtersKey || '{}');
    } catch {
      // Sin storage: los filtros duran lo que dura la página.
    }
  }, [filtersKey, listId]);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const reloadLists = useCallback(async () => {
    const r = await api<{ lists: SavedListDto[] }>('/api/groups/lists');
    if (r.data) setLists(r.data.lists);
  }, []);
  useEffect(() => {
    void reloadLists();
    window.addEventListener(LISTS_CHANGED, reloadLists);
    return () => window.removeEventListener(LISTS_CHANGED, reloadLists);
  }, [reloadLists, pathname]);

  // La lista: una entrada de caché por carpeta, línea, filtros y búsqueda; páginas con cursor; pedidos que se cortan.
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filtersKey) p.set('f', filtersKey);
    // "Hoy" y "esta semana" empiezan a la medianoche de quien mira.
    if (filters.lastMessage || filters.created) p.set('tz', String(-new Date().getTimezoneOffset()));
    if (archivedView) p.set('archived', '1');
    if (line !== 'all') p.set('number', line);
    if (folderSel) p.set('folder', folderSel);
    if (debounced) p.set('q', debounced);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, debounced, archivedView, line, folderSel]);
  live.current.unreadOnly = filters.unread === 'yes';
  live.current.current = current;
  const switching = loaded && shownKey !== query;

  const showRows = useCallback((key: string, list: ChatDto[], cursor: string | null, pinned?: number) => {
    const L = live.current;
    L.shown = key;
    L.rows = list;
    L.next = cursor;
    if (pinned !== undefined) L.pinned = pinned;
    setRows(list);
    setNext(cursor);
    setShownKey(key);
  }, []);

  /**
   * Trae el principio de la lista pedida. Si es la que está en pantalla, refresca lo ya cargado (con ETag: sin
   * cambios no toca nada); si es otra, la pone en pantalla cuando llega. Un pedido anterior en curso se corta,
   * así una respuesta vieja nunca pisa a una nueva.
   */
  const load = useCallback(
    async (silent: boolean) => {
      const L = live.current;
      const key = L.want;
      // Lo que cuenta para el tamaño de página: sin los fijados de adelante ni el chat abierto que se mantiene en "no leídos".
      const size = L.shown === key ? Math.min(Math.max(L.rows.length - L.pinned - L.kept, PAGE), MAX_HEAD) : PAGE;
      const url = `/api/groups/chats?${key}&cursor=&limit=${size}`;
      listAbort.current?.abort();
      const ctrl = new AbortController();
      listAbort.current = ctrl;
      if (!silent) setError(false);
      const r = await fetchIfChanged<ListData>(url, L.etagUrl === url ? L.etag : null, ctrl.signal);
      if (r.state === 'aborted' || live.current.want !== key) return;
      setLoaded(true);
      if (r.state === 'error') {
        // No llegó la lista pedida: no quedan a la vista las filas de la anterior (se ve el error con "Reintentar").
        if (L.shown !== key) {
          showRows(key, [], null, 0);
          setError(true);
        } else if (!silent) setError(true);
        return;
      }
      setError(false);
      if (r.state === 'same') return;
      L.etag = r.etag;
      L.etagUrl = url;
      const data = r.data;
      const prev = L.shown === key ? L.rows : [];
      // En "no leídos", el chat abierto sigue en la lista aunque ya se haya leído.
      let kept = 0;
      if (L.unreadOnly && L.shown === key && L.current && !data.rows.some((x) => x.id === L.current)) {
        const prevIdx = prev.findIndex((x) => x.id === L.current);
        if (prevIdx >= 0) {
          data.rows.splice(Math.min(prevIdx, data.rows.length), 0, { ...prev[prevIdx], unread: 0, markedUnread: false });
          kept = 1;
        }
      }
      L.kept = kept;
      // Si hay más filas cargadas que las que cubre esta respuesta (se bajó más mientras llegaba, o pasan el tope),
      // las del fondo quedan como estaban y el cursor sigue siendo el de ellas.
      const ids = new Set(data.rows.map((x) => x.id));
      const covered = size + (data.pinned ?? 0) + kept;
      const tail = data.next !== null && prev.length > covered ? prev.slice(covered).filter((x) => !ids.has(x.id)) : [];
      showRows(key, reuseRows(prev, tail.length ? [...data.rows, ...tail] : data.rows), tail.length ? L.next : data.next, data.pinned ?? 0);
      setImports((cur) => (JSON.stringify(cur) === JSON.stringify(data.imports ?? []) ? cur : (data.imports ?? [])));
      if (data.archived) setArchivedInfo((cur) => (cur.total === data.archived!.total && cur.unread === data.archived!.unread ? cur : data.archived!));
      setDropped((cur) => (JSON.stringify(cur) === JSON.stringify(data.dropped ?? []) ? cur : (data.dropped ?? [])));
      setHubspotOn(data.hubspot === true);
      if (typeof data.unreadChats === 'number') setUnreadTotal(data.unreadChats);
    },
    [showRows],
  );

  /** La página que sigue (al llegar al final de la lista): así se recorre toda la historia. */
  const loadMore = useCallback(async () => {
    const L = live.current;
    if (!L.next || L.more || L.shown !== L.want) return;
    L.more = true;
    setLoadingMore(true);
    const key = L.shown;
    const ctrl = new AbortController();
    moreAbort.current = ctrl;
    const r = await fetchIfChanged<ListData>(`/api/groups/chats?${key}&cursor=${encodeURIComponent(L.next)}&limit=${PAGE}&meta=0`, null, ctrl.signal);
    L.more = false;
    setLoadingMore(false);
    if (r.state !== 'fresh' || live.current.shown !== key || live.current.want !== key) return;
    const have = new Set(L.rows.map((x) => x.id));
    showRows(key, [...L.rows, ...r.data.rows.filter((x) => !have.has(x.id))], r.data.next);
  }, [showRows]);

  // Las filas en pantalla quedan en la caché de su lista.
  useEffect(() => {
    const L = live.current;
    if (!L.shown) return;
    L.rows = rows;
    listCache.set(L.shown, { rows, next: L.next, pinned: L.pinned, top: listCache.get(L.shown)?.top ?? 0 });
  }, [rows, next, shownKey, listCache]);

  // Otra carpeta, línea, filtro o búsqueda: si ya se vio, aparece al instante (con su scroll) y se revalida; si
  // no, quedan las filas anteriores atenuadas hasta que llega la nueva. Lo pedido para la lista anterior se corta.
  useEffect(() => {
    const L = live.current;
    const left = L.shown ? listCache.get(L.shown) : undefined;
    if (left) left.top = rowsBox.current?.scrollTop ?? 0;
    L.want = query;
    moreAbort.current?.abort();
    const hit = listCache.get(query);
    if (hit && L.shown !== query) {
      showRows(query, hit.rows, hit.next, hit.pinned);
      requestAnimationFrame(() => {
        if (rowsBox.current && live.current.shown === query) rowsBox.current.scrollTop = hit.top;
      });
    }
    void load(false).then(() => {
      if (!hit && live.current.shown === query && rowsBox.current) rowsBox.current.scrollTop = 0;
    });
  }, [query, listCache, load, showRows]);
  // Otro chat abierto: la lista se pone al día (el que se abrió queda leído).
  const lastCurrent = useRef(current);
  useEffect(() => {
    if (lastCurrent.current === current) return;
    lastCurrent.current = current;
    void load(true);
  }, [current, load]);
  // Al llegar al final de la lista se pide la página que sigue.
  const nearEnd = useCallback(() => void loadMore(), [loadMore]);
  useNearEnd(moreRef, !!next && !switching, nearEnd, rows.length);
  // Al instante: un mensaje nuevo (también el que saca un chat de Archivados), archivar desde el teléfono, lo que hace
  // otra persona. Una consulta por índice cada 3 s (lib/wa-live.ts) reemplaza releer la lista cada 5 s: se relee solo
  // cuando algo cambió.
  const { live: liveOn } = useWaLive('groups', () => void load(true));
  useEffect(() => {
    // Red de seguridad (escribiendo…, importaciones, líneas caídas): cada 5 s si el aviso no anda, cada minuto si anda.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, liveOn ? 60_000 : 5000);
    // Al volver a la pestaña (o a la ventana), al día en el acto: sin esperar al próximo intervalo.
    // visibilitychange y focus llegan juntos al volver: una sola carga.
    let lastBack = 0;
    const onBack = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastBack < 1000) return;
      lastBack = Date.now();
      void load(true);
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [load, liveOn]);


  // Carpeta, lista guardada y "todos los chats" viven en la URL (?folder=, ?list=). Cambiarlas no pasa por el
  // servidor: la URL cambia con pushState (atrás y adelante funcionan) y solo se vuelve a pedir la lista. El chat
  // abierto y lo escrito en el composer quedan como están. Un link a la bandeja con ?list= o ?folder= (el sidebar)
  // se aplica sobre el chat abierto.
  useShallowLinks((url) => {
    const here = window.location.pathname;
    if (url.pathname === here) return `${here}${url.search}`;
    const root = /^(.*\/app\/lines\/inbox)(?:\/[^/]+)?$/.exec(here)?.[1];
    if (root && url.pathname === root && (url.searchParams.has('list') || url.searchParams.has('folder'))) return `${here}${url.search}`;
    return null;
  });

  const foldersEtag = useRef('');
  const reloadFolders = useCallback(async () => {
    const r = await fetchIfChanged<{ folders: LineFolderDto[]; unfiled: { unread: number; chats: number } }>('/api/groups/folders', foldersEtag.current);
    if (r.state !== 'fresh') return;
    foldersEtag.current = r.etag;
    setFolderData(r.data);
  }, []);
  useEffect(() => {
    void reloadFolders();
    // Los nombres de las carpetas cambian poco: cada 30 s (y al momento con FOLDERS_CHANGED), con ETag.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadFolders();
    }, 30000);
    return () => clearInterval(id);
  }, [reloadFolders]);

  function pickLine(v: string) {
    setLine(v);
    // Una línea elegida acá reemplaza a las del panel de filtros: no quedan dos elecciones de línea a la vez.
    if (v !== 'all') setFilters((f) => (f.lines ? parseLinesFilters({ ...f, lines: [] }) : f));
    void api('/api/groups/prefs', { method: 'PUT', body: { line: v } });
  }

  /** Mueve chats a una carpeta (o los saca, con null). El aviso dice a dónde fueron y deja deshacer: cada chat vuelve a la carpeta donde estaba. */
  async function moveToFolder(ids: string[], folderId: string | null) {
    const before = new Map<string | null, string[]>();
    for (const id of ids) {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row || row.folderId === folderId) continue;
      before.set(row.folderId, [...(before.get(row.folderId) ?? []), id]);
    }
    const res = await api<{ updated: number; failed: number }>('/api/groups/chats/bulk', { body: { ids, action: 'folder', folderId } });
    if (!res.data) return showToast(errText(res.error), true);
    const name = folderId ? (folderData.folders.find((f) => f.id === folderId)?.name ?? '') : '';
    const after = () => {
      void load(true);
      notifyFoldersChanged();
    };
    const undo = async () => {
      for (const [prev, list] of before) await api('/api/groups/chats/bulk', { body: { ids: list, action: 'folder', folderId: prev } });
      after();
    };
    showToast(
      folderId ? t('lines.movedTo', { n: res.data.updated, name }) : t('lines.removedFromFolder', { n: res.data.updated }),
      res.data.failed > 0,
      before.size > 0 && res.data.updated > 0 ? { label: t('swipe.undo'), onClick: () => void undo() } : undefined,
    );
    setSelected(new Set());
    after();
  }
  useEffect(() => {
    const changed = () => {
      void reloadFolders();
      void load(true);
    };
    window.addEventListener(FOLDERS_CHANGED, changed);
    return () => window.removeEventListener(FOLDERS_CHANGED, changed);
  }, [reloadFolders, load]);
  const pickFolder = (id: string) => pushUrl(`${window.location.pathname}${inboxQuery(listId, id)}`);
  const folderName = folderSel === 'none' ? t('lines.unfiled') : (folderData.folders.find((f) => f.id === folderSel)?.name ?? '');

  const refresh = useCallback(() => void load(true), [load]);

  const go = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === current);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
      if (next) {
        markChatSwitch(next.id);
        router.push(`/app/lines/inbox/${next.id}${inboxQuery(listId, folderSel)}`);
      }
    },
    [rows, current, router, listId, folderSel],
  );
  useKeyShortcut('/', () => searchRef.current?.focus());
  useKeyShortcut('j', () => go(1));
  useKeyShortcut('k', () => go(-1));
  useKeyShortcut('x', () => {
    if (current) toggleSelect(current);
  });
  useKeyShortcut('escape', () => {
    setSelected(new Set());
    setSelectMode(false);
  }, selected.size > 0 || selectMode);

  // Lo seleccionado que ya no está en la lista (otro filtro) no cuenta.
  const visibleSelected = useMemo(() => rows.filter((r) => selected.has(r.id)).map((r) => r.id), [rows, selected]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(action: string, assignedTo?: string | null) {
    if (visibleSelected.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    const res = await api<{ updated: number; failed: number }>('/api/groups/chats/bulk', {
      body: { ids: visibleSelected, action, ...(action === 'assign' ? { assignedTo: assignedTo || null } : {}) },
    });
    setBulkBusy(false);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    showToast(t('bulkInbox.done', { n: res.data.updated }), res.data.failed > 0);
    setSelected(new Set());
    void load(true);
  }

  async function toggleAvailable() {
    const next = !(available ?? true);
    setAvailable(next);
    const res = await api('/api/groups/availability', { method: 'PUT', body: { available: next } });
    if (!res.data) {
      setAvailable(!next);
      showToast(errText(res.error), true);
    } else void load(true);
  }

  const value = useMemo(() => ({ rows, refresh }), [rows, refresh]);
  const unreadChats = unreadTotal ?? rows.filter((r) => r.unread > 0 && !r.muted).length;
  useEffect(() => {
    const prev = document.title;
    document.title = `${unreadChats ? `(${unreadChats}) ` : ''}${activeList ? activeList.name : t('inbox.title')} · Lines`;
    return () => {
      document.title = prev;
    };
  }, [unreadChats, activeList, t]);

  async function rowAction(c: ChatDto, body: Record<string, unknown>) {
    const res = await api(`/api/groups/chats/${c.id}`, { method: 'PATCH', body });
    if (!res.data) showToast(errText(res.error), true);
    void load(true);
  }

  /** El chat coincide por nombre o teléfono (va en "Chats"; lo que coincide en mensajes va en "Mensajes"). */
  function nameHit(c: ChatDto): boolean {
    const q = debounced.trim().toLowerCase();
    const digits = q.replace(/[^\d]/g, '');
    return !c.match || c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone.includes(digits));
  }

  /** Archivar o desarchivar, con deshacer en el aviso. */
  function toggleArchived(c: ChatDto) {
    void rowAction(c, { archived: !c.archived }).then(() =>
      showToast(c.archived ? t('wa.unarchived') : t('wa.archived'), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { archived: c.archived }) }),
    );
  }

  function rowMenu(c: ChatDto): MenuItem[] {
    return [
      { key: 'archive', label: c.archived ? t('wa.unarchive') : t('wa.archive'), onSelect: () => toggleArchived(c) },
      { key: 'close', label: c.status === 'open' ? t('wa.closeChat') : t('thread.reopen'), onSelect: () => void rowAction(c, { status: c.status === 'open' ? 'closed' : 'open' }) },
      { key: 'mute', label: c.muted ? t('wa.unmute') : t('wa.mute'), onSelect: () => void rowAction(c, { muted: !c.muted }) },
      { key: 'pin', label: c.pinned ? t('thread.unpinChat') : t('thread.pinChat'), onSelect: () => void rowAction(c, { pinned: !c.pinned }) },
      { key: 'unread', label: c.unread > 0 ? t('thread.markRead') : t('thread.markUnread'), onSelect: () => void rowAction(c, { read: c.unread > 0 }) },
      { key: 'assign', label: c.assignedTo === me ? t('wa.unassignMe') : t('wa.assignMe'), onSelect: () => void rowAction(c, { assignedTo: c.assignedTo === me ? null : me }) },
      { key: 'folder', label: t('lines.moveToFolder'), onSelect: () => setMoveIds([c.id]) },
      { key: 'hide', label: t('wa.deleteChat'), danger: true, divider: true, onSelect: () => setHiding(c) },
    ];
  }

  /**
   * Clic derecho sobre un chat (o la tecla de menú), como WhatsApp: en el
   * puntero, las mismas acciones del menú de la fila, más abrir en otra
   * ventana, la info del contacto o del grupo y exportar.
   */
  const ctxMenu = useRowContextMenu();
  function ctxItems(id: string): ContextMenuItem[] {
    const c = rowsRef.current.find((r) => r.id === id);
    if (!c) return [];
    const by = Object.fromEntries(rowMenu(c).map((it) => [it.key, it]));
    const from = (key: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem[] => (by[key] ? [{ key, label: by[key].label, danger: by[key].danger, onSelect: by[key].onSelect, ...extra }] : []);
    return [
      { key: 'newWindow', label: t('wa.openNewWindow'), onSelect: () => openInNewWindow(`${window.location.pathname.replace(/\/app\/lines\/inbox.*$/, '')}/app/lines/inbox/${c.id}${listSuffix}`) },
      ...from('unread'),
      ...from('archive'),
      ...from('pin'),
      ...from('mute'),
      ...from('close'),
      ...from('assign'),
      ...from('folder'),
      {
        key: 'info',
        label: c.kind === 'group' ? t('wa.groupInfo') : t('wa.contactInfo'),
        divider: true,
        onSelect: () => {
          requestChatInfo(c.id);
          if (current !== c.id) router.push(`/app/lines/inbox/${c.id}${listSuffix}`);
        },
      },
      { key: 'export', label: t('wa.exportChat'), onSelect: () => window.location.assign(`/api/groups/export?type=messages&chat=${encodeURIComponent(c.id)}`) },
      ...from('hide', { divider: true }),
    ];
  }

  /**
   * Deslizar una fila, como WhatsApp: a la derecha, leído o no leído (la
   * principal) y fijar; a la izquierda, archivar (la principal) y más (el menú
   * de la fila). Con chats seleccionados no se desliza.
   */
  function swipeActions(id: string): SwipeActions | null {
    const c = rowsRef.current.find((r) => r.id === id);
    if (!c || selectMode || visibleSelected.length > 0) return null;
    return {
      right: [
        { key: 'unread', label: c.unread > 0 ? t('swipe.read') : t('swipe.unread'), icon: c.unread > 0 ? 'read' : 'unread', onSelect: () => void rowAction(c, { read: c.unread > 0 }) },
        { key: 'pin', label: c.pinned ? t('swipe.unpin') : t('swipe.pin'), icon: c.pinned ? 'unpin' : 'pin', onSelect: () => void rowAction(c, { pinned: !c.pinned }) },
      ],
      left: [
        { key: 'archive', label: c.archived ? t('swipe.unarchive') : t('swipe.archive'), icon: c.archived ? 'unarchive' : 'archive', leaves: true, onSelect: () => toggleArchived(c) },
        { key: 'more', label: t('swipe.more'), icon: 'more', onSelect: () => openRowMenu(id, 220) },
      ],
    };
  }
  // Desde el deslizado, el menú espera a que la fila vuelva a su lugar.
  const openRowMenu = (id: string, wait = 0) =>
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-chat-row="${CSS.escape(id)}"] .wa-row-chevron`)?.click(), wait);
  const gestures = useChatGestures({
    scope: 'lines',
    actionsFor: swipeActions,
    // Levantar un chat seleccionado lleva la selección entera.
    idsFor: (id) => dragIds(id, selected, rows.map((r) => r.id)),
    chipFor: (id, ids) => {
      const c = rowsRef.current.find((r) => r.id === id);
      if (ids.length > 1 || !c) return { label: t('swipe.dragMany', { n: ids.length }) };
      return { label: c.name, avatar: <Avatar name={c.name} kind={c.kind} src={c.pictureUrl} seed={c.id} size={24} /> };
    },
    canDrop: (ids, target) => {
      const to = target === 'none' ? null : target;
      return ids.some((id) => (rowsRef.current.find((r) => r.id === id)?.folderId ?? null) !== to);
    },
    onDrop: (ids, target) => void moveToFolder(ids, target === 'none' ? null : target),
    onHoldTap: (id) => {
      if (!selectMode && visibleSelected.length === 0) openRowMenu(id);
    },
    tray: {
      title: t('swipe.dropTitle'),
      empty: t('swipe.dropEmpty'),
      items: folderData.folders.length
        ? [...flattenTree(folderData.folders).map(({ folder: f, depth }) => ({ id: f.id, name: f.name, depth })), { id: 'none', name: t('lines.unfiled'), depth: 0 }]
        : [],
    },
  });

  /** Una fila de la lista (también en los resultados de búsqueda). */
  function renderRow(c: ChatDto, opts: { snippet?: boolean } = {}) {
    // El chat que se deja muestra su borrador ya, desde el clic (sin esperar a que el otro termine de abrir).
    const draft = c.id !== (switchingTo ?? current) ? readDraft(c.id) : '';
    const showCheck = selectMode || visibleSelected.length > 0;
    return (
      <li
        key={`${opts.snippet ? 'm' : 'c'}-${c.id}`}
        className={`gr-row-item${c.muted ? ' is-muted' : ''}`}
        {...gestures.rowProps(c.id)}
        {...ctxMenu.handlers(c.id, t('wa.chatOptions', { name: c.name }), !showCheck)}
      >
        {gestures.actions(c.id)}
        {showCheck && (
          <input type="checkbox" className="gr-row-check" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label={t('bulkInbox.select', { name: c.name })} />
        )}
        <Link
          href={`/app/lines/inbox/${c.id}${listSuffix}`}
          onClick={(e) => {
            if (showCheck) {
              e.preventDefault();
              toggleSelect(c.id);
              return;
            }
            // Abrir en otra pestaña no cambia el chat de esta.
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
              // Volver al chat abierto mientras se abría otro cancela ese cambio.
              if (c.id !== current) markChatSwitch(c.id);
              else if (switchingTo) markChatSwitch(null);
            }
          }}
          className={`gr-row${c.id === current ? ' is-active' : ''}${c.unread > 0 ? ' is-unread' : ''}`}
          aria-current={c.id === current ? 'page' : undefined}
          draggable={false}
        >
          <Avatar name={c.name} kind={c.kind} src={c.pictureUrl} seed={c.id} />
          <span className="gr-row-main">
            <span className="gr-row-top">
              <span className="gr-row-name">{debounced && !opts.snippet ? <Highlight text={c.name} q={debounced} /> : c.name}</span>
              <span className={`gr-row-time${c.unread > 0 ? ' is-unread' : ''}`}>{listTime(c.lastMessageAt ?? c.createdAt, locale)}</span>
            </span>
            <span className="gr-row-bottom">
              <span className="gr-row-preview">
                {opts.snippet && c.match ? (
                  <span>
                    <Highlight text={c.match} q={debounced} />
                  </span>
                ) : draft ? (
                  <>
                    <span className="gr-row-draft">{t('wa.draft')}</span>
                    <span>{draft}</span>
                  </>
                ) : c.presence && c.presence.state !== 'available' ? (
                  <span className="gr-row-typing">
                    {c.kind === 'group' && c.presence.name
                      ? t(c.presence.state === 'recording' ? 'wa.recordingBy' : 'wa.typingBy', { name: c.presence.name })
                      : t(c.presence.state === 'recording' ? 'wa.recordingAudio' : 'wa.typing')}
                  </span>
                ) : c.lastKind === 'deleted' || c.lastMessagePreview === '[deleted]' ? (
                  <span className="gr-row-deleted">
                    <Ban size={14} /> {c.lastDirection === 'out' ? t('wa.youDeleted') : t('wa.deletedMessage')}
                  </span>
                ) : (
                  <>
                    {c.lastDirection === 'out' && c.lastStatus && c.lastStatus !== 'received' && <Ticks status={c.lastStatus} label={t(`status.${c.lastStatus}`)} />}
                    {c.kind === 'group' && c.lastDirection === 'in' && c.lastSender && <span className="gr-row-sender">{c.lastSender}:</span>}
                    {c.lastKind === 'voice' || c.lastMessagePreview === '[voice]' ? (
                      <span className="gr-row-voice">
                        <Mic size={15} /> {c.lastDuration ? duration(c.lastDuration) : t('media.audio')}
                      </span>
                    ) : (
                      <span>{plainWa(mediaText({ preview: c.lastMessagePreview }))}</span>
                    )}
                  </>
                )}
              </span>
              <span className="gr-row-icons">
                {c.muted && <MuteIcon size={16} label={t('wa.muted')} />}
                {c.unread > 0 &&
                  (c.markedUnread && c.unread <= 1 ? (
                    <span className="gr-unread is-dot" role="img" aria-label={t('wa.markedUnread')} />
                  ) : (
                    <span className="gr-unread" aria-label={t('inbox.unread', { n: c.unread })}>
                      {c.unread > 999 ? '999+' : c.unread}
                    </span>
                  ))}
                {c.pinned && <PinIcon size={16} className="gr-pin-icon" label={t('inbox.pinned')} />}
              </span>
            </span>
            {(c.flagged || c.awaitingSince || c.labels.length > 0 || c.assignedTo || c.hubspotName || (line === 'all' && numbers.length > 1)) && (
              <span className="gr-row-meta">
                {line === 'all' && numbers.length > 1 && lineNames.get(c.numberId) && <LineBadge name={lineNames.get(c.numberId) as string} />}
                {c.flagged ? (
                  <span className="badge badge-bad">{t('inbox.flagged')}</span>
                ) : c.awaitingSince ? (
                  <span className="badge badge-warn">{t('inbox.waiting', { time: rel(c.awaitingSince) })}</span>
                ) : null}
                {c.labels.slice(0, 2).map((l) => (
                  <LabelTag key={l.id} name={l.name} color={l.color} />
                ))}
                {c.hubspotName && (
                  <span className="gr-line-badge gr-row-hubspot" title={t('hubspot.rowLabel', { name: c.hubspotName })}>
                    {c.hubspotName}
                  </span>
                )}
                {c.assignedTo && <span className="gr-row-assignee">{peopleById.get(c.assignedTo) ?? ''}</span>}
              </span>
            )}
          </span>
        </Link>
        {!showCheck && (
          <span className="gr-row-menu" data-no-gesture>
            <MessageMenu label={t('wa.chatOptions', { name: c.name })} items={rowMenu(c)} trigger={<Chevron size={20} />} className="wa-row-chevron" align="right" />
          </span>
        )}
      </li>
    );
  }
  // Fila "Archivados" arriba de la lista (como WhatsApp), solo en la vista común.
  const archivedRow =
    !archivedView && !debounced && !activeList && isEmptyFilters(filters) && archivedInfo.total > 0 ? (
      <button type="button" className="wa-archived-row" onClick={() => setArchivedView(true)}>
        <span className="wa-archived-icon">
          <ArchiveIcon size={20} />
        </span>
        <span className="wa-archived-label">{t('wa.archivedTitle')}</span>
        {archivedInfo.unread > 0 && <span className="wa-archived-count">{archivedInfo.unread}</span>}
      </button>
    ) : null;
  // Lo que guarda una lista: los filtros puestos más la búsqueda.
  const listFilters: SavedListFilters = parseLinesFilters({ ...filters, q: debounced });
  const dirty = activeList ? serializeLinesFilters(listFilters) !== serializeLinesFilters(activeList.filters) : false;
  const canEditList = activeList ? activeList.ownerId === me || activeList.shared : false;
  const listSuffix = inboxQuery(listId, folderSel);

  // ---------- Filtros: pestañas (atajos) y panel ----------
  const tabsOn = activeTabs(filters);
  const onlyClosed = filters.status?.length === 1 && filters.status[0] === 'closed';
  const propKinds = useMemo<PropKinds>(() => Object.fromEntries(properties.map((d) => [d.key, filterOptions(d).length > 0 ? 'multi' : 'text'])), [properties]);
  const categories = useMemo<FilterCategory[]>(
    () => (['status', 'assignment', 'dates', 'channel', 'labels', 'links'] as const).map((id) => ({ id, label: t(`fp.cats.${id}`) })),
    [t],
  );
  // Los campos del panel salen de lo que la página ya cargó para esta persona (sus líneas, sus etiquetas, la gente del workspace): no se pide nada más.
  const fields = useMemo<FilterField[]>(() => {
    const meName = people.find((p) => p.id === me)?.name ?? '';
    const person = (p: GroupsPerson): FilterOption => ({ id: p.id, label: p.name || p.email, hint: p.name ? p.email : undefined, avatar: true });
    const out: FilterField[] = [
      {
        id: 'status',
        type: 'multi',
        category: 'status',
        label: t('fp.status'),
        help: t('fp.help.status'),
        keywords: t('fp.kw.status'),
        options: [
          { id: 'open', label: t('fp.statusOpen') },
          { id: 'closed', label: t('fp.statusClosed') },
        ],
      },
      { id: 'unread', type: 'bool', category: 'status', label: t('fp.unread'), keywords: t('fp.kw.unread') },
      { id: 'waiting', type: 'bool', category: 'status', label: t('fp.waiting'), help: t('fp.help.waiting'), keywords: t('fp.kw.waiting') },
      { id: 'flagged', type: 'bool', category: 'status', label: t('fp.flagged'), help: t('fp.help.flagged'), keywords: t('fp.kw.flagged') },
      { id: 'pinned', type: 'bool', category: 'status', label: t('fp.pinned'), keywords: t('fp.kw.pinned') },
      { id: 'muted', type: 'bool', category: 'status', label: t('fp.muted'), keywords: t('fp.kw.muted') },
      {
        id: 'assignee',
        type: 'multi',
        category: 'assignment',
        label: t('fp.assignee'),
        keywords: t('fp.kw.assignee'),
        options: [
          { id: ME, label: meName ? t('fp.meNamed', { name: meName }) : t('fp.me'), avatar: meName || true },
          { id: NONE, label: t('fp.unassigned'), special: true },
          ...people.filter((p) => p.id !== me).map(person),
        ],
      },
    ];
    if (teams.length > 0 || filters.teams?.length) {
      out.push({
        id: 'team',
        type: 'multi',
        category: 'assignment',
        label: t('fp.team'),
        keywords: t('fp.kw.team'),
        options: [{ id: NONE, label: t('fp.noTeam'), special: true }, ...teams.map((tm) => ({ id: tm.id, label: tm.name }))],
      });
    }
    out.push(
      { id: 'lastMessage', type: 'date', category: 'dates', label: t('fp.lastMessage'), keywords: t('fp.kw.lastMessage') },
      { id: 'created', type: 'date', category: 'dates', label: t('fp.created'), help: t('fp.help.created'), keywords: t('fp.kw.created') },
    );
    if (numbers.length > 1 || filters.lines?.length) {
      out.push({
        id: 'lines',
        type: 'multi',
        category: 'channel',
        label: t('fp.lines'),
        keywords: t('fp.kw.lines'),
        options: numbers.map((n) => ({ id: n.id, label: n.name, hint: n.ownerName || undefined })),
      });
    }
    out.push(
      {
        id: 'kind',
        type: 'multi',
        category: 'channel',
        label: t('fp.kind'),
        keywords: t('fp.kw.kind'),
        options: [
          { id: 'dm', label: t('fp.kindDm') },
          { id: 'group', label: t('fp.kindGroup') },
        ],
      },
      {
        id: 'labels',
        type: 'multi',
        category: 'labels',
        label: t('fp.labels'),
        keywords: t('fp.kw.labels'),
        options: [{ id: NONE, label: t('fp.noLabel'), special: true }, ...labels.map((l) => ({ id: l.id, label: l.name, color: LABEL_HEX[l.color] ?? LABEL_HEX.gray }))],
      },
    );
    for (const d of properties) {
      const opts = filterOptions(d);
      if (opts.length > 0) {
        out.push({
          id: propFieldId(d.key),
          type: 'multi',
          category: 'labels',
          label: d.label,
          options: [
            { id: PROP_SET, label: t('fp.propSet'), special: true },
            { id: PROP_UNSET, label: t('fp.propUnset'), special: true },
            ...opts.map((o) => ({ id: o, label: o === 'true' && d.type === 'checkbox' ? t('fp.propYes') : o })),
          ],
        });
      } else out.push({ id: propFieldId(d.key), type: 'text', category: 'labels', label: d.label });
    }
    // Una lista guardada puede filtrar por una propiedad que ya se borró: se ve (y se puede sacar) con su clave.
    for (const pf of filters.props ?? []) {
      if (!properties.some((d) => d.key === pf.key)) out.push({ id: propFieldId(pf.key), type: 'text', category: 'labels', label: pf.key });
    }
    out.push(
      { id: 'ticket', type: 'bool', category: 'links', label: t('fp.ticket'), help: t('fp.help.ticket'), keywords: t('fp.kw.ticket') },
      { id: 'agent', type: 'bool', category: 'links', label: t('fp.agent'), help: t('fp.help.agent'), keywords: t('fp.kw.agent') },
      { id: 'crm', type: 'bool', category: 'links', label: t('fp.crm'), keywords: t('fp.kw.crm') },
    );
    if (hubspotOn || filters.hubspot) out.push({ id: 'hubspot', type: 'bool', category: 'links', label: t('fp.hubspot'), keywords: t('fp.kw.hubspot') });
    if (hubspotOn || filters.hsProps?.length) {
      out.push({
        id: 'hsProps',
        type: 'custom',
        category: 'links',
        label: t('fp.hsProps'),
        help: t('fp.help.hsProps'),
        keywords: t('fp.kw.hubspot'),
        count: (v) => cleanHubspotFilters(v).length,
        summary: (v) => t('fp.hsSummary', { n: cleanHubspotFilters(v).length }),
      });
    }
    return out;
  }, [t, people, me, teams, numbers, labels, properties, hubspotOn, filters.teams, filters.lines, filters.props, filters.hubspot, filters.hsProps]);
  const values = useMemo(() => filtersToValues(filters, propKinds), [filters, propKinds]);
  const chipStrings = useMemo<ChipStrings>(() => {
    const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return {
      yes: tf('yes'),
      no: tf('no'),
      presets: { today: tf('presets.today'), yesterday: tf('presets.yesterday'), last7: tf('presets.last7'), last30: tf('presets.last30'), thisWeek: tf('presets.thisWeek'), thisMonth: tf('presets.thisMonth'), lastMonth: tf('presets.lastMonth') },
      from: (d) => tf('from', { day: d }),
      until: (d) => tf('until', { day: d }),
      range: (from, to) => tf('range', { from, to }),
      more: (n) => tf('more', { n }),
      unavailable: (n) => tf('unavailableShort', { n }),
      hasValue: tf('hasValue'),
      noValue: tf('noValue'),
      day: (d) => day.format(new Date(`${d}T00:00:00Z`)),
    };
  }, [tf, locale]);
  // Debajo de la búsqueda, un chip por campo con algo puesto. Lo que ya dice una pestaña marcada no se repite.
  const chips = useMemo(() => {
    const viaTab = new Set(tabsOn.flatMap((tab) => (tab === 'all' ? [] : [TAB_FIELD[tab]])));
    return filterChips(fields, values, chipStrings).filter((c) => !viaTab.has(c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, values, chipStrings, tabsOn.join(',')]);

  function applyFilters(next: LinesFilters) {
    setFilters(withoutSearch(next));
    // Líneas elegidas en el panel: el selector de línea vuelve a "todas" (si no, las dos elecciones se cruzarían).
    if (next.lines?.length && line !== 'all') {
      setLine('all');
      void api('/api/groups/prefs', { method: 'PUT', body: { line: 'all' } });
    }
  }
  function openPanel(fieldId: string | null = null) {
    setPanelField(fieldId);
    setPanelOpen(true);
  }
  function removeChip(id: string) {
    const next: FilterValues = { ...values };
    delete next[id];
    applyFilters(valuesToFilters(next));
  }
  const emptyText = debounced
    ? t('inbox.noResults')
    : archivedView
      ? t('wa.archivedEmpty')
      : activeList
        ? t('lists.empty')
        : countFilters(filters) === 0
          ? t('inbox.empty.all')
          : countFilters(filters) === 1 && tabsOn[0] !== 'all' && tabsOn[0] !== 'groups'
            ? t(`inbox.empty.${tabsOn[0]}`)
            : t('fp.empty');

  async function saveChanges() {
    if (!activeList) return;
    const r = await api<SavedListDto>(`/api/groups/lists/${activeList.id}`, { method: 'PATCH', body: { filters: listFilters } });
    if (r.data) {
      setLists((ls) => ls.map((l) => (l.id === r.data!.id ? r.data! : l)));
      notifyListsChanged();
      showToast(t('common.saved'));
    } else showToast(errText(r.error), true);
  }

  async function removeList() {
    if (!activeList) return;
    const r = await api(`/api/groups/lists/${activeList.id}`, { method: 'DELETE' });
    setRemoving(false);
    if (!r.data) return showToast(errText(r.error), true);
    setLists((ls) => ls.filter((l) => l.id !== activeList.id));
    notifyListsChanged();
    pushUrl(window.location.pathname);
  }

  return (
    <Ctx.Provider value={value}>
      <div className={`gr-inbox${current ? ' has-chat' : ''}${detailsHidden ? ' is-details-hidden' : ''}`} data-chat-style={chatStyle}>
        <section className="gr-list" aria-label={t('inbox.listLabel')}>
          <div className="gr-list-head">
            {banner}
            <div className="gr-list-titlebar">
              <h1 className="gr-list-title">{activeList ? activeList.name : t('inbox.title')}</h1>
              <LineSelector numbers={numbers} value={line} onChange={pickLine} />
              {available !== null && (
                <button
                  type="button"
                  className={`btn btn-ghost btn-sm gr-presence${available ? ' is-on' : ''}`}
                  aria-pressed={available}
                  onClick={() => void toggleAvailable()}
                  title={t('inbox.availabilityHelp')}
                >
                  <i aria-hidden="true" />
                  {available ? t('inbox.available') : t('inbox.away')}
                </button>
              )}
            </div>
            {lists.length > 0 && (
              <nav className="gr-list-views" aria-label={t('lists.sidebar')}>
                <Link
                  href={`/app/lines/inbox${current ? `/${current}` : ''}`}
                  prefetch={false}
                  className={`gr-view${!listId ? ' is-on' : ''}`}
                  aria-current={!listId ? 'page' : undefined}
                  onClick={() => {
                    setFilters({});
                    setQ('');
                    setDebounced('');
                  }}
                >
                  {t('lists.allChats')}
                </Link>
                {lists.map((l) => (
                  <Link
                    key={l.id}
                    href={`/app/lines/inbox${current ? `/${current}` : ''}?list=${l.id}`}
                    prefetch={false}
                    className={`gr-view${l.id === listId ? ' is-on' : ''}`}
                    aria-current={l.id === listId ? 'page' : undefined}
                  >
                    {l.name}
                  </Link>
                ))}
              </nav>
            )}
            {activeList && (
              <p className="gr-list-meta ui-help">
                {activeList.shared ? t('lists.sharedTag') : t('lists.privateTag')}
                {canEditList && (
                  <>
                    {dirty && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void saveChanges()}>
                        {t('lists.saveChanges')}
                      </button>
                    )}
                    <Link href={`/app/lines/broadcasts/new?list=${activeList.id}`} className="btn btn-ghost btn-sm">
                      {t('lists.broadcast')}
                    </Link>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving('rename')}>
                      {t('lists.rename')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(true)}>
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </p>
            )}
            {!archivedView && !sideBranch && !railBranch && <FolderSelect folders={folderData.folders} value={folderSel} onChange={pickFolder} />}
            {!archivedView && (sideBranch || railBranch) && folderSel && folderName && (
              <p className="gr-folder-current" data-testid="lines-folder-current">
                <span className="gr-folder-name">{folderName}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pickFolder('')}>
                  {t('lines.allChats')}
                </button>
              </p>
            )}
            <div className="wa-search-row" ref={searchRow}>
            <span className="wa-search">
              <Search size={18} />
            <DebouncedInput
              ref={searchRef}
              className="input gr-search"
              type="search"
              value={q}
              delay={250}
              clearOnEscape={false}
              onCommit={(v) => {
                setQ(v);
                setDebounced(v.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
              placeholder={t('inbox.searchPlaceholder')}
              aria-label={t('inbox.search')}
            />
            </span>
            <button
              ref={filterBtn}
              type="button"
              className={`wa-icon-btn wa-filter-btn${panelOpen || chips.length > 0 ? ' is-on' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={panelOpen}
              aria-label={chips.length > 0 ? t('fp.openCount', { n: chips.length }) : t('fp.open')}
              title={t('fp.open')}
              data-testid="lines-filter-button"
              onClick={() => (panelOpen ? setPanelOpen(false) : openPanel())}
            >
              <FilterIcon size={20} />
              {chips.length > 0 && (
                <span className="wa-filter-count" aria-hidden="true">
                  {chips.length}
                </span>
              )}
            </button>
            <ScheduledAllButton />
            <button
              type="button"
              className={`wa-icon-btn wa-filter-btn${selectMode ? ' is-on' : ''}`}
              aria-pressed={selectMode}
              aria-label={t('wa.selectChats')}
              title={t('wa.selectChats')}
              onClick={() => {
                setSelectMode((v) => !v);
                setSelected(new Set());
              }}
            >
              <CheckIcon size={20} />
            </button>
            </div>
            <FilterChips chips={chips} onRemove={removeChip} onClear={() => applyFilters({})} onOpen={(id) => openPanel(id)}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving('new')}>
                {t('lists.save')}
              </button>
            </FilterChips>
            {/* Cada pestaña es un atajo de un campo del panel: marcada cuando ese filtro está puesto, también si se puso desde el panel. */}
            <div className="gr-filters" role="tablist" aria-multiselectable="true" aria-label={t('inbox.filters')}>
              {LINES_TABS.map((tab) => {
                const on = tabsOn.includes(tab);
                return (
                  <button key={tab} type="button" role="tab" aria-selected={on} className={`gr-filter${on ? ' is-on' : ''}`} onClick={() => setFilters((f) => applyTab(f, tab))}>
                    {t(`filters.${tab}`)}
                  </button>
                );
              })}
            </div>
          </div>
          {visibleSelected.length > 0 && (
            <div className="gr-bulkbar" role="toolbar" aria-label={t('bulkInbox.label')}>
              <span className="gr-bulkbar-count">{t('bulkInbox.selected', { n: visibleSelected.length })}</span>
              {onlyClosed ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulk('reopen')} disabled={bulkBusy}>
                  {t('bulkInbox.reopen')}
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void bulk('close')} disabled={bulkBusy}>
                  {t('bulkInbox.close')}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void bulk('read')} disabled={bulkBusy}>
                {t('bulkInbox.read')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void bulk('unread')} disabled={bulkBusy}>
                {t('bulkInbox.unread')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void bulk('pin')} disabled={bulkBusy}>
                {t('bulkInbox.pin')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void bulk('unpin')} disabled={bulkBusy}>
                {t('bulkInbox.unpin')}
              </button>
              <select
                className="select"
                value="none"
                onChange={(e) => void bulk('assign', e.target.value === '__nobody' ? null : e.target.value)}
                aria-label={t('bulkInbox.assign')}
                disabled={bulkBusy}
              >
                <option value="none" disabled>
                  {t('bulkInbox.assign')}
                </option>
                <option value="__nobody">{t('thread.unassigned')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.email}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMoveIds(visibleSelected)} disabled={bulkBusy}>
                {t('lines.moveToFolder')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                {t('bulkInbox.clear')}
              </button>
            </div>
          )}
          {/* Con una línea elegida, solo sus avisos: los de otra línea no son de esta vista. */}
          {dropped.filter((n) => (line === 'all' || n.id === line) && !importsClosed.includes(`drop:${n.id}`)).map((n) => (
            <div key={n.id} className="wa-import is-bad wa-dropped" role="alert">
              <span>{t('wa.lineDropped', { name: n.name || (n.phone ? `+${n.phone}` : t('wa.line')) })}</span>
              <Link className="btn btn-secondary btn-sm" href={`/app/lines/settings?tab=numbers&reconnect=${n.id}`}>
                {n.qr ? t('wa.rescan') : t('wa.reconnect')}
              </Link>
              <button type="button" className="wa-icon-btn wa-import-close" onClick={() => closeImport(`drop:${n.id}`)} aria-label={t('common.close')} title={t('common.close')}>
                <Close size={16} />
              </button>
            </div>
          ))}
          {archivedView && (
            <div className="wa-archived-head">
              <button type="button" className="wa-icon-btn" onClick={() => setArchivedView(false)} aria-label={t('thread.back')} title={t('thread.back')}>
                <ArrowLeft size={22} />
              </button>
              <h3>{t('wa.archivedTitle')}</h3>
            </div>
          )}
          {imports.filter((im) => (line === 'all' || im.numberId === line) && !(im.status === 'done' && importsClosed.includes(importKey(im)))).map((im) => (
            <div key={im.numberId} className={`wa-import${im.status === 'error' ? ' is-bad' : im.status === 'done' ? ' is-done' : ''}`} role="status">
              <span>
                {im.status === 'done'
                  ? im.messages === 0
                    ? t('wa.importNothingNew', { chats: im.chatsTotal })
                    : t('wa.importDone', { chats: im.chatsTotal, messages: im.messages })
                  : im.status === 'error'
                    ? t('wa.importFailed')
                    : im.phase === 'older'
                      ? t('wa.importOlder', { messages: im.messages })
                      : im.phase === 'messages' || im.phase === 'pictures'
                        ? t('wa.importMessages', { done: im.chatsDone, total: im.chatsTotal })
                        : t('wa.importChats', { n: im.chatsTotal })}
              </span>
              {(im.status === 'queued' || im.status === 'running') && (
                <span className="wa-import-bar" role="progressbar" aria-label={t('wa.importProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={im.chatsTotal ? Math.round((im.chatsDone / im.chatsTotal) * 100) : 0}>
                  <i style={{ width: `${im.chatsTotal ? Math.max(3, (im.chatsDone / im.chatsTotal) * 100) : 3}%` }} />
                </span>
              )}
              {im.status === 'done' && (
                <button type="button" className="wa-icon-btn wa-import-close" onClick={() => closeImport(importKey(im))} aria-label={t('common.close')} title={t('common.close')}>
                  <Close size={16} />
                </button>
              )}
            </div>
          ))}
          {error && (
            <div className="gr-error" role="alert">
              {t('inbox.loadError')}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(false)}>
                {t('common.retry')}
              </button>
            </div>
          )}
          {!loaded ? (
            <div className="ui-loading-stack gr-list-loading" aria-busy="true" aria-label={t('common.loading')}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="ui-skeleton ui-skeleton-row" />
              ))}
            </div>
          ) : rows.length === 0 && !error ? (
            <>
              {archivedRow}
              <p className="gr-list-empty">{emptyText}</p>
            </>
          ) : (
            <ul ref={rowsBox} className={`gr-rows${visibleSelected.length > 0 || selectMode ? ' is-selecting' : ''}${switching ? ' is-stale' : ''}`} aria-busy={switching || undefined} data-list={shownKey} data-chat-list>
              {archivedRow && <li>{archivedRow}</li>}
              {debounced ? (
                <>
                  {rows.some((c) => nameHit(c)) && <li className="gr-rows-head">{t('wa.searchChats')}</li>}
                  {rows.filter((c) => nameHit(c)).map((c) => renderRow(c))}
                  {rows.some((c) => c.match) && <li className="gr-rows-head">{t('wa.searchMessages')}</li>}
                  {rows.filter((c) => c.match).map((c) => renderRow(c, { snippet: true }))}
                </>
              ) : (
                rows.map((c) => renderRow(c))
              )}
              {next && !switching && (
                <li ref={moreRef} className="gr-rows-more" role="presentation" aria-busy={loadingMore || undefined} data-testid="lines-list-more">
                  <span className="ui-skeleton ui-skeleton-row" />
                </li>
              )}
            </ul>
          )}
        </section>
        {children}
        <PanelSplitters me={me} hasDetails={!detailsHidden} labels={{ list: t('inbox.resizeList'), details: t('inbox.resizeDetails'), hint: t('inbox.resizeHint') }} />
      </div>
      <FilterPanel
        open={panelOpen}
        title={t('fp.title')}
        anchorRef={searchRow}
        returnFocusRef={filterBtn}
        categories={categories}
        fields={fields}
        values={values}
        initialField={panelField}
        onClose={() => setPanelOpen(false)}
        onApply={(next) => {
          setPanelOpen(false);
          applyFilters(valuesToFilters(next));
        }}
        renderCustom={(field, value, onChange) =>
          field.id === 'hsProps' ? <HubspotFilter immediate value={Array.isArray(value) ? (value as HubspotPropFilter[]) : NO_HS} onChange={(next) => onChange(next.length ? next : undefined)} /> : null
        }
        extraAction={{
          label: t('lists.save'),
          onClick: (next) => {
            setPanelOpen(false);
            applyFilters(valuesToFilters(next));
            setSaving('new');
          },
        }}
      />
      <SaveListModal
        mode={saving}
        list={activeList}
        filters={listFilters}
        onClose={() => setSaving(null)}
        onSaved={(l) => {
          setSaving(null);
          void reloadLists();
          notifyListsChanged();
          pushUrl(`${window.location.pathname}?list=${l.id}`);
        }}
      />
      <ConfirmDialog
        open={!!hiding}
        title={t('wa.deleteChatTitle', { name: hiding?.name ?? '' })}
        body={t('wa.deleteChatBody')}
        confirmLabel={t('wa.deleteChat')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          const c = hiding;
          setHiding(null);
          if (!c) return;
          void rowAction(c, { hidden: true }).then(() => {
            showToast(t('wa.chatDeleted'));
            if (c.id === current) router.push(`/app/lines/inbox${listSuffix}`);
          });
        }}
        onCancel={() => setHiding(null)}
      />
      <ConfirmDialog
        open={removing}
        title={t('lists.deleteTitle', { name: activeList?.name ?? '' })}
        body={t('lists.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void removeList()}
        onCancel={() => setRemoving(false)}
      />
      <MoveToFolderModal
        open={!!moveIds}
        folders={folderData.folders}
        onClose={() => setMoveIds(null)}
        onPick={(folderId) => {
          const ids = moveIds ?? [];
          setMoveIds(null);
          void moveToFolder(ids, folderId);
        }}
      />
      {gestures.layer}
      <ContextMenu anchor={ctxMenu.open?.anchor ?? null} items={ctxMenu.open ? ctxItems(ctxMenu.open.id) : []} onClose={ctxMenu.close} />
      {toast}
    </Ctx.Provider>
  );
}

/** Guardar la vista actual como lista (o renombrar la abierta). */
function SaveListModal({
  mode,
  list,
  filters,
  onClose,
  onSaved,
}: {
  mode: 'new' | 'rename' | null;
  list: SavedListDto | null;
  filters: SavedListFilters;
  onClose: () => void;
  onSaved: (l: SavedListDto) => void;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!mode) return;
    setName(mode === 'rename' ? (list?.name ?? '') : '');
    setShared(mode === 'rename' ? Boolean(list?.shared) : false);
    setError('');
  }, [mode, list]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const r =
      mode === 'rename' && list
        ? await api<SavedListDto>(`/api/groups/lists/${list.id}`, { method: 'PATCH', body: { name, shared } })
        : await api<SavedListDto>('/api/groups/lists', { body: { name, shared, filters } });
    setBusy(false);
    if (!r.data) return setError(errText(r.error));
    onSaved(r.data);
  }

  return (
    <Modal
      open={!!mode}
      title={mode === 'rename' ? t('lists.renameTitle') : t('lists.saveTitle')}
      onClose={onClose}
      onSubmit={() => void submit()}
      busy={busy}
      foot={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()} aria-busy={busy || undefined}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="ui-fields">
        <label className="ui-field">
          <span className="label">{t('lists.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required placeholder={t('lists.namePlaceholder')} />
        </label>
        <label className="gr-check-label">
          <input type="checkbox" className="ui-check" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {t('lists.shared')}
        </label>
        {mode === 'new' && <p className="ui-help">{t('lists.saveHelp')}</p>}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
