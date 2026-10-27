'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import type { ChatAgent, ChatConversationListRow } from '@/lib/chat-data';
import ConversationList from './ConversationList';
import BulkBar from './BulkBar';
import AwayStatus from './AwayStatus';
import InboxAlerts, { playNewMessageSound, soundEnabled } from './InboxAlerts';
import { notifyChatViewsChanged } from './ChatInboxBranch';
import {
  INBOX_STATUSES,
  conversationIdFromPath,
  filtersToView,
  hasCustomFilters,
  inboxQuery,
  parseSavedFilters,
  viewToFilters,
  type InboxAssignee,
  type InboxFilters,
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

interface SavedView {
  id: string;
  name: string;
  shared: boolean;
  user_id: string;
  filters: Record<string, string>;
}

/**
 * La bandeja en tres columnas: la lista con sus filtros (esta columna), la
 * conversación y el panel del visitante (los pone la página hija). Vive en el
 * layout de /app/chat/inbox, así la lista no se recarga ni pierde el scroll al
 * pasar de una conversación a otra. En mobile se ve una columna por vez.
 *
 * El alcance sale de la URL, como en Intercom: ?view=<id> (vista guardada),
 * ?team=<id> (bandeja de un equipo) o ?following=1 (las que sigo). Los links
 * del sidebar (ChatInboxBranch) los ponen.
 */
export default function InboxShell({
  widgetIds,
  currentUserId,
  agents,
  teams = [],
  initialAway,
  children,
}: {
  widgetIds: string[];
  currentUserId: string;
  /** Agentes del workspace (asignar en lote). */
  agents: ChatAgent[];
  /** Equipos de Chat del workspace. */
  teams?: Array<{ id: string; name: string }>;
  /** El agente logueado está marcado como ausente. */
  initialAway: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('chat');
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const currentId = conversationIdFromPath(pathname);
  const viewParam = params.get('view');
  const teamParam = params.get('team');
  const followingParam = params.get('following') === '1';

  const [status, setStatus] = useState<InboxStatus>('open');
  const [assignee, setAssignee] = useState<InboxAssignee>('any');
  const [assigneeId, setAssigneeId] = useState<string | undefined>(undefined);
  const [teamId, setTeamId] = useState('');
  const [priority, setPriority] = useState('');
  const [channel, setChannel] = useState('');
  const [following, setFollowing] = useState(false);
  const [view, setView] = useState<SavedView | null>(null);
  const [viewMissing, setViewMissing] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [rows, setRows] = useState<ChatConversationListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  /** Guardar los filtros actuales como vista. */
  const [saving, setSaving] = useState<null | { name: string; shared: boolean; busy: boolean; error: string | null }>(null);
  /** Conversaciones elegidas para una acción en lote. */
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsCount = useRef(0);
  rowsCount.current = rows.length;
  /** Id del último pedido: una respuesta vieja no pisa a la nueva. */
  const requestSeq = useRef(0);
  /** Última actividad vista por conversación: suena cuando un visitante escribe. */
  const seen = useRef<Map<string, string> | null>(null);
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  useEffect(() => {
    const saved = readFilters();
    if (saved && !viewParam) {
      setStatus(saved.status);
      setAssignee(saved.assignee);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alcance desde la URL. Al abrir una conversación la URL pierde los
  // parámetros: ahí se conserva lo que había.
  useEffect(() => {
    if (currentId && !viewParam && !teamParam && !followingParam) return;
    let alive = true;
    setViewMissing(false);
    if (viewParam) {
      fetch(`/api/chat/views/${encodeURIComponent(viewParam)}`)
        .then((r) => (r.ok ? (r.json() as Promise<SavedView>) : null))
        .then((v) => {
          if (!alive) return;
          if (!v) {
            setView(null);
            setViewMissing(true);
            return;
          }
          const f = viewToFilters(v.filters);
          setView(v);
          setStatus(f.status);
          setAssignee(f.assignee);
          setAssigneeId(f.assigneeId);
          setTeamId(f.teamId ?? '');
          setPriority(f.priority ?? '');
          setChannel(f.channel ?? '');
          setTag(f.tag);
          setQ(f.q);
          setFollowing(false);
        })
        .catch(() => alive && setViewMissing(true));
    } else {
      setView(null);
      setAssigneeId(undefined);
      setTeamId(teamParam ?? '');
      setFollowing(followingParam);
      if (teamParam || followingParam) {
        setPriority('');
        setChannel('');
      }
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam, teamParam, followingParam]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const filters: InboxFilters = useMemo(
    () => ({ status, assignee, assigneeId, q: debouncedQ, tag, teamId: teamId || undefined, priority: priority || undefined, channel: channel || undefined, following }),
    [status, assignee, assigneeId, debouncedQ, tag, teamId, priority, channel, following],
  );
  const query = useMemo(() => inboxQuery(filters, widgetIds, currentUserId), [filters, widgetIds, currentUserId]);

  /** Suena (si está activado) cuando un visitante escribe en otra conversación o llega una nueva. */
  const detectNew = useCallback((list: ChatConversationListRow[]) => {
    const prev = seen.current;
    const next = new Map(list.map((r) => [r.id, r.updated_at]));
    seen.current = next;
    if (!prev || !soundEnabled()) return;
    const fresh = list.some(
      (r) => r.last_sender_type === 'visitor' && prev.get(r.id) !== r.updated_at && (r.id !== currentIdRef.current || document.visibilityState !== 'visible'),
    );
    if (fresh) playNewMessageSound();
  }, []);

  const fetchRows = useCallback(
    async (offset: number, append: boolean) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(false);
      try {
        const sp = new URLSearchParams({ ...query, limit: String(PAGE_SIZE), offset: String(offset) });
        const res = await fetch(`/api/chat/conversations?${sp.toString()}`);
        if (!res.ok) throw new Error('fetch_failed');
        const data = (await res.json()) as { rows: ChatConversationListRow[]; total: number };
        if (seq !== requestSeq.current) return;
        setRows((prev) => (append ? [...prev, ...data.rows] : data.rows));
        setTotal(data.total);
        if (!append) seen.current = new Map(data.rows.map((r) => [r.id, r.updated_at]));
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
    const sp = new URLSearchParams({ ...query, limit: String(PAGE_SIZE), offset: '0' });
    fetch(`/api/chat/conversations?${sp.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rows: ChatConversationListRow[]; total: number } | null) => {
        if (!data || seq !== requestSeq.current) return;
        setRows(data.rows);
        setTotal(data.total);
        detectNew(data.rows);
      })
      .catch(() => {});
    fetchTags();
  }, [query, fetchTags, detectNew]);

  useEffect(() => {
    // Con la pestaña oculta también se consulta (más lento), así suena el aviso.
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' || soundEnabled()) refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  useKeyShortcut('/', () => searchRef.current?.focus());
  // Con una conversación abierta J/K los maneja la conversación (siguiente y anterior).
  useKeyShortcut('j', () => rows[0] && router.push(`/app/chat/inbox/${rows[0].id}`), !currentId);
  useKeyShortcut('k', () => rows.length > 0 && router.push(`/app/chat/inbox/${rows[rows.length - 1].id}`), !currentId);

  function changeStatus(next: InboxStatus) {
    setStatus(next);
    writeFilters(next, assignee);
  }

  function changeAssignee(next: InboxAssignee) {
    setAssignee(next);
    setAssigneeId(undefined);
    writeFilters(status, next);
  }

  function changeTeam(next: string) {
    setTeamId(next);
    // La URL refleja la bandeja del equipo (el sidebar la marca).
    if (!view && !currentId) router.replace(next ? `/app/chat/inbox?team=${next}` : '/app/chat/inbox');
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

  const viewFilters = filtersToView({ ...filters, q: q.trim() });
  const viewChanged = !!view && JSON.stringify(viewFilters) !== JSON.stringify(filtersToView(viewToFilters(view.filters)));

  async function saveView() {
    if (!saving || !saving.name.trim() || saving.busy) return;
    setSaving({ ...saving, busy: true, error: null });
    try {
      const res = await fetch('/api/chat/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saving.name.trim(), filters: viewFilters, shared: saving.shared }),
      });
      if (!res.ok) throw new Error('save_failed');
      const created = (await res.json()) as SavedView;
      setSaving(null);
      notifyChatViewsChanged();
      router.replace(`/app/chat/inbox?view=${created.id}`);
    } catch {
      setSaving((s) => (s ? { ...s, busy: false, error: t('errors.generic') } : s));
    }
  }

  async function updateView() {
    if (!view) return;
    const res = await fetch(`/api/chat/views/${view.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: viewFilters }),
    }).catch(() => null);
    if (res?.ok) {
      setView((await res.json()) as SavedView);
      notifyChatViewsChanged();
    }
  }

  const team = teams.find((x) => x.id === teamId);
  const title = view ? view.name : following ? t('views.following') : team && !view ? team.name : t('inbox.title');
  const filtered = hasCustomFilters(filters) || following;
  const ctx = useMemo(() => ({ rows, refresh }), [rows, refresh]);

  return (
    <InboxContext.Provider value={ctx}>
      <div className="chat-inbox" data-view={currentId ? 'thread' : 'list'}>
        <section className="chat-inbox-list" aria-labelledby="chat-inbox-title">
          <div className="chat-inbox-head">
            <div className="chat-inbox-titlebar">
              <h1 id="chat-inbox-title" className="chat-inbox-title">
                {title}
              </h1>
              {loaded && (
                <span className="chat-inbox-count data" aria-live="polite">
                  {total}
                </span>
              )}
              <InboxAlerts />
              <AwayStatus initialAway={initialAway} onChange={refresh} />
            </div>
            {viewMissing && (
              <p className="ui-error" role="alert">
                {t('views.missing')}
              </p>
            )}
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
                value={assigneeId ? `id:${assigneeId}` : assignee}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith('id:')) {
                    setAssignee('any');
                    setAssigneeId(v.slice(3));
                  } else changeAssignee(v as InboxAssignee);
                }}
              >
                <option value="any">{t('inbox.filters.anyone')}</option>
                <option value="mine">{t('inbox.filters.mine')}</option>
                <option value="unassigned">{t('inbox.filters.unassigned')}</option>
                {agents
                  .filter((a) => a.id !== currentUserId)
                  .map((a) => (
                    <option key={a.id} value={`id:${a.id}`}>
                      {a.name || a.email}
                    </option>
                  ))}
              </select>
              {teams.length > 0 && (
                <>
                  <label className="sr-only" htmlFor="chat-filter-team">
                    {t('teams.filter')}
                  </label>
                  <select id="chat-filter-team" className="select" value={teamId} onChange={(e) => changeTeam(e.target.value)}>
                    <option value="">{t('teams.all')}</option>
                    {teams.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <label className="sr-only" htmlFor="chat-filter-priority">
                {t('conversation.priority')}
              </label>
              <select id="chat-filter-priority" className="select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="">{t('views.anyPriority')}</option>
                {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`priorities.${p}`)}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="chat-filter-channel">
                {t('channels.label')}
              </label>
              <select id="chat-filter-channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">{t('channels.all')}</option>
                <option value="web">{t('channels.web')}</option>
                <option value="email">{t('channels.email')}</option>
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
            {(view ? viewChanged : hasCustomFilters({ ...filters, q: q.trim() })) && !saving && (
              <div className="chat-view-actions">
                {view && viewChanged && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => void updateView()}>
                    {t('views.update')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSaving({ name: '', shared: false, busy: false, error: null })}
                >
                  {t('views.saveAs')}
                </button>
              </div>
            )}
            {saving && (
              <form
                className="chat-view-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveView();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSaving(null);
                }}
              >
                <label className="sr-only" htmlFor="chat-view-name">
                  {t('views.name')}
                </label>
                <input
                  id="chat-view-name"
                  className="input"
                  autoFocus
                  maxLength={80}
                  placeholder={t('views.namePlaceholder')}
                  value={saving.name}
                  onChange={(e) => setSaving({ ...saving, name: e.target.value })}
                />
                <label className="ui-check">
                  <input type="checkbox" checked={saving.shared} onChange={(e) => setSaving({ ...saving, shared: e.target.checked })} />
                  {t('views.share')}
                </label>
                <div className="chat-view-form-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving(null)}>
                    {t('common.cancel')}
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={!saving.name.trim() || saving.busy} aria-busy={saving.busy || undefined}>
                    {t('views.save')}
                  </button>
                </div>
                {saving.error && (
                  <p className="ui-error" role="alert">
                    {saving.error}
                  </p>
                )}
              </form>
            )}
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
                emptyTitle={following ? t('views.followingEmpty') : filtered ? t('inbox.empty') : t('inbox.emptyOpen')}
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
