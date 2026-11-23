'use client';

import { matchesChatName } from '@/lib/chat-search-rank';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import WhenDialog from '@/components/ui/WhenDialog';
import { longWhen } from '@/lib/when-presets';
import { ScheduledAllButton, useWhenLabels } from './Scheduled';
import { LabelTag, Modal, api, markChatSwitch, useErrorText, useMediaText, useRelativeTime, useSwitchingTo, useToast } from './ui';
import Avatar from './wa/Avatar';
import { useGroupEventText } from './wa/GroupEvent';
import { decodeSysPreview } from '@/lib/wa-group-events';
import { duration, listTime } from './wa/format';
import { nameOrPhone } from '@/components/inbox/wa/util';
import { plainWa } from './wa/rich';
import { ArchiveIcon, ArrowLeft, Ban, Bell, CheckCircle, CheckIcon, Chevron, ClockIcon, Close, Download, FilterIcon, FolderIcon, HeartIcon, InfoIcon, VipIcon, Mic, MuteIcon, PinIcon, Plus, ReadIcon, Retry, Search, Ticks, Trash, UnreadIcon, UserPlus, WindowIcon } from './wa/icons';
import { MessageMenu, type MenuItem } from './ThreadParts';
import type { ImportStatus } from '@/lib/groups-import';
import LinesImportNotices from './LinesImportNotices';
import DailyBrief from './DailyBrief';
import { useChatStyle } from '@/components/chat-style/ChatStyle';
import { EMPTY_FOLDERS, FOLDERS_CHANGED, FolderSelect, LineBadge, LineDot, LineSelector, MoveToFolderModal, lineGroupOf, notifyFoldersChanged, type LineFoldersResponse, type LineGroupOption, type LineOption } from './LineFolders';
import { useChatGestures, type SwipeActions } from '@/components/ui/chat-gestures';
import { ContextMenu, openInNewWindow, useRowContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu';
import { requestChatInfo } from '@/lib/chat-info-request';
import { dragIds, rowSwipeLayout, swipeActionKey, type RowSwipeKey } from '@/lib/chat-gestures';
import { flattenTree } from '@/lib/inbox/folder-tree';
import { useCollapsedBranch, useShellBranch } from '@/components/app/useShellBranch';
import PanelSplitters from './PanelSplitters';
import NewChatDialog from './NewChatDialog';
import { useDetailsHidden } from './details-hidden';
import { useConversationZoom } from './wa/useConversationZoom';
import { fetchIfChanged, ListCache, reuseRows } from '@/lib/conditional-fetch';
import { useWaLive } from '@/lib/wa-live-client';
import { linesDraftKey, linesOutbox, unsentLines } from './optimistic';
import { pushUrl, useShallowLinks } from '@/components/app/shallowNav';
import { useNearEnd } from '@/components/app/useNearEnd';
import DebouncedInput from '@/components/app/DebouncedInput';
// Registra el último clic del mouse antes de abrir un chat (el campo se enfoca al abrirlo: lib/ui/focus-on-open).
import '@/lib/ui/focus-on-open';
import { useOnChatSent } from '@/lib/ui/chat-sent';
import AgentsRow, { type AgentsRowProps } from '@/components/fleet/AgentsRow';
import { KanbanToggle, useKanbanView } from './KanbanToggle';
import InboxKanban from './InboxKanban';
import { useScrollEdges } from './wa/useScrollEdges';

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
  favorites: 'favorite',
  vip: 'vip',
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

function readDraft(me: string, chatId: string): string {
  try {
    return window.sessionStorage.getItem(linesDraftKey(me, chatId)) ?? '';
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
  /** Eliminados con "Eliminar chat" (con historial) que ve quien mira. */
  hidden?: number;
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

export default function InboxShell({
  labels,
  people = [],
  teams = [],
  properties = [],
  me = '',
  canExport = false,
  initialLists = [],
  numbers = [],
  lineGroups = [],
  initialLine = 'all',
  banner = null,
  agentsRow = null,
  initialKanban = false,
  children,
}: {
  labels: LabelDto[];
  people?: GroupsPerson[];
  teams?: Array<{ id: string; name: string }>;
  properties?: PropertyDef[];
  me?: string;
  /** Admin o dueño: puede exportar los mensajes de un chat. */
  canExport?: boolean;
  initialLists?: SavedListDto[];
  /** Líneas que esta persona ve (visibilidad por línea). */
  numbers?: LineOption[];
  /** Grupos de líneas donde esta persona ve alguna línea (lib/groups-line-groups.ts). */
  lineGroups?: LineGroupOption[];
  /** Línea elegida la última vez ('all' = todas; 'g:<id>' = un grupo de líneas entero). */
  initialLine?: string;
  /** Aviso arriba de la lista (datos de ejemplo). */
  banner?: ReactNode;
  /** Fila "Agentes" de Fleet arriba de la lista (si la persona prendió el espejo en Fleet). */
  agentsRow?: AgentsRowProps | null;
  /** La bandeja se ve como kanban (preferencia de la persona, lib/groups-kanban.ts). */
  initialKanban?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('groups');
  const tf = useTranslations('common.ui.filter');
  // Las pestañas de filtro se deslizan de costado: el borde con más para ver se esfuma.
  const filtersEdges = useScrollEdges<HTMLDivElement>();
  const { style: chatStyle } = useChatStyle();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const rel = useRelativeTime();
  const mediaText = useMediaText();
  const sysText = useGroupEventText();
  const locale = useLocale();
  const [imports, setImports] = useState<ImportStatus[]>([]);
  const [archivedView, setArchivedView] = useState(false);
  const [kanban, setKanban] = useKanbanView(initialKanban);
  const [snoozeFor, setSnoozeFor] = useState<ChatDto | null>(null);
  const laterLabels = useWhenLabels();
  const snoozeLabels = useMemo(() => ({ ...laterLabels, confirm: t('snooze.confirm') }), [laterLabels, t]);
  const [archivedInfo, setArchivedInfo] = useState({ total: 0, unread: 0 });
  // "Eliminados" (dentro de Archivados): los chats que alguien sacó con "Eliminar chat", para recuperarlos.
  const [deletedView, setDeletedView] = useState(false);
  const [hiddenTotal, setHiddenTotal] = useState(0);
  const [dropped, setDropped] = useState<DroppedNumber[]>([]);
  const [hiding, setHiding] = useState<ChatDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name || p.email])), [people]);
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const listId = params.get('list');
  const current = chatIdFromPath(pathname);
  const switchingTo = useSwitchingTo();
  const [line, setLine] = useState(
    numbers.some((n) => n.id === initialLine) || (lineGroupOf(initialLine) && numbers.some((n) => n.groupId === lineGroupOf(initialLine))) ? initialLine : 'all',
  );
  // Un grupo de líneas elegido: varias líneas a la vez, como "todas" (cada chat dice de qué línea es).
  const lineGroup = lineGroupOf(line);
  const manyLines = line === 'all' || Boolean(lineGroup);
  const inLine = (numberId: string) => line === 'all' || numberId === line || (Boolean(lineGroup) && numbers.some((n) => n.id === numberId && n.groupId === lineGroup));
  // La carpeta abierta vive en la URL (?folder=): la eligen el sidebar o el selector de la bandeja.
  const folderSel = params.get('folder') ?? '';
  const sideBranch = useShellBranch();
  // Con el sidebar colapsado las carpetas van como íconos en el lateral (GroupsFoldersBranch).
  const railBranch = useCollapsedBranch();
  const [folderData, setFolderData] = useState<LineFoldersResponse>(EMPTY_FOLDERS);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  // La pregunta antes de sacar chats de una carpeta del equipo (para todos).
  const [unfileAsk, setUnfileAsk] = useState<{ ids: string[]; team: boolean; name: string } | null>(null);
  const lineNames = useMemo(() => new Map(numbers.map((n) => [n.id, n.name])), [numbers]);
  const lineColors = useMemo(() => new Map(numbers.map((n) => [n.id, n.color ?? ''])), [numbers]);
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
  // Mandar un mensaje desde un chat encontrado con la búsqueda vuelve a la bandeja (como WhatsApp).
  useOnChatSent(() => {
    setQ('');
    setDebounced('');
  });
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
  // Pellizcar en el trackpad agranda solo los mensajes, no la app entera.
  useConversationZoom();
  // El aviso de una línea caída se puede cerrar y queda cerrado (por navegador). Los de importación: LinesImportNotices.
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
  const [newChat, setNewChat] = useState(false);
  // En escritorio la miga de arriba ya dice "Bandeja" y el lateral tiene "Nuevo": la cabecera de la lista se va
  // y el filtro de línea sube a la banda (#band-app-slot). En el teléfono, sin miga ni lateral, queda como estaba.
  const [bandSlot, setBandSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setBandSlot(mq.matches ? document.getElementById('band-app-slot') : null);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  // "Nuevo › Chat nuevo" del lateral llega con ?new=1 desde otra página: abre el diálogo y saca el parámetro de la
  // barra de direcciones. Con window.history.state (lleva __NA) Next no se entera del cambio: su router sigue en ?new=1,
  // y por eso un segundo "Chat nuevo" con la bandeja ya abierta no navega (abajo se atiende sin navegar).
  const wantsNewChat = params.get('new') === '1';
  useEffect(() => {
    if (!wantsNewChat) return;
    setNewChat(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [wantsNewChat]);
  // Con la bandeja montada, un link a /app/lines/inbox?new=1 (el del lateral) abre el diálogo acá mismo, sin navegar:
  // ir a la misma URL no cambia nada para Next, y navegar cerraría el chat abierto. En captura, antes que el Link.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== '_self')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.searchParams.get('new') !== '1') return;
      if (!/^(\/[a-z]{2})?\/app\/lines\/inbox\/?$/.test(url.pathname)) return;
      e.preventDefault();
      setNewChat(true);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsBox = useRef<HTMLUListElement>(null);
  const moreRef = useRef<HTMLLIElement>(null);
  const listCache = useRef(new ListCache<CachedList>(30)).current;
  const live = useRef({ want: '', shown: '', rows: [] as ChatDto[], next: null as string | null, pinned: 0, kept: 0, etag: '', etagUrl: '', more: false, unreadOnly: false, current: null as string | null });
  const listAbort = useRef<AbortController | null>(null);
  /** La relectura en curso: otra de la misma lista no la corta (con un servidor lento, ninguna llegaría a terminar). */
  const listInflight = useRef<string | null>(null);
  /** Llegó otro aviso mientras esa relectura estaba en curso: al terminar se lee una vez más (puede haber cambiado algo después). */
  const listAgain = useRef(false);
  const moreAbort = useRef<AbortController | null>(null);
  const activeList = lists.find((l) => l.id === listId) ?? null;

  useEffect(() => {
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
    if (deletedView) p.set('hidden', '1');
    else if (archivedView) p.set('archived', '1');
    if (lineGroupOf(line)) p.set('linegroup', lineGroupOf(line));
    else if (line !== 'all') p.set('number', line);
    if (folderSel) p.set('folder', folderSel);
    if (debounced) p.set('q', debounced);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, debounced, archivedView, deletedView, line, folderSel]);
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
      // Una relectura de fondo de la misma lista que ya se está pidiendo espera a esa: si cada aviso o cada 5 s cortara
      // la anterior, con un servidor lento la lista no llegaría nunca. Otra lista (u otro tamaño) sí corta la anterior.
      if (silent && listInflight.current === url) {
        listAgain.current = true;
        return;
      }
      listAbort.current?.abort();
      const ctrl = new AbortController();
      listAbort.current = ctrl;
      listInflight.current = url;
      if (!silent) setError(false);
      const r = await fetchIfChanged<ListData>(url, L.etagUrl === url ? L.etag : null, ctrl.signal);
      if (listAbort.current === ctrl) {
        listInflight.current = null;
        if (listAgain.current) {
          listAgain.current = false;
          queueMicrotask(() => void loadRef.current(true));
        }
      }
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
      if (typeof data.hidden === 'number') setHiddenTotal(data.hidden);
      setDropped((cur) => (JSON.stringify(cur) === JSON.stringify(data.dropped ?? []) ? cur : (data.dropped ?? [])));
      setHubspotOn(data.hubspot === true);
      if (typeof data.unreadChats === 'number') setUnreadTotal(data.unreadChats);
    },
    [showRows],
  );
  const loadRef = useRef(load);
  loadRef.current = load;

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
  // Un texto que no salió de un chat que ya no está abierto: se avisa acá (la lista siempre está) y el texto queda
  // en ese chat como no enviado, con reintentar (./optimistic.ts).
  useEffect(() => {
    unsentLines.setOwner(me);
    // Lo escrito sin red (en esta pestaña o en otra) sale solo al volver la conexión.
    linesOutbox.start();
  }, [me]);
  useEffect(
    () =>
      unsentLines.subscribe((e) => {
        if (e.type !== 'failed' || e.chatId === live.current.current) return;
        showToast(t('wa.unsent', { name: live.current.rows.find((r) => r.id === e.chatId)?.name || '…' }), true);
      }),
    [showToast, t],
  );
  // Devuelve la carga: el aviso espera a que termine antes de pedir otra (nunca corta una en curso; lib/wa-live-client.ts).
  const { live: liveOn } = useWaLive('groups', () => load(true));
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
    const r = await fetchIfChanged<LineFoldersResponse>('/api/groups/folders', foldersEtag.current);
    if (r.state !== 'fresh') return;
    foldersEtag.current = r.etag;
    setFolderData({ ...EMPTY_FOLDERS, ...r.data });
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

  /**
   * Mueve chats a una carpeta propia o del equipo (o los saca, con null: `scope` dice de cuál; soltarlos en "Sin
   * carpeta" los saca de las dos). El aviso dice a dónde fueron y deja deshacer: cada chat vuelve a donde estaba.
   */
  async function moveToFolder(ids: string[], folderId: string | null, newName?: string, scope?: 'personal' | 'team' | 'all') {
    const kind: 'personal' | 'team' | 'all' = folderId ? (folderData.team.some((f) => f.id === folderId) ? 'team' : 'personal') : (scope ?? 'all');
    const before = new Map<string, { folderId: string | null; scope: 'personal' | 'team'; ids: string[] }>();
    const note = (sc: 'personal' | 'team', prev: string | null, id: string) => {
      const key = `${sc}:${prev ?? ''}`;
      const op = before.get(key) ?? { folderId: prev, scope: sc, ids: [] };
      op.ids.push(id);
      before.set(key, op);
    };
    for (const id of ids) {
      const row = rowsRef.current.find((r) => r.id === id);
      if (!row) continue;
      if (kind !== 'team' && (row.folderId ?? null) !== (kind === 'personal' ? folderId : null)) note('personal', row.folderId ?? null, id);
      if (kind !== 'personal' && (row.teamFolderId ?? null) !== (kind === 'team' ? folderId : null)) note('team', row.teamFolderId ?? null, id);
    }
    const res = await api<{ updated: number; failed: number }>('/api/groups/chats/bulk', { body: { ids, action: 'folder', folderId, scope: kind } });
    if (!res.data) return showToast(errText(res.error), true);
    const name = folderId ? ([...folderData.team, ...folderData.folders].find((f) => f.id === folderId)?.name ?? newName ?? '') : '';
    const after = () => {
      void load(true);
      notifyFoldersChanged();
    };
    const undo = async () => {
      for (const op of before.values()) await api('/api/groups/chats/bulk', { body: { ids: op.ids, action: 'folder', folderId: op.folderId, scope: op.scope } });
      after();
    };
    // En "Sin carpeta" los que ya tienen carpeta salen de la lista enseguida (la recarga lo confirma).
    if (folderSel === 'none' && folderId && res.data.updated > 0) {
      const gone = new Set(ids);
      setRows((list) => list.filter((r) => !gone.has(r.id)));
    }
    showToast(
      folderId ? t('lines.movedTo', { n: res.data.updated, name }) : t('lines.removedFromFolder', { n: res.data.updated }),
      res.data.failed > 0,
      before.size > 0 && res.data.updated > 0 ? { label: t('swipe.undo'), onClick: () => void undo() } : undefined,
    );
    setSelected(new Set());
    after();
  }
  /**
   * Sacar chats de su carpeta sin tocar a los demás: soltarlos en "Sin carpeta" saca solo lo propio. Si alguno está
   * además en una carpeta del equipo, se pregunta antes de sacarlo de ahí para todos (por defecto, no). `team` es la
   * acción explícita "sacar de la carpeta del equipo" (Mover a carpeta › Equipo › Sin carpeta): solo esa, también
   * con la pregunta.
   */
  function unfile(ids: string[], team = false) {
    const rows = ids.map((id) => rowsRef.current.find((r) => r.id === id)).filter((r): r is ChatDto => Boolean(r));
    const inTeam = rows.find((r) => r.teamFolderId)?.teamFolderId;
    if (!inTeam) {
      if (!team) void moveToFolder(ids, null, undefined, 'personal');
      return;
    }
    setUnfileAsk({ ids, team, name: folderData.team.find((f) => f.id === inTeam)?.name ?? '' });
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
  const folderName = folderSel === 'none' ? t('lines.unfiled') : ([...folderData.team, ...folderData.folders].find((f) => f.id === folderSel)?.name ?? '');

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


  // Disponible/ausente se cambia en el menú de la cuenta: al cambiar, la lista se recarga (puede haber asignaciones nuevas).
  useEffect(() => {
    const on = () => void load(true);
    window.addEventListener('zs:lines-presence-changed', on);
    return () => window.removeEventListener('zs:lines-presence-changed', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(() => ({ rows, refresh }), [rows, refresh]);
  const unreadChats = unreadTotal ?? rows.filter((r) => r.unread > 0 && !r.muted).length;
  useEffect(() => {
    const prev = document.title;
    document.title = `${unreadChats ? `(${unreadChats}) ` : ''}${activeList ? activeList.name : t('inbox.title')} · Lines`;
    return () => {
      document.title = prev;
    };
  }, [unreadChats, activeList, t]);

  async function rowAction(c: ChatDto, body: Record<string, unknown>): Promise<boolean> {
    const res = await api(`/api/groups/chats/${c.id}`, { method: 'PATCH', body });
    if (!res.data) showToast(errText(res.error), true);
    void load(true);
    return Boolean(res.data);
  }

  /** Favoritos, como la lista de WhatsApp: sumar o sacar el chat, con Deshacer. */
  async function toggleFavorite(c: ChatDto) {
    const on = !c.favorite;
    if (await rowAction(c, { favorite: on })) showToast(on ? t('favorites.added') : t('favorites.removed'), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { favorite: !on }) });
  }

  /** VIP es la persona (su teléfono): entra en la pestaña VIP con sus chats de todas las líneas. Con Deshacer. */
  async function toggleVip(c: ChatDto) {
    const on = !c.vip;
    if (await rowAction(c, { vip: on })) showToast(on ? t('vip.added', { name: c.name }) : t('vip.removed', { name: c.name }), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { vip: !on }) });
  }

  /** El chat coincide por nombre o teléfono (va en "Chats"; lo que coincide en mensajes va en "Mensajes"). */
  function nameHit(c: ChatDto): boolean {
    return !c.match || matchesChatName(c.name, c.phone, debounced);
  }

  /**
   * Posponer: el chat queda archivado (acá y en WhatsApp) hasta la hora elegida, y vuelve solo. Sale de la lista al
   * instante y Archivados suma uno; Deshacer lo deja como estaba.
   */
  async function snoozeChat(c: ChatDto, iso: string) {
    setRows((rs) => (archivedView ? rs.map((r) => (r.id === c.id ? { ...r, archived: true, snoozedUntil: iso } : r)) : rs.filter((r) => r.id !== c.id)));
    if (!c.archived) setArchivedInfo((cur) => ({ total: cur.total + 1, unread: cur.unread + (c.unread > 0 ? 1 : 0) }));
    const res = await api(`/api/groups/chats/${c.id}`, { method: 'PATCH', body: { snoozedUntil: iso } });
    void load(true);
    if (!res.data) {
      showToast(errText(res.error), true);
      return;
    }
    showToast(t('snooze.done', { when: longWhen(iso, locale) }), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { snoozedUntil: null }) });
  }

  function cancelSnooze(c: ChatDto) {
    void rowAction(c, { snoozedUntil: null }).then(() => showToast(t('snooze.cancelled'), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { snoozedUntil: c.snoozedUntil }) }));
  }

  /** Archivar o desarchivar, con deshacer en el aviso. */
  function toggleArchived(c: ChatDto) {
    // Sale de la lista al instante (como Inbox y WhatsApp): archivar espera a WhatsApp y la fila no se queda a la vista.
    // Si falla, la recarga de rowAction la trae de vuelta.
    if (archivedView === c.archived) {
      setRows((rs) => rs.filter((r) => r.id !== c.id));
      const d = c.archived ? -1 : 1;
      setArchivedInfo((cur) => ({ total: Math.max(0, cur.total + d), unread: Math.max(0, cur.unread + (c.unread > 0 ? d : 0)) }));
    }
    void rowAction(c, { archived: !c.archived }).then(() =>
      showToast(c.archived ? t('wa.unarchived') : t('wa.archived'), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { archived: c.archived }) }),
    );
  }

  // Mandar desde un chat archivado lo desarchiva, como WhatsApp (el servidor lo hace al guardar el mensaje): sale de
  // Archivados ya, el contador baja y el chat sigue abierto. En Archivados, con aviso y Deshacer.
  // El aviso sale cuando el envío terminó: antes, el envío que llega después lo volvería a desarchivar.
  const unarchivedBySend = useRef(new Map<string, { chat: ChatDto; notice: boolean }>());
  useOnChatSent((chatId) => {
    const c = rowsRef.current.find((r) => r.id === chatId);
    if (!c?.archived || c.keepArchived || unarchivedBySend.current.has(chatId)) return;
    unarchivedBySend.current.set(chatId, { chat: c, notice: archivedView });
    setRows((rs) => (archivedView ? rs.filter((r) => r.id !== chatId) : rs.map((r) => (r.id === chatId ? { ...r, archived: false } : r))));
    setArchivedInfo((cur) => ({ total: Math.max(0, cur.total - 1), unread: Math.max(0, cur.unread - (c.unread > 0 ? 1 : 0)) }));
  });
  useEffect(
    () =>
      unsentLines.subscribe((e) => {
        // 'removed': el chat ya trajo el mensaje guardado antes que la respuesta del envío (también salió).
        if (e.type !== 'saved' && e.type !== 'failed' && e.type !== 'removed') return;
        const done = unarchivedBySend.current.get(e.chatId);
        if (!done) return;
        unarchivedBySend.current.delete(e.chatId);
        // No salió: el chat sigue archivado y vuelve a su lista.
        if (e.type === 'failed' || (e.type === 'saved' && e.saved.status === 'failed')) return void load(true);
        if (done.notice) showToast(t('wa.unarchived'), false, { label: t('swipe.undo'), onClick: () => void rowAction(done.chat, { archived: true }) });
      }),
    [showToast, t], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** Recuperar un chat eliminado: vuelve a la lista con su historial. */
  function restoreChat(c: ChatDto) {
    void rowAction(c, { hidden: false }).then(() => showToast(t('wa.chatRestored')));
  }

  function rowMenu(c: ChatDto): MenuItem[] {
    if (deletedView) return [{ key: 'restore', glyph: <Retry size={18} />, label: t('wa.restoreChat'), onSelect: () => restoreChat(c) }];
    return [
      { key: 'archive', glyph: <ArchiveIcon size={18} />, label: c.archived ? t('wa.unarchive') : t('wa.archive'), onSelect: () => toggleArchived(c) },
      // Mantener archivado: en un chat archivado, lo mismo que la llave del panel del chat.
      ...(c.archived
        ? [
            {
              key: 'keepArchived',
              glyph: <ArchiveIcon size={18} />,
              label: c.keepArchived ? t('wa.keepArchivedOff') : t('wa.keepArchived'),
              onSelect: () => {
                const on = !c.keepArchived;
                void rowAction(c, { keepArchived: on }).then((r) => r && showToast(on ? t('wa.keepArchivedOn') : t('wa.keepArchivedOffToast')));
              },
            },
          ]
        : []),
      { key: 'snooze', glyph: <ClockIcon size={18} />, label: c.snoozedUntil ? t('snooze.cancel') : t('snooze.action'), onSelect: () => (c.snoozedUntil ? cancelSnooze(c) : setSnoozeFor(c)) },
      { key: 'close', glyph: c.status === 'open' ? <CheckCircle size={18} /> : <Retry size={18} />, label: c.status === 'open' ? t('wa.closeChat') : t('thread.reopen'), onSelect: () => void rowAction(c, { status: c.status === 'open' ? 'closed' : 'open' }) },
      { key: 'mute', glyph: c.muted ? <Bell size={18} /> : <MuteIcon size={18} />, label: c.muted ? t('wa.unmute') : t('wa.mute'), onSelect: () => void rowAction(c, { muted: !c.muted }) },
      { key: 'pin', glyph: <PinIcon size={18} />, label: c.pinned ? t('thread.unpinChat') : t('thread.pinChat'), onSelect: () => void rowAction(c, { pinned: !c.pinned }) },
      { key: 'favorite', glyph: <HeartIcon size={18} />, label: c.favorite ? t('favorites.remove') : t('favorites.add'), onSelect: () => void toggleFavorite(c) },
      ...(c.kind === 'dm' && c.phone ? [{ key: 'vip', glyph: <VipIcon size={18} />, label: c.vip ? t('vip.remove') : t('vip.add'), onSelect: () => void toggleVip(c) }] : []),
      { key: 'unread', glyph: c.unread > 0 ? <ReadIcon size={18} /> : <UnreadIcon size={18} />, label: c.unread > 0 ? t('thread.markRead') : t('thread.markUnread'), onSelect: () => void rowAction(c, { read: c.unread > 0 }) },
      { key: 'assign', glyph: <UserPlus size={18} />, label: c.assignedTo === me ? t('wa.unassignMe') : t('wa.assignMe'), onSelect: () => void rowAction(c, { assignedTo: c.assignedTo === me ? null : me }) },
      { key: 'folder', glyph: <FolderIcon size={18} />, label: t('lines.moveToFolder'), onSelect: () => setMoveIds([c.id]) },
      { key: 'hide', glyph: <Trash size={18} />, label: t('wa.deleteChat'), danger: true, divider: true, onSelect: () => setHiding(c) },
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
    const from = (key: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem[] => (by[key] ? [{ key, label: by[key].label, icon: by[key].glyph, danger: by[key].danger, onSelect: by[key].onSelect, ...extra }] : []);
    if (deletedView) return [...from('restore'), { key: 'newWindow', icon: <WindowIcon size={18} />, label: t('wa.openNewWindow'), onSelect: () => openInNewWindow(`${window.location.pathname.replace(/\/app\/lines\/inbox.*$/, '')}/app/lines/inbox/${c.id}${listSuffix}`) }];
    return [
      { key: 'newWindow', icon: <WindowIcon size={18} />, label: t('wa.openNewWindow'), onSelect: () => openInNewWindow(`${window.location.pathname.replace(/\/app\/lines\/inbox.*$/, '')}/app/lines/inbox/${c.id}${listSuffix}`) },
      ...from('unread'),
      ...from('archive'),
      ...from('snooze'),
      ...from('pin'),
      ...from('mute'),
      ...from('favorite'),
      ...from('vip'),
      ...from('close'),
      ...from('assign'),
      ...from('folder'),
      {
        key: 'info',
        icon: <InfoIcon size={18} />,
        label: c.kind === 'group' ? t('wa.groupInfo') : t('wa.contactInfo'),
        divider: true,
        onSelect: () => {
          requestChatInfo(c.id);
          if (current !== c.id) router.push(`/app/lines/inbox/${c.id}${listSuffix}`);
        },
      },
      // Exportar mensajes: solo admins (el servidor también lo frena).
      ...(canExport ? [{ key: 'export', icon: <Download size={18} />, label: t('wa.exportChat'), onSelect: () => window.location.assign(`/api/groups/export?type=messages&chat=${encodeURIComponent(c.id)}`) }] : []),
      ...from('hide', { divider: true }),
    ];
  }

  /**
   * Deslizar una fila, como WhatsApp: a la derecha, leído o no leído (la
   * principal), fijar y posponer; a la izquierda, archivar (la principal) y más
   * (el menú de la fila). Con chats seleccionados no se desliza.
   */
  function swipeActions(id: string): SwipeActions | null {
    const c = rowsRef.current.find((r) => r.id === id);
    if (!c || selectMode || visibleSelected.length > 0 || deletedView) return null;
    const run: Record<RowSwipeKey, () => void> = {
      read: () => void rowAction(c, { read: true }),
      unread: () => void rowAction(c, { read: false }),
      pin: () => void rowAction(c, { pinned: true }),
      unpin: () => void rowAction(c, { pinned: false }),
      // Posponer abre el mismo diálogo que el menú (#393): elegir la hora archiva el chat hasta entonces.
      snooze: () => setSnoozeFor(c),
      unsnooze: () => cancelSnooze(c),
      archive: () => toggleArchived(c),
      unarchive: () => toggleArchived(c),
      more: () => openRowMenu(id, 220),
    };
    const layout = rowSwipeLayout({ unread: c.unread > 0, pinned: c.pinned, archived: c.archived, snoozed: Boolean(c.snoozedUntil) });
    const action = (key: RowSwipeKey) => ({ key: swipeActionKey(key), label: t(`swipe.${key}`), icon: key, onSelect: run[key], ...(key === 'archive' || key === 'unarchive' ? { leaves: true } : {}) });
    return { right: layout.right.map(action), left: layout.left.map(action) };
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
      const rowOf = (id: string) => rowsRef.current.find((r) => r.id === id);
      // "Sin carpeta" saca de las dos (la propia y la del equipo); una del equipo compara con la del equipo.
      if (target === 'none') return ids.some((id) => Boolean(rowOf(id)?.folderId || rowOf(id)?.teamFolderId));
      const team = folderData.team.some((f) => f.id === target);
      return ids.some((id) => ((team ? rowOf(id)?.teamFolderId : rowOf(id)?.folderId) ?? null) !== target);
    },
    onDrop: (ids, target) => (target === 'none' ? unfile(ids) : void moveToFolder(ids, target)),
    onHoldTap: (id) => {
      if (!selectMode && visibleSelected.length === 0) openRowMenu(id);
    },
    tray: {
      title: t('swipe.dropTitle'),
      empty: t('swipe.dropEmpty'),
      items: folderData.folders.length || folderData.team.length
        ? [
            ...flattenTree(folderData.team).map(({ folder: f, depth }) => ({ id: f.id, name: depth === 0 ? `${f.name} · ${t('lines.teamFolders')}` : f.name, depth })),
            ...flattenTree(folderData.folders).map(({ folder: f, depth }) => ({ id: f.id, name: f.name, depth })),
            { id: 'none', name: t('lines.unfiled'), depth: 0 },
          ]
        : [],
    },
  });

  /** Una fila de la lista (también en los resultados de búsqueda). */
  function renderRow(c: ChatDto, opts: { snippet?: boolean } = {}) {
    // El chat que se deja muestra su borrador ya, desde el clic (sin esperar a que el otro termine de abrir).
    const draft = c.id !== (switchingTo ?? current) ? readDraft(me, c.id) : '';
    const showCheck = selectMode || visibleSelected.length > 0;
    // El mismo chat en varias líneas es una sola fila: está abierta si el chat abierto es el de cualquiera de ellas.
    const isOpen = c.id === current || Boolean(current && c.lines?.some((l) => l.chatId === current));
    // Un punto por cada línea con color en la que está el chat (Ajustes › Números).
    const dots = (c.lines?.length ? c.lines.map((l) => ({ id: l.lineId, name: l.name, color: lineColors.get(l.lineId) || l.color || '' })) : [{ id: c.numberId, name: lineNames.get(c.numberId) ?? '', color: lineColors.get(c.numberId) ?? '' }]).filter((d) => d.color);
    return (
      <li
        key={`${opts.snippet ? 'm' : 'c'}-${c.id}`}
        className={`gr-row-item${c.muted ? ' is-muted' : ''}`}
        data-testid="chat-row"
        data-tour="lines-chat-row"
        data-chat-id={c.id}
        data-lines={c.lines?.length ? c.lines.length : undefined}
        data-overdue={c.flagged ? 'true' : undefined}
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
          className={`gr-row${isOpen ? ' is-active' : ''}${c.unread > 0 ? ' is-unread' : ''}`}
          aria-current={isOpen ? 'page' : undefined}
          title={c.lines?.length ? c.lines.map((l) => l.name).join(' · ') : undefined}
          draggable={false}
        >
          {/* Vencido: lo dice el reloj junto a la hora. El filete al borde se sacó: con muchos chats vencidos marcaba casi toda la lista. */}
          <Avatar name={c.name} kind={c.kind} src={c.pictureUrl} seed={c.id} />
          <span className="gr-row-main">
            <span className="gr-row-top">
              <span className="gr-row-name">{debounced && !opts.snippet ? <Highlight text={c.name} q={debounced} /> : c.name}</span>
              {dots.length > 0 && (
                <span className="gr-line-dots" data-testid="row-line-dots">
                  {dots.slice(0, 4).map((d) => (
                    <LineDot key={d.id} color={d.color} label={d.name} />
                  ))}
                </span>
              )}
              {/* Vencido o esperando: un reloj chico junto a la hora (rojo o ámbar), con el detalle al pasar el mouse. No suma una fila. */}
              <span
                className={`gr-row-time${c.unread > 0 ? ' is-unread' : ''}${c.flagged ? ' is-overdue' : c.awaitingSince ? ' is-waiting' : ''}`}
                title={c.flagged ? t('inbox.flaggedHint', { time: c.awaitingSince ? rel(c.awaitingSince) : '' }) : c.awaitingSince ? t('inbox.waiting', { time: rel(c.awaitingSince) }) : undefined}
              >
                {(c.flagged || c.awaitingSince) && <ClockIcon size={13} label={c.flagged ? t('inbox.flagged') : t('inbox.waiting', { time: rel(c.awaitingSince!) })} />}
                {listTime(c.lastMessageAt ?? c.createdAt, locale)}
              </span>
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
                ) : decodeSysPreview(c.lastMessagePreview) ? (
                  <span className="gr-row-sys">{sysText(decodeSysPreview(c.lastMessagePreview)!)}</span>
                ) : c.lastKind === 'deleted' || c.lastMessagePreview === '[deleted]' ? (
                  <span className="gr-row-deleted">
                    <Ban size={14} /> {c.lastDirection === 'out' ? t('wa.youDeleted') : t('wa.deletedMessage')}
                  </span>
                ) : (
                  <>
                    {c.lastDirection === 'out' && c.lastStatus && c.lastStatus !== 'received' && <Ticks status={c.lastStatus} label={t(c.lastStatus === 'read' && c.readHidden ? 'status.readHidden' : `status.${c.lastStatus}`)} />}
                    {c.kind === 'group' && c.lastDirection === 'in' && c.lastSender && <span className="gr-row-sender">{nameOrPhone(c.lastSender)}:</span>}
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
                {c.keepArchived && c.archived && <ArchiveIcon size={16} label={t('wa.keptArchived')} className="wa-row-kept" />}
                {c.snoozedUntil && (
                  <span className="gr-row-snoozed" data-testid="lines-row-snoozed" title={t('snooze.until', { when: longWhen(c.snoozedUntil, locale) })}>
                    <ClockIcon size={16} label={t('snooze.until', { when: longWhen(c.snoozedUntil, locale) })} />
                  </span>
                )}
                {/* Como WhatsApp: en la búsqueda (que también trae lo archivado), "Archivado" a la derecha. */}
                {debounced && !archivedView && c.archived && (
                  <span className="wa-archived-tag" data-testid="search-archived-tag">
                    {t('wa.archivedTag')}
                  </span>
                )}
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
            {(c.labels.length > 0 || c.assignedTo || c.hubspotName || (manyLines && numbers.length > 1)) && (
              <span className="gr-row-meta">
                {manyLines && numbers.length > 1 && lineNames.get(c.numberId) && <LineBadge name={lineNames.get(c.numberId) as string} />}
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
  // Fila "Archivados" arriba de la lista (como WhatsApp), solo en la vista común. También con solo eliminados: ahí adentro está "Eliminados".
  const archivedRow =
    !archivedView && !debounced && !activeList && isEmptyFilters(filters) && (archivedInfo.total > 0 || hiddenTotal > 0) ? (
      <button type="button" className="wa-archived-row" onClick={() => setArchivedView(true)}>
        <span className="wa-archived-icon">
          <ArchiveIcon size={20} />
        </span>
        <span className="wa-archived-label">{t('wa.archivedTitle')}</span>
        {archivedInfo.unread > 0 && <span className="wa-archived-count">{archivedInfo.unread}</span>}
      </button>
    ) : null;
  const agentsRowEl = agentsRow && !archivedView && !debounced && !activeList && isEmptyFilters(filters) ? <AgentsRow {...agentsRow} /> : null;
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
      { id: 'favorite', type: 'bool', category: 'status', label: t('fp.favorite'), keywords: t('fp.kw.favorite') },
      { id: 'vip', type: 'bool', category: 'status', label: t('fp.vip'), help: t('fp.help.vip'), keywords: t('fp.kw.vip') },
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
    : deletedView
      ? t('wa.deletedEmpty')
      : archivedView
      ? t('wa.archivedEmpty')
      : folderSel === 'none' && countFilters(filters) === 0
        ? t('lines.unfiledEmpty')
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
      <div className={`gr-inbox${current ? ' has-chat' : ''}${detailsHidden ? ' is-details-hidden' : ''}${kanban ? ' is-kanban' : ''}`} data-chat-style={chatStyle}>
        <section className="gr-list" aria-label={t('inbox.listLabel')}>
          <div className="gr-list-head">
            {banner}
            {bandSlot ? (
              <>
                {createPortal(
                  <>
                    <LineSelector numbers={numbers} groups={lineGroups} value={line} onChange={pickLine} />
                    <KanbanToggle on={kanban} onChange={setKanban} />
                  </>,
                  bandSlot,
                )}
                {/* Una lista guardada sí conserva su nombre: la miga dice solo "Bandeja". */}
                {activeList && (
                  <div className="gr-list-titlebar">
                    <h1 className="gr-list-title">{activeList.name}</h1>
                  </div>
                )}
              </>
            ) : (
              <div className="gr-list-titlebar">
                <h1 className="gr-list-title">{activeList ? activeList.name : t('inbox.title')}</h1>
                <LineSelector numbers={numbers} groups={lineGroups} value={line} onChange={pickLine} />
                <KanbanToggle on={kanban} onChange={setKanban} />
                <button type="button" className="wa-icon-btn gr-newchat-open" onClick={() => setNewChat(true)} aria-label={t('newChat.open')} title={t('newChat.open')}>
                  <Plus size={20} />
                </button>
              </div>
            )}
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
            {!archivedView && !sideBranch && !railBranch && <FolderSelect folders={folderData.folders} team={folderData.team} value={folderSel} onChange={pickFolder} />}
            {!archivedView && (sideBranch || railBranch) && folderSel && folderName && (
              <p className="gr-folder-current" data-testid="lines-folder-current">
                <span className="gr-folder-name">{folderName}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pickFolder('')}>
                  {t('lines.allChats')}
                </button>
              </p>
            )}
            <div className="wa-search-row" ref={searchRow}>
            <span className="wa-search" data-tour="lines-search">
              <Search size={18} />
            <DebouncedInput
              ref={searchRef}
              className="input gr-search"
              type="search"
              value={q}
              delay={250}
              clearOnEscape={false}
              clearLabel={t('wa.clearSearch')}
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
            <div ref={filtersEdges} className="gr-filters" role="tablist" aria-multiselectable="true" aria-label={t('inbox.filters')} data-tour="lines-filters">
              {LINES_TABS.map((tab) => {
                const on = tabsOn.includes(tab);
                return (
                  <button key={tab} type="button" role="tab" aria-selected={on} className={`gr-filter${on ? ' is-on' : ''}`} data-testid={`lines-tab-${tab}`} onClick={() => setFilters((f) => applyTab(f, tab))}>
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
          {dropped.filter((n) => inLine(n.id) && !importsClosed.includes(`drop:${n.id}`)).map((n) => (
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
          {archivedView && !deletedView && (
            <div className="wa-archived-head">
              <button
                type="button"
                className="wa-icon-btn"
                onClick={() => {
                  setArchivedView(false);
                  setDeletedView(false);
                }}
                aria-label={t('thread.back')}
                title={t('thread.back')}
              >
                <ArrowLeft size={22} />
              </button>
              <h3>{t('wa.archivedTitle')}</h3>
            </div>
          )}
          {/* "Eliminados": adentro de Archivados, solo si hay alguno. */}
          {archivedView && !deletedView && !debounced && hiddenTotal > 0 && (
            <button type="button" className="wa-archived-row wa-deleted-row" onClick={() => setDeletedView(true)} data-testid="lines-deleted-entry">
              <span className="wa-archived-icon">
                <Trash size={20} />
              </span>
              <span className="wa-archived-label">{t('wa.deletedTitle')}</span>
              <span className="wa-archived-count">{hiddenTotal}</span>
            </button>
          )}
          {deletedView && (
            <>
              <div className="wa-archived-head">
                <button type="button" className="wa-icon-btn" onClick={() => setDeletedView(false)} aria-label={t('thread.back')} title={t('thread.back')} data-testid="lines-deleted-back">
                  <ArrowLeft size={22} />
                </button>
                <h3>{t('wa.deletedTitle')}</h3>
              </div>
              <p className="wa-deleted-note">{t('wa.deletedNote')}</p>
            </>
          )}
          {/* Con una línea o un grupo de líneas elegido, solo sus avisos. */}
          <LinesImportNotices imports={imports.filter((im) => inLine(im.numberId))} line="all" />
          {/* Resumen del día (lib/daily-brief.ts): en la bandeja, sin búsqueda; se cierra por hoy. */}
          {!archivedView && !deletedView && !debounced && (
            <DailyBrief
              endpoint="/api/groups/brief"
              onOpen={(kind, chats) => {
                if (kind === 'waiting') setFilters({ waiting: 'yes', assignees: [ME] });
                else if (kind === 'groups') setFilters({ waiting: 'yes', kinds: ['group'], assignees: [NONE] });
                else if (kind === 'sla' || kind === 'tickets') router.push('/app/lines/tickets');
                else if (kind === 'tasks') router.push('/app/lines/tasks');
                else if (chats[0]) router.push(`/app/lines/inbox/${chats[0].id}${listSuffix}`);
              }}
            />
          )}
          {error && (
            <div className="gr-error" role="alert">
              {t('inbox.loadError')}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load(false)}>
                {t('common.retry')}
              </button>
            </div>
          )}
          {kanban ? (
            <>
              {agentsRowEl}
              {archivedRow}
              <InboxKanban query={query} listRows={rows} current={current} listSuffix={listSuffix} numbers={numbers} people={people} manyLines={manyLines && numbers.length > 1} emptyText={emptyText} />
            </>
          ) : !loaded ? (
            <div className="ui-loading-stack gr-list-loading" aria-busy="true" aria-label={t('common.loading')}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="ui-skeleton ui-skeleton-row" />
              ))}
            </div>
          ) : rows.length === 0 && !error ? (
            <>
              {agentsRowEl}
              {archivedRow}
              <p className="gr-list-empty">{emptyText}</p>
            </>
          ) : (
            <ul ref={rowsBox} className={`gr-rows${visibleSelected.length > 0 || selectMode ? ' is-selecting' : ''}${switching ? ' is-stale' : ''}`} aria-busy={switching || undefined} data-list={shownKey} data-chat-list data-tour="lines-chat-list">
              {agentsRowEl && <li>{agentsRowEl}</li>}
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
            // Deshacer: el chat vuelve a la lista con su historial (fijado y archivado no, como "Eliminar chat" en WhatsApp).
            showToast(t('wa.chatDeleted'), false, { label: t('swipe.undo'), onClick: () => void rowAction(c, { hidden: false }) });
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
      <NewChatDialog open={newChat} onClose={() => setNewChat(false)} line={lineGroup ? 'all' : line} suffix={listSuffix} />
      <MoveToFolderModal
        open={!!moveIds}
        folders={folderData.folders}
        team={folderData.team}
        value={moveIds?.length === 1 ? (rowsRef.current.find((r) => r.id === moveIds[0])?.folderId ?? null) : undefined}
        teamValue={moveIds?.length === 1 ? (rowsRef.current.find((r) => r.id === moveIds[0])?.teamFolderId ?? null) : undefined}
        onClose={() => setMoveIds(null)}
        onPick={(folderId, name, scope) => {
          const ids = moveIds ?? [];
          setMoveIds(null);
          if (!folderId) unfile(ids, scope === 'team');
          else void moveToFolder(ids, folderId, name, scope);
        }}
      />
      <ConfirmDialog
        open={!!unfileAsk}
        title={t('lines.unfileTeamTitle', { name: unfileAsk?.name ?? '' })}
        body={unfileAsk?.team ? t('lines.unfileTeamOnlyBody', { n: unfileAsk.ids.length }) : t('lines.unfileTeamBody', { n: unfileAsk?.ids.length ?? 1 })}
        confirmLabel={t('lines.unfileTeamYes')}
        cancelLabel={t('lines.unfileTeamNo')}
        danger
        onConfirm={() => {
          const ask = unfileAsk;
          setUnfileAsk(null);
          if (ask) void moveToFolder(ask.ids, null, undefined, ask.team ? 'team' : 'all');
        }}
        onCancel={() => {
          const ask = unfileAsk;
          setUnfileAsk(null);
          // No: lo propio igual sale (lo que pidió al soltarlo en "Sin carpeta"); la carpeta del equipo queda.
          if (ask && !ask.team && ask.ids.some((id) => rowsRef.current.find((r) => r.id === id)?.folderId)) void moveToFolder(ask.ids, null, undefined, 'personal');
        }}
      />
      <WhenDialog
        open={!!snoozeFor}
        title={t('snooze.title')}
        mode="snooze"
        labels={snoozeLabels}
        onPick={(iso) => {
          const c = snoozeFor;
          setSnoozeFor(null);
          if (c) void snoozeChat(c, iso);
        }}
        onClose={() => setSnoozeFor(null)}
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
