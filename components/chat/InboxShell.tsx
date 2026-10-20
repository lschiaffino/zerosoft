'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import type { ChatAgent, ChatConversationListRow } from '@/lib/chat-data';
import ConversationList from './ConversationList';
import BulkBar from './BulkBar';
import AwayStatus from './AwayStatus';
import {
  INBOX_STATUSES,
  conversationIdFromPath,
  inboxQuery,
  parseSavedFilters,
  type InboxAssignee,
  type InboxStatus,
} from './inbox-model';

const PAGE_SIZE = 25;
const FILTER_KEY = 'zs-chat-inbox-filters';

interface InboxContextValue {
  rows: ChatConversationListRow[];
  /** Vuelve a pedir la primera página (después de cambiar estado, tags o responder). */
  refresh: () => void;
}

const InboxContext = createContext<InboxContextValue>({ rows: [], refresh: () => {} });

/** Lista visible de la bandeja: la usa la conversación para J/K y para refrescar. */
export function useInbox(): InboxContextValue {
  return useContext(InboxContext);
}

function readFilters() {
  try {
    return parseSavedFilters(window.sessionStorage.getItem(FILTER_KEY));
  } catch {
    return null;
  }
}

function writeFilters(status: InboxStatus, assignee: InboxAssignee) {
  try {
    window.sessionStorage.setItem(FILTER_KEY, JSON.stringify({ status, assignee }));
  } catch {
    // Sin storage: los filtros duran lo que dura la página.
  }
}

/**
 * La bandeja en tres columnas: la lista con sus filtros (esta columna), la
 * conversación y el panel del visitante (los pone la página hija). Vive en el
 * layout de /app/chat/inbox, así la lista no se recarga ni pierde el scroll al
 * pasar de una conversación a otra. En mobile se ve una columna por vez.
 */
export default function InboxShell({
  widgetIds,
  currentUserId,
  agents,
  initialAway,
  children,
}: {
  widgetIds: string[];
  currentUserId: string;
  /** Agentes del workspace (asignar en lote). */
  agents: ChatAgent[];
  /** El agente logueado está marcado como ausente. */
  initialAway: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('chat');
  const pathname = usePathname();
  const currentId = conversationIdFromPath(pathname);

  const [status, setStatus] = useState<InboxStatus>('open');
  const [assignee, setAssignee] = useState<InboxAssignee>('any');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [rows, setRows] = useState<ChatConversationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  /** Conversaciones elegidas para una acción en lote. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsCount = useRef(0);
  rowsCount.current = rows.length;
  /** Id del último pedido: una respuesta vieja no pisa a la nueva. */
  const requestSeq = useRef(0);

  useEffect(() => {
    const saved = readFilters();
    if (saved) {
      setStatus(saved.status);
      setAssignee(saved.assignee);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const query = useMemo(
    () => inboxQuery({ status, assignee, q: debouncedQ, tag }, widgetIds, currentUserId),
    [status, assignee, debouncedQ, tag, widgetIds, currentUserId],
  );

  const fetchRows = useCallback(
    async (offset: number, append: boolean) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(false);
      try {
        const params = new URLSearchParams({ ...query, limit: String(PAGE_SIZE), offset: String(offset) });
        const res = await fetch(`/api/chat/conversations?${params.toString()}`);
        if (!res.ok) throw new Error('fetch_failed');
        const data = (await res.json()) as { rows: ChatConversationListRow[]; total: number };
        if (seq !== requestSeq.current) return;
        setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
        setTotal(data.total);
      } catch {
        if (seq === requestSeq.current) setError(true);
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoaded(true);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    void fetchRows(0, false);
  }, [fetchRows]);

  const fetchTags = useCallback(() => {
    fetch('/api/chat/tags')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows?: Array<{ tag: string; count: number }> }) => setTags(d.rows ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Refresco silencioso de la primera página: no pisa un "Cargar más".
  const refresh = useCallback(() => {
    if (rowsCount.current > PAGE_SIZE) return;
    const seq = requestSeq.current;
    const params = new URLSearchParams({ ...query, limit: String(PAGE_SIZE), offset: '0' });
    fetch(`/api/chat/conversations?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rows: ChatConversationListRow[]; total: number } | null) => {
        if (!data || seq !== requestSeq.current) return;
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch(() => {});
    fetchTags();
  }, [query, fetchTags]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  useKeyShortcut('/', () => searchRef.current?.focus());

  function changeStatus(next: InboxStatus) {
    setStatus(next);
    writeFilters(next, assignee);
  }

  function changeAssignee(next: InboxAssignee) {
    setAssignee(next);
    writeFilters(status, next);
  }

  // Lo elegido que ya no está en la lista (otro filtro, se resolvió) sale de la selección.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  // Cambiar de filtro o búsqueda empieza una selección nueva.
  useEffect(() => {
    setSelected(new Set());
  }, [query]);

  function toggleSelected(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const filtered = status !== 'open' || assignee !== 'any' || !!tag || !!debouncedQ;
  const ctx = useMemo(() => ({ rows, refresh }), [rows, refresh]);

  return (
    <InboxContext.Provider value={ctx}>
      <div className="chat-inbox" data-view={currentId ? 'thread' : 'list'}>
        <section className="chat-inbox-list" aria-labelledby="chat-inbox-title">
          <div className="chat-inbox-head">
            <div className="chat-inbox-titlebar">
              <h1 id="chat-inbox-title" className="chat-inbox-title">
                {t('inbox.title')}
              </h1>
              {loaded && (
                <span className="chat-inbox-count data" aria-live="polite">
                  {total}
                </span>
              )}
              <AwayStatus initialAway={initialAway} onChange={refresh} />
            </div>
            <div className="chat-inbox-search">
              <input
                ref={searchRef}
                type="search"
                className="input"
                placeholder={t('inbox.search')}
                aria-label={t('inbox.search')}
                aria-keyshortcuts="/"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {!q && (
                <kbd className="kbd" aria-hidden="true">
                  /
                </kbd>
              )}
            </div>
            <div className="chat-inbox-filters">
              <label className="sr-only" htmlFor="chat-filter-status">
                {t('conversation.statusLabel')}
              </label>
              <select
                id="chat-filter-status"
                className="select"
                value={status}
                onChange={(e) => changeStatus(e.target.value as InboxStatus)}
              >
                {INBOX_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`inbox.filters.${s}`)}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="chat-filter-assignee">
                {t('conversation.assignedTo')}
              </label>
              <select
                id="chat-filter-assignee"
                className="select"
                value={assignee}
                onChange={(e) => changeAssignee(e.target.value as InboxAssignee)}
              >
                <option value="any">{t('inbox.filters.anyone')}</option>
                <option value="mine">{t('inbox.filters.mine')}</option>
                <option value="unassigned">{t('inbox.filters.unassigned')}</option>
              </select>
              {tags.length > 0 && (
                <>
                  <label className="sr-only" htmlFor="chat-filter-tag">
                    {t('tags.filter')}
                  </label>
                  <select id="chat-filter-tag" className="select" value={tag} onChange={(e) => setTag(e.target.value)}>
                    <option value="">{t('tags.all')}</option>
                    {tags.map((x) => (
                      <option key={x.tag} value={x.tag}>
                        #{x.tag} ({x.count})
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </div>

          {selected.size > 0 && (
            <BulkBar
              selected={selected}
              visibleIds={rows.map((r) => r.id)}
              agents={agents}
              currentUserId={currentUserId}
              onSelect={setSelected}
              onDone={() => {
                refresh();
              }}
            />
          )}

          <div className="chat-inbox-scroll" aria-busy={loading}>
            {error ? (
              <div className="chat-inbox-error" role="alert">
                <p>{t('inbox.loadError')}</p>
                <button type="button" className="btn btn-sm" onClick={() => fetchRows(0, false)}>
                  {t('common.retry')}
                </button>
              </div>
            ) : !loaded ? (
              <div className="ui-loading-stack chat-inbox-skeleton" aria-label={t('common.loading')}>
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} className="ui-skeleton ui-skeleton-row" />
                ))}
              </div>
            ) : (
              <ConversationList
                conversations={rows}
                currentId={currentId}
                emptyTitle={filtered ? t('inbox.empty') : t('inbox.emptyOpen')}
                selected={selected}
                onToggle={toggleSelected}
              />
            )}
            {loaded && !error && rows.length < total && (
              <div className="chat-inbox-more">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-block"
                  onClick={() => fetchRows(rows.length, true)}
                  aria-busy={loading || undefined}
                  disabled={loading}
                >
                  {t('inbox.loadMore')}
                </button>
              </div>
            )}
          </div>
        </section>
        {children}
      </div>
    </InboxContext.Provider>
  );
}
