'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, ChatFilter, GroupsPerson, LabelDto, PropertyDef } from '@/lib/groups';
import type { SavedListDto, SavedListFilters } from '@/lib/groups-org';
import { LISTS_CHANGED, notifyListsChanged } from './GroupsListsBranch';
import { filterOptions } from './PropertyInput';
import { LabelTag, Modal, api, markChatSwitch, useErrorText, useMediaText, useRelativeTime, useToast } from './ui';
import Avatar from './wa/Avatar';
import { duration, listTime } from './wa/format';
import { plainWa } from './wa/rich';
import { ArchiveIcon, ArrowLeft, Ban, CheckIcon, Chevron, FilterIcon, Mic, MuteIcon, PinIcon, Search, Ticks } from './wa/icons';
import { longPress } from './wa/longPress';
import { MessageMenu, type MenuItem } from './ThreadParts';
import type { ImportStatus } from '@/lib/groups-import';
import { useChatStyle } from '@/components/chat-style/ChatStyle';
import type { LineFolderDto } from '@/lib/groups-lines';
import { DRAG_TYPE, FoldersPanel, LineBadge, LineSelector, MoveToFolderModal, type LineOption } from './LineFolders';
import PanelSplitters from './PanelSplitters';

const FILTERS: ChatFilter[] = ['all', 'unread', 'unanswered', 'flagged', 'mine', 'unassigned', 'closed'];
/** Pestañas de la lista, como WhatsApp (Todos, No leídos, Grupos) y después las del equipo. */
const CHIPS: Array<ChatFilter | 'groups'> = ['all', 'unread', 'groups', 'unanswered', 'mine', 'unassigned', 'flagged', 'closed'];

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

interface Controls {
  filter: ChatFilter;
  label: string;
  kind: string;
  assignee: string;
  /** Equipo asignado (filtro de la bandeja; no se guarda en las listas). */
  team: string;
  propKey: string;
  propValue: string;
  q: string;
}

const EMPTY: Controls = { filter: 'all', label: '', kind: '', assignee: '', team: '', propKey: '', propValue: '', q: '' };

function readSaved(): Partial<Controls> | null {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    if (!raw) return null;
    const v = JSON.parse(raw) as { filter?: string; label?: string; kind?: string; assignee?: string; team?: string };
    return {
      filter: FILTERS.includes(v.filter as ChatFilter) ? (v.filter as ChatFilter) : 'all',
      label: typeof v.label === 'string' ? v.label : '',
      kind: v.kind === 'group' || v.kind === 'dm' ? v.kind : '',
      assignee: typeof v.assignee === 'string' ? v.assignee : '',
      team: typeof v.team === 'string' ? v.team : '',
    };
  } catch {
    return null;
  }
}

/** Los controles de la bandeja ↔ los filtros de una lista guardada. */
export function controlsToFilters(c: Controls): SavedListFilters {
  const f: SavedListFilters = {};
  if (c.filter !== 'all') f.filter = c.filter;
  if (c.q.trim()) f.q = c.q.trim();
  if (c.label) f.labelIds = [c.label];
  if (c.assignee) f.assignee = c.assignee;
  if (c.kind === 'dm' || c.kind === 'group') f.kind = c.kind;
  if (c.propKey) f.props = [c.propValue ? { key: c.propKey, op: 'is', value: c.propValue } : { key: c.propKey, op: 'set' }];
  return f;
}

export function filtersToControls(f: SavedListFilters): Controls {
  const p = f.props?.[0];
  return {
    filter: f.filter ?? 'all',
    label: f.labelIds?.[0] ?? '',
    kind: f.kind ?? '',
    assignee: f.assignee ?? '',
    team: '',
    propKey: p?.key ?? '',
    propValue: p?.op === 'is' ? (p.value ?? '') : '',
    q: f.q ?? '',
  };
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
  const [pageSize, setPageSize] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null);
  const lastQuery = useRef('');
  const rowsRef = useRef<ChatDto[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name || p.email])), [people]);
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const listId = params.get('list');
  const current = chatIdFromPath(pathname);
  const [line, setLine] = useState(numbers.some((n) => n.id === initialLine) ? initialLine : 'all');
  const [folderSel, setFolderSel] = useState('');
  const [folderData, setFolderData] = useState<{ folders: LineFolderDto[]; unfiled: { unread: number; chats: number } }>({ folders: [], unfiled: { unread: 0, chats: 0 } });
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const lineNames = useMemo(() => new Map(numbers.map((n) => [n.id, n.name])), [numbers]);
  const [controls, setControls] = useState<Controls>(EMPTY);
  const { filter, label, kind, assignee, team, propKey, propValue, q } = controls;
  const set = (patch: Partial<Controls>) => setControls((c) => ({ ...c, ...patch }));
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<ChatDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [lists, setLists] = useState<SavedListDto[]>(initialLists);
  const [saving, setSaving] = useState<'new' | 'rename' | null>(null);
  const [removing, setRemoving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const activeList = lists.find((l) => l.id === listId) ?? null;

  useEffect(() => {
    void api<{ me: boolean }>('/api/groups/availability').then((r) => setAvailable(r.data ? r.data.me : true));
    if (listId) return;
    const saved = readSaved();
    if (saved) {
      setControls((c) => ({ ...c, ...saved }));
      if (saved.assignee || saved.team) setMoreOpen(true);
    }
    // Solo al entrar: una lista abierta manda sobre lo guardado en la pestaña.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Abrir una lista carga sus filtros (también al volver a la misma desde el sidebar).
  useEffect(() => {
    if (!activeList) return;
    const c = filtersToControls(activeList.filters);
    setControls(c);
    setDebounced(c.q.trim());
    if (c.assignee || c.propKey) setMoreOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeList?.id, activeList?.updatedAt]);
  useEffect(() => {
    if (listId) return;
    try {
      window.sessionStorage.setItem(STORE, JSON.stringify({ filter, label, kind, assignee, team }));
    } catch {
      // Sin storage: los filtros duran lo que dura la página.
    }
  }, [filter, label, kind, assignee, team, listId]);
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

  const query = useMemo(() => {
    const p = new URLSearchParams({ filter, limit: String(pageSize) });
    if (archivedView) p.set('archived', '1');
    if (line !== 'all') p.set('number', line);
    if (folderSel) p.set('folder', folderSel);
    if (debounced) p.set('q', debounced);
    if (label) p.set('label', label);
    if (kind) p.set('kind', kind);
    if (assignee) p.set('assignee', assignee);
    if (team) p.set('team', team);
    if (propKey) p.set('props', JSON.stringify([propValue ? { key: propKey, op: 'is', value: propValue } : { key: propKey, op: 'set' }]));
    return p.toString();
  }, [filter, debounced, label, kind, assignee, team, propKey, propValue, pageSize, archivedView, line, folderSel]);

  const load = useCallback(
    async (silent: boolean) => {
      const mine = ++seq.current;
      if (!silent) setError(false);
      try {
        const res = await fetch(`/api/groups/chats?${query}`);
        if (!res.ok) throw new Error('failed');
        const data = (await res.json()) as {
          rows: ChatDto[];
          total: number;
          imports?: ImportStatus[];
          unreadChats?: number;
          archived?: { total: number; unread: number };
          dropped?: DroppedNumber[];
        };
        if (mine !== seq.current) return;
        if (filter === 'unread' && lastQuery.current === query && current && !data.rows.some((r) => r.id === current)) {
          const prevIdx = rowsRef.current.findIndex((r) => r.id === current);
          if (prevIdx >= 0) data.rows.splice(Math.min(prevIdx, data.rows.length), 0, { ...rowsRef.current[prevIdx], unread: 0, markedUnread: false });
        }
        lastQuery.current = query;
        rowsRef.current = data.rows;
        setRows(data.rows);
        setTotal(data.total);
        setImports(data.imports ?? []);
        if (data.archived) setArchivedInfo(data.archived);
        setDropped(data.dropped ?? []);
        if (typeof data.unreadChats === 'number') setUnreadTotal(data.unreadChats);
        setError(false);
      } catch {
        if (mine === seq.current && !silent) setError(true);
      } finally {
        if (mine === seq.current) setLoaded(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, current],
  );

  useEffect(() => {
    void load(false);
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 5000);
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
  }, [load]);

  const reloadFolders = useCallback(async () => {
    const r = await api<{ folders: LineFolderDto[]; unfiled: { unread: number; chats: number } }>('/api/groups/folders');
    if (r.data) setFolderData(r.data);
  }, []);
  useEffect(() => {
    void reloadFolders();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadFolders();
    }, 10000);
    return () => clearInterval(id);
  }, [reloadFolders]);

  function pickLine(v: string) {
    setLine(v);
    setPageSize(100);
    void api('/api/groups/prefs', { method: 'PUT', body: { line: v } });
  }

  async function moveToFolder(ids: string[], folderId: string | null) {
    const res = await api<{ updated: number; failed: number }>('/api/groups/chats/bulk', { body: { ids, action: 'folder', folderId } });
    if (!res.data) return showToast(errText(res.error), true);
    const name = folderId ? (folderData.folders.find((f) => f.id === folderId)?.name ?? '') : '';
    showToast(folderId ? t('lines.movedTo', { n: res.data.updated, name }) : t('lines.removedFromFolder', { n: res.data.updated }), res.data.failed > 0);
    setSelected(new Set());
    void load(true);
    void reloadFolders();
  }

  const refresh = useCallback(() => void load(true), [load]);

  const go = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === current);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
      if (next) {
        markChatSwitch(next.id);
        router.push(`/app/lines/inbox/${next.id}${listId ? `?list=${listId}` : ''}`);
      }
    },
    [rows, current, router, listId],
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

  function rowMenu(c: ChatDto): MenuItem[] {
    return [
      {
        key: 'archive',
        label: c.archived ? t('wa.unarchive') : t('wa.archive'),
        onSelect: () => {
          void rowAction(c, { archived: !c.archived }).then(() => showToast(c.archived ? t('wa.unarchived') : t('wa.archived')));
        },
      },
      { key: 'close', label: c.status === 'open' ? t('wa.closeChat') : t('thread.reopen'), onSelect: () => void rowAction(c, { status: c.status === 'open' ? 'closed' : 'open' }) },
      { key: 'mute', label: c.muted ? t('wa.unmute') : t('wa.mute'), onSelect: () => void rowAction(c, { muted: !c.muted }) },
      { key: 'pin', label: c.pinned ? t('thread.unpinChat') : t('thread.pinChat'), onSelect: () => void rowAction(c, { pinned: !c.pinned }) },
      { key: 'unread', label: c.unread > 0 ? t('thread.markRead') : t('thread.markUnread'), onSelect: () => void rowAction(c, { read: c.unread > 0 }) },
      { key: 'assign', label: c.assignedTo === me ? t('wa.unassignMe') : t('wa.assignMe'), onSelect: () => void rowAction(c, { assignedTo: c.assignedTo === me ? null : me }) },
      { key: 'folder', label: t('lines.moveToFolder'), onSelect: () => setMoveIds([c.id]) },
      { key: 'hide', label: t('wa.deleteChat'), danger: true, divider: true, onSelect: () => setHiding(c) },
    ];
  }

  /** Una fila de la lista (también en los resultados de búsqueda). */
  function renderRow(c: ChatDto, opts: { snippet?: boolean } = {}) {
    const draft = c.id !== current ? readDraft(c.id) : '';
    const showCheck = selectMode || visibleSelected.length > 0;
    return (
      <li
        key={`${opts.snippet ? 'm' : 'c'}-${c.id}`}
        className={`gr-row-item${c.muted ? ' is-muted' : ''}`}
        draggable={!showCheck}
        onDragStart={(e) => {
          const ids = selected.has(c.id) ? [...selected] : [c.id];
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onContextMenu={(e) => {
          if (showCheck) return;
          e.preventDefault();
          e.currentTarget.querySelector<HTMLButtonElement>('.wa-row-chevron')?.click();
        }}
        {...longPress((el) => el.querySelector<HTMLButtonElement>('.wa-row-chevron')?.click())}
      >
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
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && c.id !== current) markChatSwitch(c.id);
          }}
          className={`gr-row${c.id === current ? ' is-active' : ''}${c.unread > 0 ? ' is-unread' : ''}`}
          aria-current={c.id === current ? 'page' : undefined}
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
            {(c.flagged || c.awaitingSince || c.labels.length > 0 || c.assignedTo || (line === 'all' && numbers.length > 1)) && (
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
                {c.assignedTo && <span className="gr-row-assignee">{peopleById.get(c.assignedTo) ?? ''}</span>}
              </span>
            )}
          </span>
        </Link>
        {!showCheck && (
          <span className="gr-row-menu">
            <MessageMenu label={t('wa.chatOptions', { name: c.name })} items={rowMenu(c)} trigger={<Chevron size={20} />} className="wa-row-chevron" align="right" />
          </span>
        )}
      </li>
    );
  }
  // Fila "Archivados" arriba de la lista (como WhatsApp), solo en la vista común.
  const archivedRow =
    !archivedView && !debounced && !activeList && filter === 'all' && archivedInfo.total > 0 ? (
      <button type="button" className="wa-archived-row" onClick={() => setArchivedView(true)}>
        <span className="wa-archived-icon">
          <ArchiveIcon size={20} />
        </span>
        <span className="wa-archived-label">{t('wa.archivedTitle')}</span>
        {archivedInfo.unread > 0 && <span className="wa-archived-count">{archivedInfo.unread}</span>}
      </button>
    ) : null;
  const filters = controlsToFilters({ ...controls, q: debounced });
  const dirty = activeList ? JSON.stringify(filters) !== JSON.stringify(activeList.filters) : false;
  const canEditList = activeList ? activeList.ownerId === me || activeList.shared : false;
  const propDef = properties.find((p) => p.key === propKey) ?? null;
  const propOpts = propDef ? filterOptions(propDef) : [];
  const listSuffix = listId ? `?list=${listId}` : '';
  // Filtros del panel (fuera de las pestañas) que están puestos: el botón lo marca.
  const extraFilters = [kind, label, assignee, team, propKey].filter(Boolean).length;

  async function saveChanges() {
    if (!activeList) return;
    const r = await api<SavedListDto>(`/api/groups/lists/${activeList.id}`, { method: 'PATCH', body: { filters } });
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
    router.push(current ? `/app/lines/inbox/${current}` : '/app/lines/inbox');
  }

  return (
    <Ctx.Provider value={value}>
      <div className={`gr-inbox${current ? ' has-chat' : ''}`} data-chat-style={chatStyle}>
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
                  className={`gr-view${!listId ? ' is-on' : ''}`}
                  aria-current={!listId ? 'page' : undefined}
                  onClick={() => setControls(EMPTY)}
                >
                  {t('lists.allChats')}
                </Link>
                {lists.map((l) => (
                  <Link
                    key={l.id}
                    href={`/app/lines/inbox${current ? `/${current}` : ''}?list=${l.id}`}
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
            {!archivedView && (
              <FoldersPanel
                folders={folderData.folders}
                unfiled={folderData.unfiled}
                selected={folderSel}
                onSelect={setFolderSel}
                onChanged={() => {
                  void reloadFolders();
                  void load(true);
                }}
                onDropChats={(ids, folderId) => void moveToFolder(ids, folderId)}
              />
            )}
            <div className="wa-search-row">
            <span className="wa-search">
              <Search size={18} />
            <input
              ref={searchRef}
              className="input gr-search"
              type="search"
              value={q}
              onChange={(e) => set({ q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
              }}
              placeholder={t('inbox.searchPlaceholder')}
              aria-label={t('inbox.search')}
            />
            </span>
            <button
              type="button"
              className={`wa-icon-btn wa-filter-btn${moreOpen ? ' is-on' : ''}`}
              aria-expanded={moreOpen}
              aria-controls="wa-filter-panel"
              aria-label={t('wa.filtersMenu')}
              title={t('wa.filtersMenu')}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <FilterIcon size={20} />
              {extraFilters > 0 && <span className="wa-filter-dot" aria-hidden="true" />}
            </button>
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
            <div className="gr-filters" role="tablist" aria-label={t('inbox.filters')}>
              {CHIPS.map((f) => {
                const on = f === 'groups' ? filter === 'all' && kind === 'group' : f === 'all' ? filter === 'all' && kind !== 'group' : filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className={`gr-filter${on ? ' is-on' : ''}`}
                    onClick={() => (f === 'groups' ? set({ filter: 'all', kind: 'group' }) : set({ filter: f, kind: kind === 'group' ? '' : kind }))}
                  >
                    {t(`filters.${f}`)}
                  </button>
                );
              })}
            </div>
            {moreOpen && (
            <div className="wa-filter-panel" id="wa-filter-panel">
            <div className="gr-list-selects">
              <select className="select" value={kind} onChange={(e) => set({ kind: e.target.value })} aria-label={t('inbox.kind')}>
                <option value="">{t('inbox.kindAll')}</option>
                <option value="group">{t('inbox.kindGroups')}</option>
                <option value="dm">{t('inbox.kindDms')}</option>
              </select>
              <select className="select" value={label} onChange={(e) => set({ label: e.target.value })} aria-label={t('inbox.label')}>
                <option value="">{t('inbox.labelAll')}</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
              <div className="gr-list-selects">
                <select className="select" value={assignee} onChange={(e) => set({ assignee: e.target.value })} aria-label={t('lists.assignee')}>
                  <option value="">{t('tickets.anyone')}</option>
                  <option value="me">{t('tickets.mine')}</option>
                  <option value="none">{t('thread.unassigned')}</option>
                  {people
                    .filter((p) => p.id !== me)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.email}
                      </option>
                    ))}
                </select>
                {teams.length > 0 && (
                  <select className="select" value={team} onChange={(e) => set({ team: e.target.value })} aria-label={t('inbox.team')}>
                    <option value="">{t('inbox.teamAll')}</option>
                    {teams.map((tm) => (
                      <option key={tm.id} value={tm.id}>
                        {tm.name}
                      </option>
                    ))}
                  </select>
                )}
                {properties.length > 0 && (
                  <select className="select" value={propKey} onChange={(e) => set({ propKey: e.target.value, propValue: '' })} aria-label={t('lists.property')}>
                    <option value="">{t('lists.anyProperty')}</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
                {propDef &&
                  (propOpts.length > 0 ? (
                    <select className="select" value={propValue} onChange={(e) => set({ propValue: e.target.value })} aria-label={t('lists.propertyValue')}>
                      <option value="">{t('lists.hasValue')}</option>
                      {propOpts.map((o) => (
                        <option key={o} value={o}>
                          {o === 'true' && propDef.type === 'checkbox' ? t('props.yes') : o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      value={propValue}
                      onChange={(e) => set({ propValue: e.target.value })}
                      placeholder={t('lists.hasValue')}
                      aria-label={t('lists.propertyValue')}
                    />
                  ))}
              </div>
            <div className="gr-list-save">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ kind: '', label: '', assignee: '', team: '', propKey: '', propValue: '' })} disabled={extraFilters === 0}>
                {t('wa.clearFilters')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving('new')}>
                {t('lists.save')}
              </button>
            </div>
            </div>
            )}
          </div>
          {visibleSelected.length > 0 && (
            <div className="gr-bulkbar" role="toolbar" aria-label={t('bulkInbox.label')}>
              <span className="gr-bulkbar-count">{t('bulkInbox.selected', { n: visibleSelected.length })}</span>
              {filter === 'closed' ? (
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
          {dropped.map((n) => (
            <div key={n.id} className="wa-import is-bad wa-dropped" role="alert">
              <span>{t('wa.lineDropped', { name: n.name || (n.phone ? `+${n.phone}` : t('wa.line')) })}</span>
              <Link className="btn btn-secondary btn-sm" href={`/app/lines/settings?tab=numbers&reconnect=${n.id}`}>
                {n.qr ? t('wa.rescan') : t('wa.reconnect')}
              </Link>
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
          {imports.map((im) => (
            <div key={im.numberId} className={`wa-import${im.status === 'error' ? ' is-bad' : im.status === 'done' ? ' is-done' : ''}`} role="status">
              <span>
                {im.status === 'done'
                  ? im.messages === 0
                    ? t('wa.importNothingNew', { chats: im.chatsTotal })
                    : t('wa.importDone', { chats: im.chatsTotal, messages: im.messages })
                  : im.status === 'error'
                    ? t('wa.importFailed')
                    : im.phase === 'messages' || im.phase === 'pictures'
                      ? t('wa.importMessages', { done: im.chatsDone, total: im.chatsTotal })
                      : t('wa.importChats', { n: im.chatsTotal })}
              </span>
              {(im.status === 'queued' || im.status === 'running') && (
                <span className="wa-import-bar" role="progressbar" aria-label={t('wa.importProgress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={im.chatsTotal ? Math.round((im.chatsDone / im.chatsTotal) * 100) : 0}>
                  <i style={{ width: `${im.chatsTotal ? Math.max(3, (im.chatsDone / im.chatsTotal) * 100) : 3}%` }} />
                </span>
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
              <p className="gr-list-empty">{debounced ? t('inbox.noResults') : archivedView ? t('wa.archivedEmpty') : activeList ? t('lists.empty') : t(`inbox.empty.${filter}`)}</p>
            </>
          ) : (
            <ul
              className={`gr-rows${visibleSelected.length > 0 || selectMode ? ' is-selecting' : ''}`}
              onScroll={(e) => {
                const el = e.currentTarget;
                // Más chats al llegar al final (de a 100, hasta 500 en pantalla).
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 400 && total > rows.length && pageSize < 500) setPageSize((n) => Math.min(500, n + 100));
              }}
            >
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
            </ul>
          )}
          {loaded && total > rows.length && <p className="ui-help gr-list-more">{t('inbox.showing', { shown: rows.length, total })}</p>}
        </section>
        {children}
        <PanelSplitters me={me} />
      </div>
      <SaveListModal
        mode={saving}
        list={activeList}
        filters={filters}
        onClose={() => setSaving(null)}
        onSaved={(l) => {
          setSaving(null);
          void reloadLists();
          notifyListsChanged();
          router.push(`/app/lines/inbox${current ? `/${current}` : ''}?list=${l.id}`);
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
