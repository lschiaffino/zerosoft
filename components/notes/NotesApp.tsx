'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DocsBlock } from '@/lib/docs-types';
import {
  blocksToText,
  makeSnippet,
  type NoteDetail,
  type NoteSummary,
  type NotebookInfo,
  type NotesSort,
  type TagInfo,
} from '@/lib/notes-types';
import NoteEditorPane from './NoteEditorPane';
import NotesAskPanel from './NotesAskPanel';
import ClipBookmarklet from './ClipBookmarklet';

export type NotesFilter =
  | { kind: 'all' }
  | { kind: 'pinned' }
  | { kind: 'trash' }
  | { kind: 'notebook'; id: string }
  | { kind: 'tag'; tag: string };

type Pane = 'nav' | 'list' | 'editor';

interface Props {
  locale: string;
  aiEnabled: boolean;
  initialNotes: NoteSummary[];
  initialNotebooks: NotebookInfo[];
  initialTags: TagInfo[];
  initialNote: NoteDetail | null;
  startNew?: boolean;
  /** "Ahora" del render del servidor (fechas relativas sin hydration mismatch). */
  serverNow: number;
}

function filterQuery(f: NotesFilter, q: string, sort: NotesSort): string {
  const sp = new URLSearchParams();
  if (f.kind === 'pinned' || f.kind === 'trash') sp.set('view', f.kind);
  if (f.kind === 'notebook') sp.set('notebook', f.id);
  if (f.kind === 'tag') sp.set('tag', f.tag);
  if (q.trim()) sp.set('q', q.trim());
  sp.set('sort', sort);
  return sp.toString();
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/**
 * Notes: tres paneles (libretas · lista · editor). En pantallas chicas se ve
 * un panel por vez, con navegación hacia atrás.
 */
export default function NotesApp({
  locale,
  aiEnabled,
  initialNotes,
  initialNotebooks,
  initialTags,
  initialNote,
  startNew = false,
  serverNow,
}: Props) {
  const t = useTranslations('notes');
  const format = useFormatter();
  const [filter, setFilter] = useState<NotesFilter>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<NotesSort>('updated');
  const [notes, setNotes] = useState<NoteSummary[]>(initialNotes);
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>(initialNotebooks);
  const [tags, setTags] = useState<TagInfo[]>(initialTags);
  const [note, setNote] = useState<NoteDetail | null>(initialNote);
  const [pane, setPane] = useState<Pane>(initialNote ? 'editor' : 'list');
  const [loading, setLoading] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [newNotebook, setNewNotebook] = useState<string | null>(null);
  const [focusTitle, setFocusTitle] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const searchRef = useRef<HTMLInputElement>(null);
  const firstLoad = useRef(true);
  const reqSeq = useRef(0);
  /** POSTs de notas recién creadas aún en vuelo (id → ok). */
  const pendingCreates = useRef(new Map<string, Promise<boolean>>());
  const [now, setNow] = useState(serverNow);

  useEffect(() => {
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  const refreshList = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/notes?${filterQuery(filter, q, sort)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { notes: NoteSummary[] };
      if (seq === reqSeq.current) setNotes(data.notes);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [filter, q, sort]);

  const refreshSide = useCallback(async () => {
    const [nb, tg] = await Promise.all([
      fetch('/api/notes/notebooks').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/notes/tags').then((r) => (r.ok ? r.json() : null)),
    ]);
    if (nb) setNotebooks(nb.notebooks);
    if (tg) setTags(tg.tags);
  }, []);

  // Recarga la lista al cambiar filtro/orden (inmediato) o búsqueda (debounce).
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const h = setTimeout(refreshList, q ? 180 : 0);
    return () => clearTimeout(h);
  }, [refreshList, q]);

  // URL compartible (?note=<id>) sin navegar.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (note) url.searchParams.set('note', note.id);
    else url.searchParams.delete('note');
    url.searchParams.delete('new');
    window.history.replaceState(null, '', url.toString());
  }, [note]);

  const openNote = useCallback(async (id: string) => {
    const res = await fetch(`/api/notes/${id}`);
    if (!res.ok) return;
    setNote((await res.json()) as NoteDetail);
    setPane('editor');
    setStatus('idle');
  }, []);

  /**
   * Creación instantánea (optimista): la nota se abre y enfoca al toque con un
   * id generado en el cliente; el POST va en paralelo y los guardados de esa
   * nota esperan a que termine (pendingCreates).
   */
  const createNote = useCallback(async () => {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const created: NoteDetail = {
      id,
      notebook_id: filter.kind === 'notebook' ? filter.id : null,
      title: '',
      snippet: '',
      tags: filter.kind === 'tag' ? [filter.tag] : [],
      pinned: filter.kind === 'pinned',
      trashed: false,
      source_url: null,
      shared: false,
      share_token: null,
      created_at: nowIso,
      updated_at: nowIso,
      content: [{ id: crypto.randomUUID(), type: 'paragraph', content: '' }],
    };
    const request = fetch('/api/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id,
        content: created.content,
        notebook_id: created.notebook_id,
        tags: created.tags,
        pinned: created.pinned,
      }),
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        pendingCreates.current.delete(id);
      });
    pendingCreates.current.set(id, request);
    if (filter.kind === 'trash') setFilter({ kind: 'all' });
    setQ('');
    setNotes((prev) => [created, ...prev.filter((n) => n.id !== created.id)]);
    setNote(created);
    setPane('editor');
    setFocusTitle((n) => n + 1);
    if (filter.kind === 'notebook') {
      setNotebooks((prev) => prev.map((nb) => (nb.id === filter.id ? { ...nb, count: nb.count + 1 } : nb)));
    }
  }, [filter]);

  // Atajos: N = nueva nota, / = buscar (fuera de campos de texto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        void createNote();
      } else if (e.key === '/') {
        e.preventDefault();
        setPane('list');
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createNote]);

  // /app/notes?new=1 (sidebar "Nueva nota", ⌘K) crea al entrar.
  const startedNew = useRef(false);
  useEffect(() => {
    if (!startNew) {
      startedNew.current = false;
    } else if (!startedNew.current) {
      startedNew.current = true;
      void createNote();
    }
  }, [startNew, createNote]);

  /** Autosave del editor (DocsEditor ya hace debounce de 600 ms). */
  const saveContent = useCallback(async (id: string, patch: { title: string; content: DocsBlock[] }) => {
    setStatus('saving');
    const creating = pendingCreates.current.get(id);
    if (creating && !(await creating)) {
      setStatus('error');
      return;
    }
    const snippet = makeSnippet(blocksToText(patch.content).replace(/<[^>]*>/g, ''));
    const now = new Date().toISOString();
    setNotes((prev) => {
      const idx = prev.findIndex((n) => n.id === id);
      if (idx < 0) return prev;
      const updated = { ...prev[idx], title: patch.title, snippet, updated_at: now };
      const rest = prev.filter((n) => n.id !== id);
      return sort === 'updated' ? [updated, ...rest] : prev.map((n) => (n.id === id ? updated : n));
    });
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      setStatus(res.ok ? 'saved' : 'error');
    } catch {
      setStatus('error');
    }
  }, [sort]);

  /** Cambios de metadatos (tags, libreta, fijada, papelera). */
  const patchNote = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      await pendingCreates.current.get(id);
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const updated = (await res.json()) as NoteDetail;
      setNote((cur) => (cur && cur.id === id ? { ...updated, content: cur.content, title: cur.title } : cur));
      void refreshList();
      void refreshSide();
      return updated;
    },
    [refreshList, refreshSide],
  );

  const trash = useCallback(
    async (id: string) => {
      await patchNote(id, { trashed: true });
      setNote(null);
      setPane('list');
    },
    [patchNote],
  );

  const restore = useCallback(
    async (id: string) => {
      const updated = await patchNote(id, { trashed: false });
      if (updated) setNote(updated);
    },
    [patchNote],
  );

  const deleteForever = useCallback(
    async (id: string) => {
      if (!confirm(t('trash.confirmDelete'))) return;
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setNote(null);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setPane('list');
    },
    [t],
  );

  const emptyTrash = useCallback(async () => {
    if (!confirm(t('trash.confirmEmpty'))) return;
    const res = await fetch('/api/notes/trash', { method: 'DELETE' });
    if (!res.ok) return;
    setNotes([]);
    setNote(null);
  }, [t]);

  const addNotebook = useCallback(
    async (name: string) => {
      setNewNotebook(null);
      if (!name.trim()) return;
      const res = await fetch('/api/notes/notebooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      const nb = (await res.json()) as NotebookInfo;
      setNotebooks((prev) => [...prev, nb].sort((a, b) => a.name.localeCompare(b.name)));
      setFilter({ kind: 'notebook', id: nb.id });
      setPane('list');
    },
    [],
  );

  const renameNotebook = useCallback(
    async (nb: NotebookInfo) => {
      const name = prompt(t('notebooks.renamePrompt'), nb.name);
      if (!name?.trim() || name.trim() === nb.name) return;
      const res = await fetch(`/api/notes/notebooks/${nb.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) void refreshSide();
    },
    [refreshSide, t],
  );

  const deleteNotebook = useCallback(
    async (nb: NotebookInfo) => {
      if (!confirm(t('notebooks.confirmDelete', { name: nb.name }))) return;
      const res = await fetch(`/api/notes/notebooks/${nb.id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setFilter({ kind: 'all' });
      if (note?.notebook_id === nb.id) setNote(null);
      void refreshSide();
    },
    [note, refreshSide, t],
  );

  function choose(f: NotesFilter) {
    setFilter(f);
    setPane('list');
  }

  const isActive = (f: NotesFilter) =>
    f.kind === filter.kind &&
    (f.kind !== 'notebook' || (filter.kind === 'notebook' && filter.id === f.id)) &&
    (f.kind !== 'tag' || (filter.kind === 'tag' && filter.tag === f.tag));

  const listTitle = useMemo(() => {
    if (filter.kind === 'pinned') return t('nav.pinned');
    if (filter.kind === 'trash') return t('nav.trash');
    if (filter.kind === 'notebook') return notebooks.find((n) => n.id === filter.id)?.name ?? t('nav.notebooks');
    if (filter.kind === 'tag') return `#${filter.tag}`;
    return t('nav.all');
  }, [filter, notebooks, t]);

  const relTime = (iso: string) => {
    const d = new Date(iso);
    const diff = now - d.getTime();
    if (diff < 60_000) return t('list.justNow');
    if (diff < 7 * 86_400_000) return format.relativeTime(d, new Date(now));
    return format.dateTime(d, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
  };

  return (
    <div className="notes-app" data-pane={pane}>
      {/* ---------- Libretas / filtros ---------- */}
      <aside className="notes-nav" aria-label={t('nav.label')}>
        <button type="button" className="notes-new btn btn-solid" onClick={() => void createNote()}>
          {t('actions.newNote')}
          <kbd>N</kbd>
        </button>
        <nav className="notes-nav-list">
          <button type="button" className={`notes-nav-item${isActive({ kind: 'all' }) ? ' active' : ''}`} onClick={() => choose({ kind: 'all' })}>
            {t('nav.all')}
          </button>
          <button type="button" className={`notes-nav-item${isActive({ kind: 'pinned' }) ? ' active' : ''}`} onClick={() => choose({ kind: 'pinned' })}>
            {t('nav.pinned')}
          </button>

          <div className="notes-nav-section">
            <span>{t('nav.notebooks')}</span>
            <button type="button" className="notes-icon-btn" onClick={() => setNewNotebook('')} aria-label={t('notebooks.new')} title={t('notebooks.new')}>
              +
            </button>
          </div>
          {newNotebook !== null && (
            <input
              className="notes-inline-input"
              autoFocus
              placeholder={t('notebooks.namePlaceholder')}
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNotebook(e.currentTarget.value);
                if (e.key === 'Escape') setNewNotebook(null);
              }}
              onBlur={(e) => void addNotebook(e.currentTarget.value)}
            />
          )}
          {notebooks.map((nb) => (
            <div key={nb.id} className={`notes-nav-row${isActive({ kind: 'notebook', id: nb.id }) ? ' active' : ''}`}>
              <button type="button" className="notes-nav-item" onClick={() => choose({ kind: 'notebook', id: nb.id })}>
                <span className="notes-nav-name">{nb.name}</span>
                <span className="notes-count mono">{nb.count}</span>
              </button>
              <span className="notes-nav-actions">
                <button type="button" className="notes-icon-btn" onClick={() => void renameNotebook(nb)} aria-label={t('notebooks.rename')} title={t('notebooks.rename')}>
                  ✎
                </button>
                <button type="button" className="notes-icon-btn" onClick={() => void deleteNotebook(nb)} aria-label={t('notebooks.delete')} title={t('notebooks.delete')}>
                  ×
                </button>
              </span>
            </div>
          ))}
          {notebooks.length === 0 && newNotebook === null && <p className="notes-nav-hint">{t('notebooks.empty')}</p>}

          {tags.length > 0 && (
            <>
              <div className="notes-nav-section">
                <span>{t('nav.tags')}</span>
              </div>
              <div className="notes-nav-tags">
                {tags.map((tg) => (
                  <button
                    key={tg.tag}
                    type="button"
                    className={`notes-tag${isActive({ kind: 'tag', tag: tg.tag }) ? ' active' : ''}`}
                    onClick={() => choose({ kind: 'tag', tag: tg.tag })}
                  >
                    #{tg.tag}
                    <span className="mono">{tg.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="notes-nav-spacer" />
          <button type="button" className={`notes-nav-item${isActive({ kind: 'trash' }) ? ' active' : ''}`} onClick={() => choose({ kind: 'trash' })}>
            {t('nav.trash')}
          </button>
        </nav>
        <div className="notes-nav-foot">
          {aiEnabled && (
            <button type="button" className="notes-nav-item" onClick={() => setAskOpen(true)}>
              {t('ask.open')}
            </button>
          )}
          <ClipBookmarklet locale={locale} />
        </div>
      </aside>

      {/* ---------- Lista ---------- */}
      <div className="notes-list" role="region" aria-label={listTitle}>
        <div className="notes-list-head">
          <button type="button" className="notes-back" onClick={() => setPane('nav')} aria-label={t('nav.label')}>
            ‹ {t('nav.label')}
          </button>
          <div className="notes-list-title">
            <h1>{listTitle}</h1>
            <span className="mono">{t('list.count', { count: notes.length })}</span>
            <button
              type="button"
              className="notes-icon-btn notes-list-new"
              onClick={() => void createNote()}
              aria-label={t('actions.newNote')}
              title={t('actions.newNote')}
            >
              +
            </button>
          </div>
          <div className="notes-list-tools">
            <input
              ref={searchRef}
              className="notes-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('list.search')}
              aria-label={t('list.search')}
            />
            <select
              className="notes-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as NotesSort)}
              aria-label={t('list.sortLabel')}
            >
              <option value="updated">{t('list.sort.updated')}</option>
              <option value="created">{t('list.sort.created')}</option>
              <option value="title">{t('list.sort.title')}</option>
            </select>
          </div>
          {filter.kind === 'trash' && notes.length > 0 && (
            <button type="button" className="notes-link-btn danger" onClick={() => void emptyTrash()}>
              {t('trash.empty')}
            </button>
          )}
        </div>
        <div className={`notes-list-items${loading ? ' loading' : ''}`}>
          {notes.length === 0 ? (
            <div className="notes-empty">
              {q ? (
                <p>{t('list.noResults', { q })}</p>
              ) : filter.kind === 'trash' ? (
                <p>{t('trash.emptyState')}</p>
              ) : (
                <>
                  <p>{t('list.emptyTitle')}</p>
                  <button type="button" className="btn btn-solid" onClick={() => void createNote()}>
                    {t('actions.newNote')}
                  </button>
                </>
              )}
            </div>
          ) : (
            notes.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`notes-item${note?.id === n.id ? ' active' : ''}`}
                onClick={() => void openNote(n.id)}
              >
                <span className="notes-item-title">
                  {n.pinned && !n.trashed && <span className="notes-pin" aria-label={t('editor.pinned')}>●</span>}
                  {n.title || <span className="dim">{t('untitled')}</span>}
                </span>
                {n.snippet && <span className="notes-item-snippet">{n.snippet}</span>}
                <span className="notes-item-meta mono">
                  {relTime(n.updated_at)}
                  {n.tags.slice(0, 3).map((tg) => (
                    <span key={tg} className="notes-item-tag">#{tg}</span>
                  ))}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ---------- Editor ---------- */}
      <div className="notes-editor">
        {note ? (
          <NoteEditorPane
            key={note.id}
            note={note}
            notebooks={notebooks}
            focusTitle={focusTitle}
            status={status}
            onBack={() => setPane('list')}
            onSaveContent={saveContent}
            onPatch={patchNote}
            onTrash={trash}
            onRestore={restore}
            onDeleteForever={deleteForever}
            onShareChange={(token) => {
              setNote((cur) => (cur ? { ...cur, share_token: token, shared: token != null } : cur));
            }}
          />
        ) : (
          <div className="notes-empty notes-editor-empty">
            <p>{t('editor.emptyTitle')}</p>
            <button type="button" className="btn btn-solid" onClick={() => void createNote()}>
              {t('actions.newNote')}
            </button>
          </div>
        )}
      </div>

      {askOpen && aiEnabled && (
        <NotesAskPanel
          onClose={() => setAskOpen(false)}
          onOpenNote={(id) => {
            setAskOpen(false);
            void openNote(id);
          }}
        />
      )}
    </div>
  );
}
