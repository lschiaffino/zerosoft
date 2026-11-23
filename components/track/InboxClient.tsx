'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  EMPTY_INBOX_FILTER,
  inboxFilterCount,
  inboxFilterParams,
  inboxGroupKey,
  parseInboxFilter,
  type InboxFilter,
  type InboxKind,
  type InboxReason,
  type InboxTab,
} from '@/lib/notification-inbox-filter';
import type { InboxCounts, InboxFacets, InboxIssue } from '@/lib/notification-inbox';
import InboxFilters from './InboxFilters';
import { Link, useRouter } from '@/i18n/navigation';
import { formatWhenShort, SNOOZE_PRESETS, snoozeAt, type SnoozePreset } from '@/lib/track-snooze';
import { Popover, StatusDot } from './InlineEditors';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { notificationTitle, type NotificationTextLabels } from '@/lib/notification-text';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/components/app/NotificationBell';
import { parseStoredDate } from '@/lib/track-status-time';
import TrackIcon, { type TrackIconName } from './TrackIcon';
import { useShortDuration } from './IssueRowProps';
import { isTextEntry } from './IssueFilters';
import { announceSubscription, TRACK_SUBSCRIPTION_EVENT } from './IssueSubscription';
import { pushNotice } from './trackUndo';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
  meta: string;
  source_type?: string | null;
  snoozed_until?: string | null;
  /** Lo que agrega /api/notifications/inbox para agrupar y explicar. */
  kind?: InboxKind;
  projectId?: string | null;
  projectName?: string | null;
  team?: string | null;
  actorName?: string | null;
  tab?: InboxTab;
  reason?: InboxReason;
  /** `subscribed`: si la persona sigue el issue (lo agrega la ruta de la bandeja). */
  issue?: (InboxIssue & { subscribed?: boolean }) | null;
}

/** Filtro, orden y agrupado guardados por persona en este navegador (la URL manda si trae alguno). */
const VIEW_KEY = 'zs:track-inbox-view';
const FILTER_PARAMS = ['read', 'kind', 'project', 'team', 'from', 'order', 'group'];

function readSavedFilter(): InboxFilter | null {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    return raw ? parseInboxFilter(new URLSearchParams(raw)) : null;
  } catch {
    return null;
  }
}

function saveFilter(f: InboxFilter) {
  try {
    const qs = inboxFilterParams(f).toString();
    if (qs) window.localStorage.setItem(VIEW_KEY, qs);
    else window.localStorage.removeItem(VIEW_KEY);
  } catch {
    /* sin storage: queda en la URL */
  }
}

/** Priority y Other (como la Priority inbox de Linear) y los pospuestos. */
const TABS = ['priority', 'other', 'snoozed'] as const;
type TabKey = (typeof TABS)[number];

/** La URL refleja la pestaña y el filtro (se puede compartir y sobrevive a recargar) sin navegar. */
function writeUrl(f: InboxFilter, tab: TabKey) {
  const url = new URL(window.location.href);
  [...FILTER_PARAMS, 'tab'].forEach((k) => url.searchParams.delete(k));
  if (tab !== 'priority') url.searchParams.set('tab', tab);
  inboxFilterParams(f).forEach((v, k) => url.searchParams.append(k, v));
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

/** El issue abierto en el panel (/app/track/inbox/<id>, con o sin idioma delante). */
function openIssueOf(pathname: string | null): string | null {
  const m = /\/app\/track\/inbox\/([^/?#]+)/.exec(pathname ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

interface InboxClientProps {
  /** El panel del aviso abierto (inbox/[issueId]), al lado de la lista. */
  children?: ReactNode;
  locale: string;
  labels: {
    title: string;
    empty: string;
    emptyBody: string;
    markAllRead: string;
    loadMore: string;
    unread: string;
    loading: string;
    loadError: string;
    retry: string;
    someone: string;
    mentionedYou: string;
    assignedYou: string;
    commentedOn: string;
    changedStatus: string;
    updatedIssue: string;
  };
}

const PAGE = 25;

const SNOOZE_LABEL: Record<SnoozePreset, 'inboxSnooze.hour' | 'inboxSnooze.tomorrow' | 'inboxSnooze.nextWeek'> = {
  hour: 'inboxSnooze.hour',
  tomorrow: 'inboxSnooze.tomorrow',
  nextWeek: 'inboxSnooze.nextWeek',
};

/** Ícono chico sobre el avatar: qué pasó. */
const REASON_ICON: Record<InboxReason, TrackIconName> = {
  assigned: 'assign',
  mentioned: 'at',
  commented: 'reply',
  status: 'check',
  priority: 'flag',
  updated: 'pencil',
  subissue: 'subtasks',
  relation: 'link',
  reminder: 'clock',
  triage: 'inbox',
  sla_risk: 'clock',
  sla_breach: 'clock',
  agent: 'refresh',
  project: 'plans',
  approval: 'check',
  other: 'bell',
};

/** Avisos que llegan por estar suscripto al issue: la línea gris lo dice. */
const VIA_SUBSCRIPTION = new Set<InboxReason>(['commented', 'status', 'priority', 'updated', 'subissue', 'relation']);

/** Menús abiertos en la página: mientras haya uno, las teclas son de él. */
const OPEN_MENU = '.track-menu, .cmdk, [role="menu"], [role="listbox"], [role="dialog"], dialog[open]';

function parseMeta(meta: string): Record<string, string> {
  try {
    const parsed = JSON.parse(meta);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase() || '?';
}

/** La campana del sidebar recarga su conteo (pospuestos y leídos dejan de contar). */
function notifyChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

function parseTab(v: string | null | undefined): TabKey {
  return (TABS as readonly string[]).includes(v ?? '') ? (v as TabKey) : 'priority';
}

/**
 * Bandeja de Track como la Priority inbox de Linear: Priority (te asignaron,
 * te mencionaron, algo espera tu acción, cambió el status o la prioridad de
 * algo que seguís; la regla está en lib/notification-inbox-filter.ts) y
 * Other (el resto), con avatar e ícono de la acción, una línea gris que dice
 * por qué llegó, y todo desde el teclado: J/K o flechas para moverse, Enter
 * abre, U marca leído o sin leer, H pospone, Backspace borra.
 */
export default function InboxClient({ locale, labels, children }: InboxClientProps) {
  const tr = useTranslations('track');
  const tp = useTranslations('trackPlanning');
  const tTriage = useTranslations('trackTriage');
  const ti = useTranslations('track.inbox');
  const short = useShortDuration();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Panel abierto: el issue (de la ruta) y el aviso (?n=) que lo abrió.
  const openIssue = openIssueOf(pathname);
  const openNote = openIssue ? (searchParams?.get('n') ?? null) : null;
  const [tab, setTab] = useState<TabKey>(() => parseTab(searchParams?.get('tab')));
  const [actionError, setActionError] = useState<string | null>(null);
  const [rows, setRows] = useState<Notification[]>([]);
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // Suscripción al issue cambiada desde la fila o el panel (encima de la que trajo el servidor).
  const [subs, setSubs] = useState<Record<string, boolean>>({});
  const request = useRef(0);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<InboxFilter>(() => parseInboxFilter(new URLSearchParams(searchParams?.toString() ?? '')));
  const [facets, setFacets] = useState<InboxFacets | null>(null);
  // Hasta mirar lo guardado no se pide nada (si no, la primera lista sería la sin filtro).
  const [ready, setReady] = useState(false);
  const filterKey = inboxFilterParams(filter).toString();

  useEffect(() => {
    const fromUrl = FILTER_PARAMS.some((k) => searchParams?.has(k));
    if (!fromUrl) {
      const saved = readSavedFilter();
      if (saved && inboxFilterParams(saved).toString()) {
        setFilter(saved);
        writeUrl(saved, tab);
      }
    } else {
      saveFilter(filter);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeFilter = (next: InboxFilter) => {
    setFilter(next);
    saveFilter(next);
    writeUrl(next, tab);
  };

  const changeTab = (next: TabKey) => {
    setTab(next);
    setActive(null);
    writeUrl(filter, next);
  };

  const load = useCallback(
    async (reset: boolean) => {
      const seq = ++request.current;
      setLoading(true);
      setError(false);
      const nextPage = reset ? 1 : page;
      const params = inboxFilterParams(filter);
      params.set('limit', String(PAGE));
      params.set('page', String(nextPage));
      if (tab === 'snoozed') params.set('snoozed', '1');
      else params.set('tab', tab);
      const res = await fetch(`/api/notifications/inbox?${params.toString()}`).catch(() => null);
      if (seq !== request.current) return;
      if (res?.ok) {
        const data = (await res.json()) as { rows: Notification[]; hasMore: boolean; facets: InboxFacets; counts?: InboxCounts };
        const newRows = data.rows ?? [];
        setRows((prev) => (reset ? newRows : [...prev, ...newRows]));
        // La suscripción de cada fila vuelve a ser la del servidor.
        if (reset) setSubs({});
        setHasMore(Boolean(data.hasMore));
        setFacets(data.facets ?? null);
        setCounts(data.counts ?? null);
        setPage(nextPage + 1);
      } else {
        setError(true);
      }
      setLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, page, filterKey],
  );

  useEffect(() => {
    if (!ready) return;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filterKey, ready]);

  /** Ajusta el contador de la pestaña del aviso (sin volver a pedir la lista). */
  const bump = (n: Notification, delta: number) => {
    const key = n.tab;
    if (!key) return;
    setCounts((c) => (c ? { ...c, [key]: Math.max(0, c[key] + delta) } : c));
  };

  // Un aviso con una acción en curso no recibe otra (U o Backspace dos veces seguidas).
  const busy = useRef(new Set<string>());

  async function setRead(n: Notification, read: boolean) {
    if (busy.current.has(n.id)) return;
    busy.current.add(n.id);
    setActionError(null);
    const res = await fetch(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read }),
    }).catch(() => null);
    busy.current.delete(n.id);
    if (!res?.ok) {
      setActionError(ti('actionError'));
      return;
    }
    const wasUnread = !n.read_at;
    setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: read ? (x.read_at ?? new Date().toISOString()) : null } : x)));
    if (tab !== 'snoozed') {
      if (read && wasUnread) bump(n, -1);
      if (!read && !wasUnread) bump(n, 1);
    }
    notifyChanged();
  }

  const activeRef = useRef(active);
  activeRef.current = active;

  /**
   * Sale de la lista ya (pospuesto o borrado), antes de que responda el
   * servidor; si falla, vuelve a su lugar. La fila activa pasa a la siguiente,
   * como Linear.
   */
  const dropRow = (n: Notification): (() => void) => {
    const i = rows.findIndex((x) => x.id === n.id);
    const next = rows.filter((x) => x.id !== n.id);
    setRows((prev) => prev.filter((x) => x.id !== n.id));
    if (activeRef.current === n.id) {
      const nextId = next[Math.min(i, next.length - 1)]?.id ?? null;
      setActive(nextId);
      // El foco sigue en la lista (si no, cae al body y J/K empiezan de cero).
      if (nextId) requestAnimationFrame(() => rowEl(nextId)?.querySelector<HTMLElement>('.track-inbox-link')?.focus({ preventScroll: true }));
    }
    return () => setRows((prev) => (prev.some((x) => x.id === n.id) ? prev : [...prev.slice(0, Math.max(0, i)), n, ...prev.slice(Math.max(0, i))]));
  };

  // Posponer (o traer de vuelta con null): sale de la lista actual.
  async function snooze(n: Notification, until: Date | null) {
    if (busy.current.has(n.id)) return;
    busy.current.add(n.id);
    setActionError(null);
    const undo = dropRow(n);
    const res = await fetch(`/api/notifications/${n.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snoozeUntil: until ? until.toISOString() : null }),
    }).catch(() => null);
    busy.current.delete(n.id);
    if (!res?.ok) {
      undo();
      setActionError(tr('inboxSnooze.error'));
      return;
    }
    // Posponer lo saca de la cuenta; traerlo de vuelta lo suma (vuelve como sin leer).
    if (until && tab !== 'snoozed' && !n.read_at) bump(n, -1);
    if (!until) bump(n, 1);
    notifyChanged();
  }

  async function remove(n: Notification) {
    if (busy.current.has(n.id)) return;
    busy.current.add(n.id);
    setActionError(null);
    const undo = dropRow(n);
    const res = await fetch(`/api/notifications/${n.id}`, { method: 'DELETE' }).catch(() => null);
    busy.current.delete(n.id);
    if (!res?.ok) {
      undo();
      setActionError(ti('actionError'));
      return;
    }
    if (tab !== 'snoozed' && !n.read_at) bump(n, -1);
    notifyChanged();
  }

  async function markAllRead() {
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ readAll: true }),
    }).catch(() => null);
    if (res?.ok) {
      const now = new Date().toISOString();
      setRows((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? now })));
      setCounts((c) => (c ? { priority: 0, other: 0 } : c));
      notifyChanged();
    }
  }

  const textLabels: NotificationTextLabels = {
    someone: labels.someone,
    untitled: tr('notifications.untitled'),
    mentionedYou: labels.mentionedYou,
    assignedYou: labels.assignedYou,
    commentedOn: labels.commentedOn,
    changedStatus: labels.changedStatus,
    updatedIssue: labels.updatedIssue,
    reminderFor: tr.raw('inboxSnooze.reminderFor') as string,
    planUpdate: tp.raw('notify.planUpdate') as string,
    planComment: tp.raw('notify.planComment') as string,
    planReminder: tp.raw('notify.planReminder') as string,
    docMention: tr.raw('notifications.docMention') as string,
    docCommentMention: tr.raw('notifications.docCommentMention') as string,
    docCommentReply: tr.raw('notifications.docCommentReply') as string,
    docShared: tr.raw('notifications.docShared') as string,
    noteAccessRequest: tr.raw('notifications.noteAccessRequest') as string,
    noteTaskAssigned: tr.raw('notifications.noteTaskAssigned') as string,
    noteTaskDue: tr.raw('notifications.noteTaskDue') as string,
    noteTransfer: tr.raw('notifications.noteTransfer') as string,
    docConflict: tr.raw('notifications.docConflict') as string,
    boardMention: tr.raw('notifications.boardMention') as string,
    boardReply: tr.raw('notifications.boardReply') as string,
    trackKinds: {
      triage_owner: tTriage.raw('notifications.triage_owner') as string,
      sla_risk: tTriage.raw('notifications.sla_risk') as string,
      sla_breach: tTriage.raw('notifications.sla_breach') as string,
      agent_update: tTriage.raw('notifications.agent_update') as string,
    },
    groupsMention: tr.raw('notifications.groupsMention') as string,
    groupsAssigned: tr.raw('notifications.groupsAssigned') as string,
    groupsAutoAssigned: tr.raw('notifications.groupsAutoAssigned') as string,
    chatMessage: tr.raw('notifications.chatMessage') as string,
  };

  /** La línea gris: qué hizo quién y, si llegó por seguir el issue, que estás suscripto. */
  const reasonLine = (n: Notification, meta: Record<string, string>): string => {
    const reason = n.reason ?? 'other';
    const actor = n.actorName || meta.actorName || labels.someone;
    let text: string;
    if (reason === 'other') text = n.body && n.source_type !== 'robot' ? n.body : notificationTitle(n, textLabels);
    else if (reason === 'status' && meta.newStatus) text = ti('reason.statusTo', { actor, status: meta.newStatus });
    else text = ti(`reason.${reason}`, { actor, agent: meta.agentName || labels.someone });
    const aboutIssue = Boolean(n.issue || meta.issueIdentifier);
    return VIA_SUBSCRIPTION.has(reason) && aboutIssue ? `${text} · ${ti('why.subscribed')}` : text;
  };

  const firstLoad = loading && rows.length === 0;
  const filtered = inboxFilterCount(filter) > 0;
  // Agrupado (Display): las filas ya llegan ordenadas por grupo; acá se cortan en secciones.
  const grouped = tab !== 'snoozed' && filter.group !== 'none';
  const groupLabel = (n: Notification): string => {
    if (filter.group === 'kind') return tr(`inbox.kinds.${n.kind ?? 'other'}`);
    if (filter.group === 'project') return n.projectName ?? tr('inbox.filter.noProject');
    return n.team ?? tr('inbox.filter.noTeam');
  };
  const groups: Array<{ key: string; label: string; rows: Notification[] }> = [];
  if (grouped) {
    for (const n of rows) {
      const key = inboxGroupKey({ kind: n.kind ?? 'other', projectId: n.projectId ?? null, team: n.team ?? null }, filter.group);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(n);
      else groups.push({ key, label: groupLabel(n), rows: [n] });
    }
  }
  // Orden visual (agrupado o no) para moverse con el teclado.
  const ordered = grouped ? groups.flatMap((g) => g.rows) : rows;

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    changeTab(next);
    tabRefs.current[next]?.focus();
  };

  function rowEl(id: string): HTMLElement | null {
    return listRef.current?.querySelector<HTMLElement>(`[data-testid="track-inbox-item"][data-id="${CSS.escape(id)}"]`) ?? null;
  }

  const focusRow = (id: string) => {
    setActive(id);
    const el = rowEl(id);
    el?.querySelector<HTMLElement>('.track-inbox-link')?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  };

  /** Link de un aviso: los de un issue se abren en el panel de al lado; el resto, en su página. */
  const rowHref = (n: Notification): string => {
    if (!n.issue) return n.href ?? '/app/track';
    const sp = inboxFilterParams(filter);
    if (tab !== 'priority') sp.set('tab', tab);
    sp.set('n', n.id);
    return `/app/track/inbox/${encodeURIComponent(n.issue.id)}?${sp.toString()}`;
  };

  // Escritorio (lista y panel lado a lado) o teléfono (el issue ocupa la página).
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // En el teléfono la lista se esconde: se guarda dónde estaba para volver ahí al cerrar.
  const listScroll = useRef<number | null>(null);
  const rememberScroll = () => {
    if (!window.matchMedia('(min-width: 1024px)').matches && !openIssue) listScroll.current = window.scrollY;
  };

  /**
   * Abre el aviso (Enter, clic, o J/K con el panel abierto) y lo marca leído.
   * Con un panel ya abierto reemplaza (no suma historial, como J/K).
   */
  const openRow = (n: Notification) => {
    if (!n.read_at) void setRead(n, true);
    const href = rowHref(n);
    if (!n.issue) {
      router.push(href);
      return;
    }
    rememberScroll();
    const scroll = !window.matchMedia('(min-width: 1024px)').matches;
    if (openIssue) router.replace(href, { scroll });
    else router.push(href, { scroll });
  };
  // J/K con el panel abierto: la fila se mueve al instante y el panel la sigue un momento después
  // (mantener J apretada no pide un issue por fila).
  const follow = useRef<number | null>(null);
  const openSoon = (n: Notification) => {
    if (follow.current) window.clearTimeout(follow.current);
    follow.current = window.setTimeout(() => {
      follow.current = null;
      openRow(n);
    }, 150);
  };
  useEffect(() => () => {
    if (follow.current) window.clearTimeout(follow.current);
  }, []);

  // El aviso abierto queda marcado en la lista (al llegar por un link también).
  useEffect(() => {
    if (openNote) setActive(openNote);
  }, [openNote]);

  // Al cerrar el panel: el foco vuelve a la fila y, en el teléfono, la lista a donde estaba.
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    if (openNote) {
      lastOpen.current = openNote;
      return;
    }
    if (openIssue || !lastOpen.current) return;
    const id = lastOpen.current;
    lastOpen.current = null;
    const y = listScroll.current;
    listScroll.current = null;
    requestAnimationFrame(() => {
      if (y !== null) window.scrollTo(0, y);
      rowEl(id)?.querySelector<HTMLElement>('.track-inbox-link')?.focus({ preventScroll: y !== null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIssue, openNote]);

  // Un issue borrado desde el panel: sus avisos salen de la lista.
  useEffect(() => {
    const onDeleted = (e: Event) => {
      const issueId = (e as CustomEvent<{ issueId: string }>).detail?.issueId;
      if (issueId) setRows((prev) => prev.filter((x) => x.issue?.id !== issueId));
    };
    window.addEventListener('zs:track-issue-deleted', onDeleted);
    return () => window.removeEventListener('zs:track-issue-deleted', onDeleted);
  }, []);

  // Darse de baja del issue desde la fila (y volver a seguirlo), como Linear.
  const isSubscribed = (n: Notification) => (n.issue ? (subs[n.issue.id] ?? n.issue.subscribed ?? true) : false);
  useEffect(() => {
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<{ issueId: string; subscribed: boolean }>).detail;
      if (d?.issueId) setSubs((prev) => ({ ...prev, [d.issueId]: d.subscribed }));
    };
    window.addEventListener(TRACK_SUBSCRIPTION_EVENT, onChange);
    return () => window.removeEventListener(TRACK_SUBSCRIPTION_EVENT, onChange);
  }, []);
  async function toggleSubscription(n: Notification) {
    const issue = n.issue;
    if (!issue || busy.current.has(`sub:${issue.id}`)) return;
    busy.current.add(`sub:${issue.id}`);
    setActionError(null);
    const next = !isSubscribed(n);
    setSubs((prev) => ({ ...prev, [issue.id]: next }));
    const res = await fetch(`/api/track/issues/${issue.id}/subscription`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed: next }),
    }).catch(() => null);
    busy.current.delete(`sub:${issue.id}`);
    if (!res?.ok) {
      setSubs((prev) => ({ ...prev, [issue.id]: !next }));
      setActionError(tr('subscription.error'));
      return;
    }
    announceSubscription(issue.id, next);
    pushNotice(next ? ti('resubscribed', { id: issue.identifier }) : ti('unsubscribed', { id: issue.identifier }));
  }

  // Teclado como la Inbox de Linear (fuera de campos de texto y con los menús cerrados).
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTextEntry(e.target)) return;
    if (document.querySelector(OPEN_MENU)) return;
    const target = e.target as HTMLElement | null;
    // Solo desde la lista (el link de una fila) o sin foco: los botones, pestañas y filtros conservan sus teclas.
    const onLink = Boolean(target?.classList?.contains('track-inbox-link'));
    const inRow = Boolean(target?.closest?.('[data-testid="track-inbox-item"]'));
    const free = !target || target === document.body || target === document.documentElement;
    // Desde el issue abierto al lado, J/K siguen recorriendo la bandeja (el resto de las teclas son del issue).
    const inPane = Boolean(target?.closest?.('.track-inbox-pane'));
    if (inPane && !onLink && !inRow) {
      if (e.key !== 'j' && e.key !== 'k') return;
    } else if (!onLink && !inRow && !free) return;
    // Con el panel abierto y el foco en ningún lado, solo J/K (Backspace o U no tocan el aviso abierto sin querer).
    if (openIssue && free && e.key !== 'j' && e.key !== 'k' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    // Un botón de la fila (Posponer, leída, borrar) conserva Enter, espacio y flechas.
    if (inRow && !onLink && (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow'))) return;
    if (ordered.length === 0) return;
    const i = active ? ordered.findIndex((x) => x.id === active) : -1;
    const cur = i >= 0 ? ordered[i] : null;
    const k = e.key;
    if (k === 'j' || k === 'ArrowDown' || k === 'k' || k === 'ArrowUp') {
      e.preventDefault();
      const down = k === 'j' || k === 'ArrowDown';
      const from = i >= 0 ? i : openNote ? ordered.findIndex((x) => x.id === openNote) : -1;
      const next = ordered[down ? Math.min(ordered.length - 1, from + 1) : Math.max(0, from - 1)];
      focusRow(next.id);
      // Con un issue abierto al lado, el panel sigue a la fila (como Linear); los que no son de un issue no se abren solos.
      if (openIssue && next.issue && next.id !== openNote) openSoon(next);
    } else if (!cur) {
      return;
    } else if (k === 'Enter' || k === 'o') {
      e.preventDefault();
      openRow(cur);
    } else if (k === 'u' || k === 'U') {
      e.preventDefault();
      void setRead(cur, !cur.read_at);
    } else if ((k === 'h' || k === 'H') && tab !== 'snoozed') {
      e.preventDefault();
      // El ícono (escritorio) o el menú "…" (teléfono): el que se ve.
      const triggers = Array.from(rowEl(cur.id)?.querySelectorAll<HTMLButtonElement>('.track-inbox-snooze') ?? []);
      (triggers.find((b) => b.offsetParent !== null) ?? triggers[0])?.click();
    } else if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      void remove(cur);
    } else if (k === 'Escape') {
      setActive(null);
      (document.activeElement as HTMLElement | null)?.blur();
    }
  };
  // Sale el foco de la lista: no queda una fila activa que reciba las teclas.
  const onListBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && listRef.current?.contains(next)) return;
    if (next && (next as HTMLElement).closest?.('.track-menu')) return;
    setActive(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const snoozeMenu = (n: Notification, extra?: (close: () => void) => ReactNode) => (
    <Popover
      ariaLabel={extra ? ti('more') : tr('inboxSnooze.snooze')}
      className={`track-inbox-icon track-inbox-snooze${extra ? ' is-more' : ''}`}
      width={248}
      trigger={<TrackIcon name={extra ? 'more' : 'clock'} size={14} />}
    >
      {(close) => (
        <>
          {SNOOZE_PRESETS.map((p, i) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              className="track-menu-item"
              data-autofocus={i === 0 ? '' : undefined}
              onClick={() => {
                close();
                void snooze(n, snoozeAt(p, new Date()));
              }}
            >
              <span className="track-menu-label">
                {extra ? `${tr('inboxSnooze.snooze')}: ` : ''}
                {tr(SNOOZE_LABEL[p])}
              </span>
              <span className="track-menu-meta">
                <LocalText>{formatWhenShort(snoozeAt(p, new Date()).toISOString(), locale)}</LocalText>
              </span>
            </button>
          ))}
          {extra?.(close)}
        </>
      )}
    </Popover>
  );

  const renderRow = (n: Notification) => {
    const meta = parseMeta(n.meta);
    const unread = !n.read_at;
    const reason = n.reason ?? 'other';
    const actor = n.actorName || meta.actorName || '';
    const issue = n.issue ?? null;
    const at = n.snoozed_until ?? n.created_at;
    const isActive = active === n.id;
    const titleText = issue ? issue.title || tr('notifications.untitled') : notificationTitle(n, textLabels);
    const readToggle = unread ? ti('markRead') : ti('markUnread');
    const subscribed = isSubscribed(n);
    const subToggle = subscribed ? ti('unsubscribeIssue') : ti('subscribeIssue');
    return (
      <li
        key={n.id}
        className={`track-inbox-item${unread ? ' is-unread' : ''}${isActive ? ' is-kb-active' : ''}${openNote === n.id ? ' is-open' : ''}`}
        aria-current={openNote === n.id ? 'true' : undefined}
        data-testid="track-inbox-item"
        data-id={n.id}
        data-kind={n.kind}
        data-tab={n.tab}
        data-reason={reason}
        data-read={unread ? 'false' : 'true'}
        onMouseDown={() => setActive(n.id)}
      >
        <span className={`track-inbox-avatar${actor ? '' : ' is-system'}`} aria-hidden>
          {actor ? initials(actor) : <TrackIcon name={REASON_ICON[reason]} size={14} />}
          {actor && (
            <span className={`track-inbox-badge is-${reason}`} data-testid="track-inbox-badge">
              <TrackIcon name={REASON_ICON[reason]} size={9} />
            </span>
          )}
        </span>
        <Link
          href={rowHref(n)}
          scroll={n.issue && wide ? false : undefined}
          replace={Boolean(n.issue && openIssue)}
          className="track-inbox-link"
          onFocus={() => setActive(n.id)}
          onClick={() => {
            if (n.issue) rememberScroll();
            if (unread) void setRead(n, true);
          }}
        >
          <span className="track-inbox-line">
            {unread && (
              <span className="track-inbox-mark" title={labels.unread}>
                <span className="sr-only">{labels.unread}</span>
              </span>
            )}
            {issue && <span className="track-identifier track-inbox-id">{issue.identifier}</span>}
            <span className="track-inbox-text">{titleText}</span>
          </span>
          <span className="track-inbox-reason" data-testid="track-inbox-reason">
            {reasonLine(n, meta)}
          </span>
        </Link>
        <span className="track-inbox-side">
          {issue && issue.statusCategory && (
            <span className="track-inbox-status" title={issue.statusName ?? undefined}>
              <StatusDot color={issue.statusColor} category={issue.statusCategory as Parameters<typeof StatusDot>[0]['category']} />
              <span className="sr-only">{issue.statusName}</span>
            </span>
          )}
          {tab === 'snoozed' && n.snoozed_until ? (
            <time className="track-inbox-time" dateTime={n.snoozed_until}>
              <LocalText>{tr('inboxSnooze.until', { when: formatWhenShort(n.snoozed_until, locale) })}</LocalText>
            </time>
          ) : (
            <time className="track-inbox-time" dateTime={at}>
              <LocalText>{short(Date.now() - parseStoredDate(at))}</LocalText>
            </time>
          )}
        </span>
        <span className="track-inbox-actions">
          {tab === 'snoozed' ? (
            <button type="button" className="btn btn-ghost btn-sm track-inbox-unsnooze" onClick={() => void snooze(n, null)}>
              {tr('inboxSnooze.unsnooze')}
            </button>
          ) : (
            <>
              <span className="track-inbox-quick">
                {snoozeMenu(n)}
                <button
                  type="button"
                  className="track-inline-trigger track-inbox-icon"
                  aria-label={readToggle}
                  title={`${readToggle} · U`}
                  onClick={() => void setRead(n, unread)}
                  data-testid="track-inbox-toggle-read"
                >
                  <TrackIcon name={unread ? 'check' : 'eye'} size={14} />
                </button>
                {n.issue && (
                  <button
                    type="button"
                    className={`track-inline-trigger track-inbox-icon${subscribed ? '' : ' is-off'}`}
                    aria-label={subToggle}
                    title={subToggle}
                    data-subscribed={subscribed ? 'true' : 'false'}
                    onClick={() => void toggleSubscription(n)}
                    data-testid="track-inbox-unsubscribe"
                  >
                    <TrackIcon name={subscribed ? 'bell-off' : 'bell'} size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="track-inline-trigger track-inbox-icon"
                  aria-label={ti('delete')}
                  title={`${ti('delete')} · ⌫`}
                  onClick={() => void remove(n)}
                  data-testid="track-inbox-delete"
                >
                  <TrackIcon name="close" size={14} />
                </button>
              </span>
              <span className="track-inbox-more">
                {snoozeMenu(n, (close) => (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="track-menu-item"
                      onClick={() => {
                        close();
                        void setRead(n, unread);
                      }}
                    >
                      <span className="track-menu-label">{readToggle}</span>
                    </button>
                    {n.issue && (
                      <button
                        type="button"
                        role="menuitem"
                        className="track-menu-item"
                        data-testid="track-inbox-unsubscribe-menu"
                        onClick={() => {
                          close();
                          void toggleSubscription(n);
                        }}
                      >
                        <span className="track-menu-label">{subToggle}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="track-menu-item"
                      onClick={() => {
                        close();
                        void remove(n);
                      }}
                    >
                      <span className="track-menu-label">{ti('delete')}</span>
                    </button>
                  </>
                ))}
              </span>
            </>
          )}
        </span>
      </li>
    );
  };

  const tabLabel = (t: TabKey) => (t === 'snoozed' ? tr('inboxSnooze.tab') : ti(`tabs.${t}`));

  return (
    <div className={`track-inbox-split${openIssue ? ' has-open' : ''}`} data-testid="track-inbox-split">
      <div className="ui-page track-inbox-page">
        <PageHeader
          title={labels.title}
          actions={
            rows.length > 0 ? (
              <button type="button" className="btn" onClick={() => void markAllRead()}>
                {labels.markAllRead}
              </button>
            ) : null
          }
        />

        <div className="ui-tabs track-inbox-tabs" role="tablist" aria-label={labels.title}>
          {TABS.map((t, i) => {
            const count = t === 'snoozed' ? null : (counts?.[t] ?? null);
            return (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                type="button"
                role="tab"
                className="ui-tab"
                aria-selected={tab === t}
                aria-describedby={t === 'snoozed' ? undefined : `track-inbox-rule-${t}`}
                title={t === 'snoozed' ? undefined : ti(`rule.${t}`)}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => changeTab(t)}
                onKeyDown={(e) => onTabKey(e, i)}
                data-testid={`track-inbox-tab-${t}`}
              >
                {tabLabel(t)}
                {count !== null && count > 0 && (
                  <span className="track-inbox-tab-count" data-testid={`track-inbox-count-${t}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="sr-only" id="track-inbox-rule-priority">
          {ti('rule.priority')}
        </span>
        <span className="sr-only" id="track-inbox-rule-other">
          {ti('rule.other')}
        </span>

        <InboxFilters filter={filter} onChange={changeFilter} facets={facets} showDisplay={tab !== 'snoozed'} />

        <div role="tabpanel" aria-busy={loading || undefined} data-testid="track-inbox-panel" ref={listRef} onBlur={onListBlur}>
          {firstLoad ? (
            <div className="ui-loading-stack">
              <span className="sr-only" role="status">
                {labels.loading}
              </span>
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="ui-skeleton ui-skeleton-row" />
              ))}
            </div>
          ) : error && rows.length === 0 ? (
            <EmptyState
              quiet
              title={labels.loadError}
              action={
                <button type="button" className="btn btn-primary" onClick={() => void load(true)}>
                  {labels.retry}
                </button>
              }
            />
          ) : rows.length === 0 ? (
            filtered ? (
              <EmptyState
                quiet
                title={tr('inbox.filter.emptyTitle')}
                body={tr('inbox.filter.emptyBody')}
                action={
                  <button type="button" className="btn" onClick={() => changeFilter({ ...EMPTY_INBOX_FILTER, order: filter.order, group: filter.group })} data-testid="track-inbox-empty-clear">
                    {tr('filters.clear')}
                  </button>
                }
              />
            ) : tab === 'snoozed' ? (
              <EmptyState quiet title={tr('inboxSnooze.empty')} body={tr('inboxSnooze.emptyBody')} />
            ) : tab === 'priority' ? (
              <EmptyState quiet title={ti('emptyPriority')} body={ti('rule.priority')} />
            ) : (
              <EmptyState quiet title={labels.empty} body={labels.emptyBody} />
            )
          ) : grouped ? (
            groups.map((g, i) => (
              <section key={g.key} className="track-inbox-group" aria-labelledby={`track-inbox-group-${i}`} data-testid="track-inbox-group" data-group={g.key}>
                <h2 className="track-inbox-group-head" id={`track-inbox-group-${i}`}>
                  <span className="track-inbox-group-name">{g.label}</span>
                  <span className="track-inbox-group-count">{g.rows.length}</span>
                </h2>
                <ul className="track-inbox-list">{g.rows.map(renderRow)}</ul>
              </section>
            ))
          ) : (
            <ul className="track-inbox-list">{rows.map(renderRow)}</ul>
          )}
          {actionError && (
            <p className="ui-error" role="alert">
              {actionError}
            </p>
          )}
          {error && rows.length > 0 && (
            <p className="ui-error" role="alert">
              {labels.loadError}
            </p>
          )}
          {hasMore && rows.length > 0 && (
            <div className="track-pagination">
              <button type="button" className="btn btn-sm" onClick={() => void load(false)} aria-busy={loading || undefined}>
                {labels.loadMore}
              </button>
            </div>
          )}
          {rows.length > 0 && (
            <p className="track-inbox-keys" aria-hidden>
              <span>
                <kbd className="kbd">J</kbd> <kbd className="kbd">K</kbd> {ti('keys.move')}
              </span>
              <span>
                <kbd className="kbd">↵</kbd> {ti('keys.open')}
              </span>
              <span>
                <kbd className="kbd">U</kbd> {ti('keys.read')}
              </span>
              <span>
                <kbd className="kbd">H</kbd> {ti('keys.snooze')}
              </span>
              <span>
                <kbd className="kbd">⌫</kbd> {ti('keys.delete')}
              </span>
            </p>
          )}
        </div>
      </div>
      <section className="track-inbox-pane" aria-label={ti('panel.label')} data-testid="track-inbox-pane">
        {openIssue ? children : <p className="track-inbox-pane-empty">{rows.length > 0 ? ti('panel.empty') : null}</p>}
      </section>
    </div>
  );
}
