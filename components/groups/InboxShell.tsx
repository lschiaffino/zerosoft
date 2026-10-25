'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import type { ChatDto, ChatFilter, GroupsPerson, LabelDto } from '@/lib/groups';
import { ChatPlate, LabelTag, api, useErrorText, useMediaText, useRelativeTime, useToast } from './ui';

const FILTERS: ChatFilter[] = ['all', 'unread', 'unanswered', 'flagged', 'mine', 'unassigned', 'closed'];
const STORE = 'zs-groups-inbox';

interface InboxCtx {
  rows: ChatDto[];
  refresh: () => void;
}
const Ctx = createContext<InboxCtx>({ rows: [], refresh: () => {} });
export const useGroupsInbox = () => useContext(Ctx);

function readSaved(): { filter: ChatFilter; label: string; kind: string; team: string } | null {
  try {
    const raw = window.sessionStorage.getItem(STORE);
    if (!raw) return null;
    const v = JSON.parse(raw) as { filter?: string; label?: string; kind?: string; team?: string };
    return {
      filter: FILTERS.includes(v.filter as ChatFilter) ? (v.filter as ChatFilter) : 'all',
      label: typeof v.label === 'string' ? v.label : '',
      kind: v.kind === 'group' || v.kind === 'dm' ? v.kind : '',
      team: typeof v.team === 'string' ? v.team : '',
    };
  } catch {
    return null;
  }
}

function chatIdFromPath(pathname: string): string | null {
  const m = /\/app\/groups\/inbox\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Bandeja de Groups: la lista con filtros y búsqueda (esta columna) y el
 * chat abierto (la página hija). Vive en el layout: la lista no se recarga
 * al cambiar de chat. Se refresca cada 5 s con la pestaña visible.
 * Teclado: J/K para moverse, / para buscar, X marca el chat abierto para
 * una acción en masa, Esc limpia la selección.
 */
export default function InboxShell({
  labels,
  people,
  teams,
  children,
}: {
  labels: LabelDto[];
  people: GroupsPerson[];
  teams: Array<{ id: string; name: string }>;
  children: ReactNode;
}) {
  const t = useTranslations('groups');
  const rel = useRelativeTime();
  const mediaText = useMediaText();
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [team, setTeam] = useState('');
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name || p.email])), [people]);
  const pathname = usePathname();
  const router = useRouter();
  const current = chatIdFromPath(pathname);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<ChatDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      setFilter(saved.filter);
      setLabel(saved.label);
      setKind(saved.kind);
      setTeam(saved.team);
    }
    void api<{ me: boolean }>('/api/groups/availability').then((r) => setAvailable(r.data ? r.data.me : true));
  }, []);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORE, JSON.stringify({ filter, label, kind, team }));
    } catch {
      // Sin storage: los filtros duran lo que dura la página.
    }
  }, [filter, label, kind, team]);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ filter, limit: '100' });
    if (debounced) p.set('q', debounced);
    if (label) p.set('label', label);
    if (kind) p.set('kind', kind);
    if (team) p.set('team', team);
    return p.toString();
  }, [filter, debounced, label, kind, team]);

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
      if (next) router.push(`/app/groups/inbox/${next.id}`);
    },
    [rows, current, router],
  );
  useKeyShortcut('/', () => searchRef.current?.focus());
  useKeyShortcut('j', () => go(1));
  useKeyShortcut('k', () => go(-1));
  useKeyShortcut('x', () => {
    if (current) toggleSelect(current);
  });
  useKeyShortcut('escape', () => setSelected(new Set()), selected.size > 0);

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

  return (
    <Ctx.Provider value={value}>
      <div className={`gr-inbox${current ? ' has-chat' : ''}`}>
        <section className="gr-list" aria-label={t('inbox.listLabel')}>
          <div className="gr-list-head">
            <div className="gr-list-titlebar">
              <h1 className="gr-list-title">{t('inbox.title')}</h1>
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
            <input
              ref={searchRef}
              className="input gr-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
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
                  onClick={() => setFilter(f)}
                >
                  {t(`filters.${f}`)}
                </button>
              ))}
            </div>
            <div className="gr-list-selects">
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('inbox.kind')}>
                <option value="">{t('inbox.kindAll')}</option>
                <option value="group">{t('inbox.kindGroups')}</option>
                <option value="dm">{t('inbox.kindDms')}</option>
              </select>
              <select className="select" value={label} onChange={(e) => setLabel(e.target.value)} aria-label={t('inbox.label')}>
                <option value="">{t('inbox.labelAll')}</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {teams.length > 0 && (
                <select className="select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label={t('inbox.team')}>
                  <option value="">{t('inbox.teamAll')}</option>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                {t('bulkInbox.clear')}
              </button>
            </div>
          )}
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
            <p className="gr-list-empty">{debounced ? t('inbox.noResults') : t(`inbox.empty.${filter}`)}</p>
          ) : (
            <ul className={`gr-rows${visibleSelected.length > 0 ? ' is-selecting' : ''}`}>
              {rows.map((c) => (
                <li key={c.id} className="gr-row-item">
                  <input
                    type="checkbox"
                    className="gr-row-check"
                    checked={selected.has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                    aria-label={t('bulkInbox.select', { name: c.name })}
                  />
                  <Link
                    href={`/app/groups/inbox/${c.id}`}
                    className={`gr-row${c.id === current ? ' is-active' : ''}${c.unread > 0 ? ' is-unread' : ''}`}
                    aria-current={c.id === current ? 'page' : undefined}
                  >
                    <ChatPlate name={c.name} kind={c.kind} />
                    <span className="gr-row-main">
                      <span className="gr-row-top">
                        <span className="gr-row-name">
                          {c.pinned && (
                            <svg className="gr-pin-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" role="img" aria-label={t('inbox.pinned')}>
                              <path d="M9 4h6l-1 6 4 4H6l4-4zM12 14v7" />
                            </svg>
                          )}
                          {c.name}
                        </span>
                        <span className="gr-row-time">{rel(c.lastMessageAt ?? c.createdAt)}</span>
                      </span>
                      <span className="gr-row-preview">{c.match ?? mediaText({ preview: c.lastMessagePreview })}</span>
                      {(c.flagged || c.awaitingSince || c.labels.length > 0 || c.unread > 0 || c.assignedTo) && (
                        <span className="gr-row-meta">
                          {c.flagged ? (
                            <span className="badge badge-bad">{t('inbox.flagged')}</span>
                          ) : c.awaitingSince ? (
                            <span className="badge badge-warn">{t('inbox.waiting', { time: rel(c.awaitingSince) })}</span>
                          ) : null}
                          {c.labels.slice(0, 2).map((l) => (
                            <LabelTag key={l.id} name={l.name} color={l.color} />
                          ))}
                          {c.assignedTo && <span className="gr-row-assignee">{peopleById.get(c.assignedTo) ?? ''}</span>}
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
      {toast}
    </Ctx.Provider>
  );
}
