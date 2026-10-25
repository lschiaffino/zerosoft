'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  findAction,
  getCommandContext,
  matchesQuery,
  OPEN_SEARCH_EVENT,
  CMDK_CLOSED_EVENT,
  type CommandAction,
} from '@/lib/cmdk-context';

interface ResultItem {
  group: string;
  label: string;
  meta: string;
  href: string;
  /** Acción en página (evento de window) en vez de navegar. */
  event?: string;
  /** Acción en contexto (issue abierto, selección): corre en la página. */
  action?: CommandAction;
}

interface SearchResponse {
  q: string;
  items: ResultItem[];
}

function useGroupOrder() {
  return useMemo(() => [
        'context',
        'track',
        'actions',
        'projects',
        'issues',
        'contacts',
        'companies',
        'leads',
        'deals',
        'crmAgentRuns',
        'records',
        'links',
        'docs',
        'notes',
        'boards',
        'tasks',
        'eventTypes',
        'bookings',
        'widgets',
        'flows',
        'agents',
        'robots',
        'groupsChats',
        'groupsTickets',
        'groupsMessages',
      ], []);
}

function useGroupLabel(t: (key: string) => string) {
  return useCallback(
    (group: string) => {
      if (group === 'actions') return t('actions');
      if (group === 'track') return 'Track';
      const key = `group${group.charAt(0).toUpperCase()}${group.slice(1)}`;
      return t(key);
    },
    [t],
  );
}

/**
 * Búsqueda global estilo ⌘K (Twenty/Linear). Se abre con ⌘K / Ctrl+K o con el
 * evento 'zs:open-search' (botón de la sidebar). Busca en todos los productos
 * usando la API unificada /api/search.
 */
export default function CommandSearch() {
  const t = useTranslations('common.sidebar');
  const locale = useLocale();
  const tNotes = useTranslations('notes');
  const tBoard = useTranslations('board');
  const tTrack = useTranslations('track');
  const router = useRouter();
  const pathname = usePathname();
  const inTrack = pathname.startsWith('/app/track');
  const inCrm = pathname.startsWith('/app/crm');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  // Páginas abiertas dentro de las acciones en contexto (ids), p. ej. ["status"].
  const [pages, setPages] = useState<string[]>([]);
  // Fuerza un render después de una acción que deja la paleta abierta.
  const [, setTick] = useState(0);
  // Opciones de una página que vienen del servidor (p. ej. elegir el issue padre).
  const [asyncItems, setAsyncItems] = useState<CommandAction[]>([]);
  // Tipear o cambiar de página vuelve a la primera opción (el mouse quieto
  // sobre la lista no deja elegida una que el filtro ya sacó).
  useEffect(() => {
    setSel(0);
  }, [q, pages]);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const groupOrder = useGroupOrder();
  const groupLabel = useGroupLabel(t);

  // Acciones rápidas globales: se muestran cuando no hay query.
  const actionItems = useMemo<ResultItem[]>(() => {
    const group = 'actions';
    // Acciones de Track: dentro de Track van primero y actúan en contexto
    // (el quick-create del proyecto/issue abierto); fuera, llevan a Track.
    const track: ResultItem[] = [
      {
        group: 'track',
        label: tTrack('cmdk.newIssue'),
        meta: 'C',
        href: '/app/track?newIssue=1',
        event: inTrack ? 'zs:track-new-issue' : undefined,
      },
      { group: 'track', label: tTrack('cmdk.newProject'), meta: '', href: '/app/track?newProject=1' },
      { group: 'track', label: tTrack('cmdk.myTasks'), meta: '', href: '/app/track/my-tasks' },
      { group: 'track', label: tTrack('cmdk.allIssues'), meta: '', href: '/app/track/issues' },
      { group: 'track', label: tTrack('cmdk.inbox'), meta: '', href: '/app/track/inbox' },
    ];
    const rest: ResultItem[] = [
      { group, label: t('newContact'), meta: '', href: '/app/crm/contacts/new' },
      { group, label: t('newCompany'), meta: '', href: '/app/crm/companies/new' },
      { group, label: t('newDeal'), meta: '', href: '/app/crm/deals/new' },
      { group, label: t('newTask'), meta: '', href: '/app/crm/tasks' },
      { group, label: t('importFromHubspot'), meta: '', href: '/app/crm/settings?tab=import&from=hubspot' },
      { group, label: t('importFromPipedrive'), meta: '', href: '/app/crm/settings?tab=import&from=pipedrive' },
      {
        group,
        label: t('askCrmAssistant'),
        meta: '',
        href: '/app/crm?assistant=1',
        event: inCrm ? 'zs:crm-assistant' : undefined,
      },
      { group, label: t('newCrmAgentRun'), meta: '', href: '/app/crm/agents?new=1' },
      { group, label: t('newLink'), meta: '', href: '/app/links/new' },
      { group, label: t('newDocPage'), meta: '', href: '/app/docs' },
      { group, label: t('newEventType'), meta: '', href: '/app/calendar/event-types/new' },
      { group, label: t('newFlow'), meta: '', href: '/app/flow' },
      { group, label: tNotes('actions.newNote'), meta: '', href: '/app/notes?new=1' },
      { group, label: tBoard('list.new'), meta: '', href: '/app/board?new=1' },
      { group, label: t('newAgent'), meta: '', href: '/app/agents' },
      { group, label: t('newRobot'), meta: '', href: '/app/robots?new=1' },
      { group, label: t('newGroup'), meta: '', href: '/app/groups/list?new=1' },
    ];
    return inTrack ? [...track, ...rest] : [...rest, ...track];
  }, [t, tNotes, tBoard, tTrack, inTrack, inCrm]);

  useEffect(() => {
    function onOpen(e: Event) {
      const page = (e as CustomEvent<{ page?: string } | undefined>).detail?.page;
      setPages(page ? [page] : []);
      setOpen(true);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPages([]);
        setOpen((v) => !v);
      }
    }
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) {
      // Remember the trigger to restore focus when the palette closes.
      prevFocusRef.current = document.activeElement as HTMLElement | null;
      setQ('');
      setItems(actionItems);
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
      setPages([]);
      window.dispatchEvent(new Event(CMDK_CLOSED_EVENT));
    }
  }, [open, actionItems]);

  // Acciones en contexto de la página (se consultan en cada render: nunca viejas).
  const context = open ? getCommandContext() : null;
  let page: CommandAction | null = null;
  let pageItems: CommandAction[] | null = null;
  if (context && pages.length > 0) {
    let list = context.actions;
    for (const id of pages) {
      const found = findAction(list, id);
      if (!found?.children) {
        page = null;
        break;
      }
      page = found;
      list = found.children();
    }
    if (page) {
      const dyn = page.dynamic ? page.dynamic(q) : [];
      pageItems = [...dyn, ...(page.load ? asyncItems : []), ...list.filter((a) => matchesQuery(a, q))];
    }
  }
  const pageKey = page ? pages.join('/') : '';
  const pageLoad = page?.load;
  const contextItems: ResultItem[] = context
    ? context.actions
        .filter((a) => matchesQuery(a, q))
        .map((a) => ({ group: 'context', label: a.label, meta: a.meta ?? '', href: '', action: a }))
    : [];
  const visible: ResultItem[] = pageItems
    ? pageItems.map((a) => ({ group: 'context', label: a.label, meta: a.meta ?? '', href: '', action: a }))
    : [...contextItems, ...items];

  const search = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setItems(actionItems);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&locale=${locale}`);
        const data = (await res.json()) as SearchResponse;
        const needle = query.trim().toLowerCase();
        const matchingActions = actionItems.filter((a) => a.label.toLowerCase().includes(needle));
        const sorted = [...matchingActions, ...(data.items ?? [])].sort(
          (a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group),
        );
        setItems(sorted);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
        setSel(0);
      }
    },
    [actionItems, groupOrder, locale],
  );

  useEffect(() => {
    const id = setTimeout(() => search(q), 200);
    return () => clearTimeout(id);
  }, [q, search]);

  // Las páginas con `load` piden opciones al servidor según lo tipeado.
  const loadRef = useRef(pageLoad);
  loadRef.current = pageLoad;
  const hasLoad = Boolean(pageLoad);
  useEffect(() => {
    if (!pageKey || !hasLoad) {
      setAsyncItems([]);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      void loadRef.current?.(q).then((rows) => {
        if (alive) setAsyncItems(rows);
      }).catch(() => {
        if (alive) setAsyncItems([]);
      });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [pageKey, hasLoad, q]);

  function go(item: ResultItem) {
    const action = item.action;
    if (action) {
      if (action.children) {
        setPages((p) => [...p, action.id]);
        setQ('');
        setSel(0);
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      if (action.keepOpen) {
        action.run?.();
        setTick((n) => n + 1);
        return;
      }
      setOpen(false);
      // Después de cerrar la paleta (el foco vuelve a la página).
      window.setTimeout(() => action.run?.(), 0);
      return;
    }
    setOpen(false);
    if (item.event) {
      const name = item.event;
      // Después de cerrar la paleta (el modal toma el foco).
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(name, { cancelable: true })), 0);
      return;
    }
    router.push(item.href);
  }

  // Attached to the dialog container so Esc/arrows work wherever focus sits
  // inside the palette (input or a result button).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Backspace' && !q && pages.length > 0) {
      // Como en Linear: borrar con el input vacío vuelve a la página anterior.
      e.preventDefault();
      setPages((p) => p.slice(0, -1));
      setSel(0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter' && visible.length > 0) {
      e.preventDefault();
      go(visible[Math.min(sel, visible.length - 1)]);
    } else if (e.key === 'Tab') {
      // Focus trap: the input is the only tabbable element while open.
      e.preventDefault();
      inputRef.current?.focus();
    }
  }

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="cmdk-backdrop" onMouseDown={() => setOpen(false)}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label={t('search')}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {context && page && (
          <div className="cmdk-crumbs" data-testid="cmdk-crumbs">
            <span className="cmdk-crumb">{context.title}</span>
            <span aria-hidden>›</span>
            <span className="cmdk-crumb is-current">{page.label}</span>
          </div>
        )}
        <input
          ref={inputRef}
          className="cmdk-input"
          // Enfocado al montar: quien tipea rápido después de S o ⌘K no pierde teclas.
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-listbox"
          aria-activedescendant={visible[sel] ? `cmdk-option-${sel}` : undefined}
          aria-autocomplete="list"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={page?.placeholder ?? t('searchPlaceholder')}
          aria-label={t('search')}
        />
        <div className="cmdk-results" role="listbox" id="cmdk-listbox" aria-label={t('search')}>
          {loading && !pageItems && <p className="cmdk-state">{t('searchLoading')}</p>}
          {(!loading || pageItems) && q.trim() && visible.length === 0 && (
            <p className="cmdk-state">{t('searchEmpty')}</p>
          )}
          {(!loading || pageItems) &&
            visible.map((item, i) => {
              const header =
                item.group !== lastGroup && !pageItems ? (
                  <p className="cmdk-group" key={`g-${item.group}`} role="presentation">
                    {item.group === 'context' ? (context?.title ?? '') : groupLabel(item.group)}
                  </p>
                ) : null;
              lastGroup = item.group;
              return (
                <div key={`${item.action?.id ?? item.href}-${i}`} role="presentation">
                  {header}
                  <button
                    type="button"
                    role="option"
                    id={`cmdk-option-${i}`}
                    aria-selected={i === sel}
                    tabIndex={-1}
                    className={`cmdk-item${i === sel ? ' sel' : ''}`}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(item)}
                  >
                    <span className="cmdk-item-label">
                      {item.action?.swatch && (
                        <span className="cmdk-swatch" style={{ background: item.action.swatch }} aria-hidden />
                      )}
                      {item.label}
                    </span>
                    <span className="cmdk-meta">
                      {item.action?.checked && <span className="cmdk-check">✓</span>}
                      {item.meta}
                    </span>
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
