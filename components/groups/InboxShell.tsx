'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { ChatDto, ChatFilter, GroupsPerson, LabelDto, PropertyDef } from '@/lib/groups';
import type { SavedListDto, SavedListFilters } from '@/lib/groups-org';
import { LISTS_CHANGED, notifyListsChanged } from './GroupsListsBranch';
import { filterOptions } from './PropertyInput';
import { ChatPlate, LabelTag, Modal, api, useErrorText, useMediaText, useRelativeTime, useToast } from './ui';

const FILTERS: ChatFilter[] = ['all', 'unread', 'unanswered', 'flagged', 'mine', 'unassigned', 'closed'];
const STORE = 'zs-groups-inbox';

interface InboxCtx {
  rows: ChatDto[];
  refresh: () => void;
}
const Ctx = createContext<InboxCtx>({ rows: [], refresh: () => {} });
export const useGroupsInbox = () => useContext(Ctx);

interface Controls {
  filter: ChatFilter;
  label: string;
  kind: string;
  assignee: string;
  propKey: string;
  propValue: string;
  q: string;
}

const EMPTY: Controls = { filter: 'all', label: '', kind: '', assignee: '', propKey: '', propValue: '', q: '' };

function readSaved(): Partial<Controls> | null {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    if (!raw) return null;
    const v = JSON.parse(raw) as { filter?: string; label?: string; kind?: string; assignee?: string };
    return {
      filter: FILTERS.includes(v.filter as ChatFilter) ? (v.filter as ChatFilter) : 'all',
      label: typeof v.label === 'string' ? v.label : '',
      kind: v.kind === 'group' || v.kind === 'dm' ? v.kind : '',
      assignee: typeof v.assignee === 'string' ? v.assignee : '',
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
    propKey: p?.key ?? '',
    propValue: p?.op === 'is' ? (p.value ?? '') : '',
    q: f.q ?? '',
  };
}

function chatIdFromPath(pathname: string): string | null {
  const m = /\/app\/groups\/inbox\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Bandeja de Groups: la lista con filtros y búsqueda (esta columna) y el
 * chat abierto (la página hija). Vive en el layout: la lista no se recarga
 * al cambiar de chat. Se refresca cada 5 s con la pestaña visible.
 * Las listas guardadas (?list=<id>) cargan sus filtros en los controles y se
 * guardan, renombran y borran desde acá. Teclado: J/K o flechas para
 * moverse, / para buscar.
 */
export default function InboxShell({
  labels,
  people = [],
  properties = [],
  me = '',
  initialLists = [],
  children,
}: {
  labels: LabelDto[];
  people?: GroupsPerson[];
  properties?: PropertyDef[];
  me?: string;
  initialLists?: SavedListDto[];
  children: ReactNode;
}) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const rel = useRelativeTime();
  const mediaText = useMediaText();
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const listId = params.get('list');
  const current = chatIdFromPath(pathname);
  const [controls, setControls] = useState<Controls>(EMPTY);
  const { filter, label, kind, assignee, propKey, propValue, q } = controls;
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
    if (listId) return;
    const saved = readSaved();
    if (saved) setControls((c) => ({ ...c, ...saved }));
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
      window.sessionStorage.setItem(STORE, JSON.stringify({ filter, label, kind, assignee }));
    } catch {
      // Sin storage: los filtros duran lo que dura la página.
    }
  }, [filter, label, kind, assignee, listId]);
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
    const p = new URLSearchParams({ filter, limit: '100' });
    if (debounced) p.set('q', debounced);
    if (label) p.set('label', label);
    if (kind) p.set('kind', kind);
    if (assignee) p.set('assignee', assignee);
    if (propKey) p.set('props', JSON.stringify([propValue ? { key: propKey, op: 'is', value: propValue } : { key: propKey, op: 'set' }]));
    return p.toString();
  }, [filter, debounced, label, kind, assignee, propKey, propValue]);

  const load = useCallback(
    async (silent: boolean) => {
      const mine = ++seq.current;
      if (!silent) setError(false);
      try {
        const res = await fetch(`/api/groups/chats?${query}`);
        if (!res.ok) throw new Error('failed');
        const data = (await res.json()) as { rows: ChatDto[]; total: number };
        if (mine !== seq.current) return;
        setRows(data.rows);
        setTotal(data.total);
        setError(false);
      } catch {
        if (mine === seq.current && !silent) setError(true);
      } finally {
        if (mine === seq.current) setLoaded(true);
      }
    },
    [query],
  );

  useEffect(() => {
    void load(false);
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const refresh = useCallback(() => void load(true), [load]);

  const go = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const i = rows.findIndex((r) => r.id === current);
      const next = rows[Math.min(rows.length - 1, Math.max(0, i < 0 ? 0 : i + delta))];
      if (next) router.push(`/app/groups/inbox/${next.id}${listId ? `?list=${listId}` : ''}`);
    },
    [rows, current, router, listId],
  );
  useKeyShortcut('/', () => searchRef.current?.focus());
  useKeyShortcut('j', () => go(1));
  useKeyShortcut('k', () => go(-1));

  const value = useMemo(() => ({ rows, refresh }), [rows, refresh]);
  const filters = controlsToFilters({ ...controls, q: debounced });
  const dirty = activeList ? JSON.stringify(filters) !== JSON.stringify(activeList.filters) : false;
  const canEditList = activeList ? activeList.ownerId === me || activeList.shared : false;
  const propDef = properties.find((p) => p.key === propKey) ?? null;
  const propOpts = propDef ? filterOptions(propDef) : [];
  const listSuffix = listId ? `?list=${listId}` : '';

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
    router.push(current ? `/app/groups/inbox/${current}` : '/app/groups/inbox');
  }

  return (
    <Ctx.Provider value={value}>
      <div className={`gr-inbox${current ? ' has-chat' : ''}`}>
        <section className="gr-list" aria-label={t('inbox.listLabel')}>
          <div className="gr-list-head">
            <div className="gr-list-titlebar">
              <h1 className="gr-list-title">{activeList ? activeList.name : t('inbox.title')}</h1>
            </div>
            {lists.length > 0 && (
              <nav className="gr-list-views" aria-label={t('lists.sidebar')}>
                <Link
                  href={`/app/groups/inbox${current ? `/${current}` : ''}`}
                  className={`gr-view${!listId ? ' is-on' : ''}`}
                  aria-current={!listId ? 'page' : undefined}
                  onClick={() => setControls(EMPTY)}
                >
                  {t('lists.allChats')}
                </Link>
                {lists.map((l) => (
                  <Link
                    key={l.id}
                    href={`/app/groups/inbox${current ? `/${current}` : ''}?list=${l.id}`}
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
                    <Link href={`/app/groups/broadcasts/new?list=${activeList.id}`} className="btn btn-ghost btn-sm">
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
            <div className="gr-filters" role="tablist" aria-label={t('inbox.filters')}>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  className={`gr-filter${filter === f ? ' is-on' : ''}`}
                  onClick={() => set({ filter: f })}
                >
                  {t(`filters.${f}`)}
                </button>
              ))}
            </div>
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
              <button type="button" className="btn btn-ghost btn-sm" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                {t('lists.moreFilters')}
              </button>
            </div>
            {moreOpen && (
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
            )}
            <div className="gr-list-save">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSaving('new')}>
                {t('lists.save')}
              </button>
            </div>
          </div>
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
            <p className="gr-list-empty">{debounced ? t('inbox.noResults') : activeList ? t('lists.empty') : t(`inbox.empty.${filter}`)}</p>
          ) : (
            <ul className="gr-rows">
              {rows.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/groups/inbox/${c.id}${listSuffix}`}
                    className={`gr-row${c.id === current ? ' is-active' : ''}${c.unread > 0 ? ' is-unread' : ''}`}
                    aria-current={c.id === current ? 'page' : undefined}
                  >
                    <ChatPlate name={c.name} kind={c.kind} />
                    <span className="gr-row-main">
                      <span className="gr-row-top">
                        <span className="gr-row-name">{c.name}</span>
                        <span className="gr-row-time">{rel(c.lastMessageAt ?? c.createdAt)}</span>
                      </span>
                      <span className="gr-row-preview">{c.match ?? mediaText({ preview: c.lastMessagePreview })}</span>
                      {(c.flagged || c.awaitingSince || c.labels.length > 0 || c.unread > 0) && (
                        <span className="gr-row-meta">
                          {c.flagged ? (
                            <span className="badge badge-bad">{t('inbox.flagged')}</span>
                          ) : c.awaitingSince ? (
                            <span className="badge badge-warn">{t('inbox.waiting', { time: rel(c.awaitingSince) })}</span>
                          ) : null}
                          {c.labels.slice(0, 2).map((l) => (
                            <LabelTag key={l.id} name={l.name} color={l.color} />
                          ))}
                          {c.unread > 0 && (
                            <span className="gr-unread" aria-label={t('inbox.unread', { n: c.unread })}>
                              {c.unread}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {loaded && total > rows.length && <p className="ui-help gr-list-more">{t('inbox.showing', { shown: rows.length, total })}</p>}
        </section>
        {children}
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
          router.push(`/app/groups/inbox${current ? `/${current}` : ''}?list=${l.id}`);
        }}
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
