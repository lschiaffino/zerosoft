'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
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
import { NotebookShareDrawer } from './NoteSharePeople';
import NotesAskPanel from './NotesAskPanel';
import NotesIcon from './NotesIcon';
import RowMenu from './RowMenu';
import { usePopover } from './usePopover';
import {
  SEARCH_OPERATORS,
  emptyKind,
  filterQuery,
  isTypingTarget,
  listKey,
  sameFilter,
  stepIndex,
  type NotesFilter,
} from './notes-ui';

export type { NotesFilter } from './notes-ui';

type Pane = 'nav' | 'list' | 'editor';

interface Props {
  locale: string;
  aiEnabled: boolean;
  initialNotes: NoteSummary[];
  initialNotebooks: NotebookInfo[];
  initialTags: TagInfo[];
  initialNote: NoteDetail | null;
  /** Filtro inicial de la lista (p. ej. "Compartidas conmigo" desde un aviso). */
  initialFilter?: NotesFilter;
  startNew?: boolean;
  /** "Ahora" del render del servidor (fechas relativas sin hydration mismatch). */
  serverNow: number;
}

const TOAST_MS = 6000;

/**
 * Notes: tres paneles (libretas · lista · editor), como Apple Notes. En
 * pantallas chicas se ve un panel por vez, con navegación hacia atrás.
 * Teclado: N nueva nota, / buscar, flechas para recorrer la lista.
 */
export default function NotesApp({
  aiEnabled,
  initialNotes,
  initialNotebooks,
  initialTags,
  initialNote,
  initialFilter,
  startNew = false,
  serverNow,
}: Props) {
  const t = useTranslations('notes');
  const format = useFormatter();
  const [filter, setFilter] = useState<NotesFilter>(initialFilter ?? { kind: 'all' });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<NotesSort>('updated');
  const [notes, setNotes] = useState<NoteSummary[]>(initialNotes);
  const [notebooks, setNotebooks] = useState<NotebookInfo[]>(initialNotebooks);
  const [tags, setTags] = useState<TagInfo[]>(initialTags);
  const [note, setNote] = useState<NoteDetail | null>(initialNote);
  const [pane, setPane] = useState<Pane>(initialNote ? 'editor' : 'list');
  const [loading, setLoading] = useState(false);
  const [loadedKey, setLoadedKey] = useState(() => listKey(initialFilter ?? { kind: 'all' }, 'updated'));
  const [listError, setListError] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [newNotebook, setNewNotebook] = useState(false);
  const [renamingNotebook, setRenamingNotebook] = useState<string | null>(null);
  const [notebookMenu, setNotebookMenu] = useState<string | null>(null);
  const [sharingNotebook, setSharingNotebook] = useState<NotebookInfo | null>(null);
  const [focusTitle, setFocusTitle] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [toast, setToast] = useState<string | null>(null);
  /** Aviso de éxito (importación); `toast` es siempre de error. */
  const [okToast, setOkToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const searchHelp = usePopover();
  const searchRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);
  /** Al cambiar de filtro, la nota abierta se cierra si no está en la lista nueva. */
  const dropStaleNote = useRef(false);
  const reqSeq = useRef(0);
  /** POSTs de notas recién creadas aún en vuelo (id → ok). */
  const pendingCreates = useRef(new Map<string, Promise<boolean>>());
  const [now, setNow] = useState(serverNow);
  /** `updated_at` que conoce este cliente por nota: va en cada PATCH (409 si cambió en otro lado). */
  const bases = useRef(new Map<string, string>(initialNote ? [[initialNote.id, initialNote.updated_at]] : []));
  /** Guardados de una nota en fila: dos en paralelo con la misma base chocarían entre sí. */
  const saveChains = useRef(new Map<string, Promise<unknown>>());
  /**
   * Conflicto: la nota cambió en otra pestaña o dispositivo (o fue a la
   * papelera). `retry` vuelve a mandar lo último propio sin chequear la base.
   */
  const [conflict, setConflict] = useState<{ id: string; trashed: boolean; retry: (() => Promise<unknown>) | null } | null>(null);
  /** Sube al recargar la nota tras un conflicto: el editor se monta de nuevo con el contenido del servidor. */
  const [editorKey, setEditorKey] = useState(0);

  /** Encola un PATCH de la nota detrás de los anteriores. */
  const enqueue = useCallback(<T,>(id: string, run: () => Promise<T>): Promise<T> => {
    const prev = saveChains.current.get(id) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    saveChains.current.set(id, next);
    void next
      .catch(() => {})
      .finally(() => {
        if (saveChains.current.get(id) === next) saveChains.current.delete(id);
      });
    return next;
  }, []);

  /** Manda un PATCH con la base conocida (o sin ella, para "conservar la mía"). */
  const sendPatch = useCallback(
    async (
      id: string,
      patch: Record<string, unknown>,
      force = false,
    ): Promise<{ conflict: 'trashed' | 'changed'; updated?: undefined } | { conflict?: undefined; updated: NoteDetail }> => {
      const base = bases.current.get(id);
      const body = force || !base ? patch : { ...patch, base_updated_at: base };
      const res = await fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        return { conflict: data?.error === 'note_trashed' ? 'trashed' : 'changed' };
      }
      if (!res.ok) throw new Error(String(res.status));
      const updated = (await res.json()) as NoteDetail;
      bases.current.set(id, updated.updated_at);
      return { updated };
    },
    [],
  );

  useEffect(() => {
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(h);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(h);
  }, [toast]);

  useEffect(() => {
    if (!okToast) return;
    const h = setTimeout(() => setOkToast(null), TOAST_MS);
    return () => clearTimeout(h);
  }, [okToast]);

  const refreshList = useCallback(async () => {
    const seq = ++reqSeq.current;
    const key = listKey(filter, sort);
    setLoading(true);
    try {
      const res = await fetch(`/api/notes?${filterQuery(filter, q, sort)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { notes: NoteSummary[] };
      if (seq === reqSeq.current) {
        setNotes(data.notes);
        if (dropStaleNote.current) {
          dropStaleNote.current = false;
          setNote((cur) =>
            cur && !pendingCreates.current.has(cur.id) && !data.notes.some((n) => n.id === cur.id) ? null : cur,
          );
        }
        setLoadedKey(key);
        setListError(false);
      }
    } catch {
      if (seq === reqSeq.current) setListError(true);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [filter, q, sort]);

  const refreshSide = useCallback(async () => {
    const [nb, tg] = await Promise.all([
      fetch('/api/notes/notebooks').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/notes/tags').then((r) => (r.ok ? r.json() : null)).catch(() => null),
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

  const openNote = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/notes/${id}`);
        if (!res.ok) throw new Error(String(res.status));
        const opened = (await res.json()) as NoteDetail;
        bases.current.set(opened.id, opened.updated_at);
        setNote(opened);
        setConflict((c) => (c && c.id !== opened.id ? null : c));
        setPane('editor');
        setStatus('idle');
      } catch {
        setToast(t('editor.openError'));
      }
    },
    [t],
  );

  /** Abrir desde un link [[ ]] o "Enlazada desde". */
  const openLinkedNote = useCallback((id: string) => void openNote(id), [openNote]);

  /** Recarga la nota abierta (después de restaurar una versión): el editor se monta de nuevo. */
  const reloadNote = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/notes/${id}`);
        if (!res.ok) throw new Error(String(res.status));
        const fresh = (await res.json()) as NoteDetail;
        bases.current.set(fresh.id, fresh.updated_at);
        setNote((cur) => (cur && cur.id === fresh.id ? fresh : cur));
        setEditorKey((k) => k + 1);
        setStatus('idle');
        void refreshList();
      } catch {
        setToast(t('editor.openError'));
      }
    },
    [refreshList, t],
  );

  /**
   * Espera el autoguardado (debounce del editor + PATCH en vuelo) y trae la
   * nota del servidor: lo que usa "Enviar a Track" para mandar lo último.
   */
  const syncNote = useCallback(async (id: string): Promise<NoteDetail | null> => {
    await new Promise((r) => setTimeout(r, 700));
    await pendingCreates.current.get(id);
    await saveChains.current.get(id)?.catch(() => {});
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as NoteDetail;
      bases.current.set(fresh.id, fresh.updated_at);
      return fresh;
    } catch {
      return null;
    }
  }, []);

  /** Importar .enex / .md: crea las notas (en la libreta abierta, si hay) y recarga la lista. */
  const importFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setImporting(true);
      try {
        // Un archivo por request: en Vercel el cuerpo de una función tiene tope (~4.5 MB).
        let imported = 0;
        let failed = 0;
        for (const f of files) {
          const body = new FormData();
          body.append('file', f);
          if (filter.kind === 'notebook') body.append('notebook_id', filter.id);
          const res = await fetch('/api/notes/import', { method: 'POST', body });
          const data = (await res.json().catch(() => null)) as
            | { imported?: number; errors?: Array<{ file: string; code: string }>; error?: string }
            | null;
          if (!res.ok || !data) {
            failed += 1;
            continue;
          }
          imported += data.imported ?? 0;
          failed += data.errors?.length ?? 0;
        }
        if (failed && !imported) setToast(t('import.noneImported', { failed }));
        else setOkToast(failed ? t('import.partial', { count: imported, failed }) : t('import.done', { count: imported }));
        if (filter.kind === 'trash') setFilter({ kind: 'all' });
        void refreshList();
        void refreshSide();
      } catch {
        setToast(t('import.failed'));
      } finally {
        setImporting(false);
      }
    },
    [filter, refreshList, refreshSide, t],
  );

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
      .then(async (res) => {
        if (!res.ok) return false;
        const saved = (await res.json().catch(() => null)) as NoteDetail | null;
        if (saved?.updated_at) bases.current.set(id, saved.updated_at);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        pendingCreates.current.delete(id);
      });
    pendingCreates.current.set(id, request);
    if (filter.kind === 'trash' || filter.kind === 'shared') setFilter({ kind: 'all' });
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
      if (document.querySelector('dialog[open]')) return;
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
  const saveContent = useCallback(
    async (id: string, patch: { title: string; content: DocsBlock[] }) => {
      setStatus('saving');
      const creating = pendingCreates.current.get(id);
      if (creating && !(await creating)) {
        setStatus('error');
        return;
      }
      const snippet = makeSnippet(blocksToText(patch.content).replace(/<[^>]*>/g, ''));
      const nowIso = new Date().toISOString();
      setNotes((prev) => {
        const idx = prev.findIndex((n) => n.id === id);
        if (idx < 0) return prev;
        const updated = { ...prev[idx], title: patch.title, snippet, updated_at: nowIso };
        const rest = prev.filter((n) => n.id !== id);
        return sort === 'updated' ? [updated, ...rest] : prev.map((n) => (n.id === id ? updated : n));
      });
      const run = async (force: boolean): Promise<void> => {
        try {
          const res = await sendPatch(id, patch, force);
          if (res.conflict) {
            setStatus('idle');
            setConflict({ id, trashed: res.conflict === 'trashed', retry: () => enqueue(id, () => run(true)) });
            return;
          }
          setConflict((c) => (c?.id === id ? null : c));
          setStatus('saved');
        } catch {
          setStatus('error');
        }
      };
      await enqueue(id, () => run(false));
    },
    [sort, sendPatch, enqueue],
  );

  /** Cambios de metadatos (tags, libreta, fijada, papelera). null = falló (con aviso). */
  const patchNote = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      await pendingCreates.current.get(id);
      try {
        // Solo los cambios que tocan la nota llevan la base (mandar a la papelera o restaurar no).
        const guarded = !('trashed' in patch);
        const res = await enqueue(id, () => sendPatch(id, patch, !guarded));
        if (res.conflict) {
          setConflict({ id, trashed: res.conflict === 'trashed', retry: null });
          return null;
        }
        const updated = res.updated;
        setNote((cur) => (cur && cur.id === id ? { ...updated, content: cur.content, title: cur.title } : cur));
        void refreshList();
        void refreshSide();
        return updated;
      } catch {
        setToast(t('editor.actionError'));
        return null;
      }
    },
    [refreshList, refreshSide, t, enqueue, sendPatch],
  );

  /** Conflicto: "Cargar la última versión" descarta lo propio sin guardar. */
  const reloadAfterConflict = useCallback(async () => {
    const c = conflict;
    if (!c) return;
    try {
      const res = await fetch(`/api/notes/${c.id}`);
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as NoteDetail;
      bases.current.set(fresh.id, fresh.updated_at);
      setConflict(null);
      setNote((cur) => (cur && cur.id === fresh.id ? fresh : cur));
      setEditorKey((k) => k + 1);
      setStatus('idle');
      void refreshList();
    } catch {
      setToast(t('editor.openError'));
    }
  }, [conflict, refreshList, t]);

  /** Conflicto: "Conservar la mía" guarda lo de esta pestaña encima, a sabiendas. */
  const overwriteAfterConflict = useCallback(async () => {
    const retry = conflict?.retry;
    if (!retry) return;
    setStatus('saving');
    await retry();
  }, [conflict]);

  const trash = useCallback(
    async (id: string) => {
      if (!(await patchNote(id, { trashed: true }))) return;
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
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      setNote(null);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setPane('list');
    },
    [t],
  );

  const emptyTrash = useCallback(async () => {
    if (!confirm(t('trash.confirmEmpty'))) return;
    const res = await fetch('/api/notes/trash', { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setToast(t('editor.actionError'));
      return;
    }
    setNotes([]);
    setNote(null);
  }, [t]);

  const addNotebook = useCallback(
    async (name: string) => {
      setNewNotebook(false);
      if (!name.trim()) return;
      const res = await fetch('/api/notes/notebooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      const nb = (await res.json()) as NotebookInfo;
      setNotebooks((prev) => [...prev, nb].sort((a, b) => a.name.localeCompare(b.name)));
      setFilter({ kind: 'notebook', id: nb.id });
      setPane('list');
    },
    [t],
  );

  const renameNotebook = useCallback(
    async (nb: NotebookInfo, raw: string) => {
      setRenamingNotebook(null);
      const name = raw.trim();
      if (!name || name === nb.name) return;
      setNotebooks((prev) => prev.map((x) => (x.id === nb.id ? { ...x, name } : x)));
      const res = await fetch(`/api/notes/notebooks/${nb.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }).catch(() => null);
      if (!res?.ok) setToast(t('editor.actionError'));
      void refreshSide();
    },
    [refreshSide, t],
  );

  const deleteNotebook = useCallback(
    async (nb: NotebookInfo) => {
      if (!confirm(t('notebooks.confirmDelete', { name: nb.name }))) return;
      const res = await fetch(`/api/notes/notebooks/${nb.id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) {
        setToast(t('editor.actionError'));
        return;
      }
      setFilter({ kind: 'all' });
      if (note?.notebook_id === nb.id) setNote(null);
      void refreshSide();
    },
    [note, refreshSide, t],
  );

  function choose(f: NotesFilter) {
    if (!sameFilter(f, filter)) dropStaleNote.current = true;
    setFilter(f);
    setPane('list');
  }

  const isActive = (f: NotesFilter) => sameFilter(f, filter);

  const listTitle = useMemo(() => {
    if (filter.kind === 'pinned') return t('nav.pinned');
    if (filter.kind === 'trash') return t('nav.trash');
    if (filter.kind === 'shared') return t('nav.shared');
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

  /** Flechas en la lista: mueven el foco y abren la nota, como en Apple Notes. */
  function onListKey(e: React.KeyboardEvent) {
    const items = Array.from(itemsRef.current?.querySelectorAll<HTMLButtonElement>('.notes-item') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = stepIndex(current, e.key, items.length);
    if (next == null) return;
    e.preventDefault();
    items[next].focus();
    const id = items[next].dataset.id;
    if (id && id !== note?.id) void openNote(id);
  }

  const showSkeleton = loading && loadedKey !== listKey(filter, sort);
  const empty = emptyKind(filter, q);
  const navItem = (f: NotesFilter, label: string, icon?: 'pin' | 'trash' | 'users') => (
    <button
      type="button"
      className="notes-nav-item"
      aria-current={isActive(f) ? 'true' : undefined}
      onClick={() => choose(f)}
    >
      {icon && <NotesIcon name={icon} size={14} />}
      <span className="notes-nav-name">{label}</span>
    </button>
  );

  return (
    <div className="notes-app" data-pane={pane}>
      {/* ---------- Libretas / filtros ---------- */}
      <aside className="notes-nav" aria-label={t('nav.label')}>
        <div className="notes-nav-top">
          <button type="button" className="btn btn-primary btn-block notes-new" onClick={() => void createNote()}>
            <NotesIcon name="plus" size={14} />
            {t('actions.newNote')}
            <kbd className="kbd">N</kbd>
          </button>
        </div>
        <nav className="notes-nav-list" aria-label={t('nav.label')}>
          {navItem({ kind: 'all' }, t('nav.all'))}
          {navItem({ kind: 'pinned' }, t('nav.pinned'), 'pin')}
          {navItem({ kind: 'shared' }, t('nav.shared'), 'users')}

          <div className="notes-nav-section">
            <h2>{t('nav.notebooks')}</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => setNewNotebook(true)}
              aria-label={t('notebooks.new')}
              title={t('notebooks.new')}
            >
              <NotesIcon name="plus" size={14} />
            </button>
          </div>
          {newNotebook && (
            <input
              className="input notes-nav-input"
              autoFocus
              placeholder={t('notebooks.namePlaceholder')}
              aria-label={t('notebooks.namePlaceholder')}
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNotebook(e.currentTarget.value);
                if (e.key === 'Escape') setNewNotebook(false);
              }}
              onBlur={(e) => void addNotebook(e.currentTarget.value)}
            />
          )}
          {notebooks.map((nb) =>
            renamingNotebook === nb.id ? (
              <input
                key={nb.id}
                className="input notes-nav-input"
                autoFocus
                defaultValue={nb.name}
                aria-label={t('notebooks.renameLabel')}
                maxLength={80}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void renameNotebook(nb, e.currentTarget.value);
                  if (e.key === 'Escape') setRenamingNotebook(null);
                }}
                onBlur={(e) => void renameNotebook(nb, e.currentTarget.value)}
              />
            ) : (
              <div key={nb.id} className="notes-nav-row">
                <button
                  type="button"
                  className="notes-nav-item"
                  aria-current={isActive({ kind: 'notebook', id: nb.id }) ? 'true' : undefined}
                  onClick={() => choose({ kind: 'notebook', id: nb.id })}
                >
                  <span className="notes-nav-name">{nb.name}</span>
                  <span className="notes-count num">{nb.count}</span>
                </button>
                <RowMenu
                  className="notes-nav-menu"
                  open={notebookMenu === nb.id}
                  label={`${t('notebooks.actions')}: ${nb.name}`}
                  onToggle={(open) => setNotebookMenu(open ? nb.id : null)}
                  items={[
                    {
                      label: t('notebooks.rename'),
                      onSelect: () => {
                        setNotebookMenu(null);
                        setRenamingNotebook(nb.id);
                      },
                    },
                    {
                      label: t('notebooks.share'),
                      onSelect: () => {
                        setNotebookMenu(null);
                        setSharingNotebook(nb);
                      },
                    },
                    {
                      label: t('notebooks.delete'),
                      danger: true,
                      onSelect: () => {
                        setNotebookMenu(null);
                        void deleteNotebook(nb);
                      },
                    },
                  ]}
                />
              </div>
            ),
          )}
          {notebooks.length === 0 && !newNotebook && <p className="notes-nav-hint">{t('notebooks.empty')}</p>}

          {tags.length > 0 && (
            <>
              <div className="notes-nav-section">
                <h2>{t('nav.tags')}</h2>
              </div>
              {tags.map((tg) => (
                <button
                  key={tg.tag}
                  type="button"
                  className="notes-nav-item"
                  aria-current={isActive({ kind: 'tag', tag: tg.tag }) ? 'true' : undefined}
                  onClick={() => choose({ kind: 'tag', tag: tg.tag })}
                >
                  <span className="notes-nav-name">
                    <span className="notes-hash" aria-hidden="true">#</span>
                    {tg.tag}
                  </span>
                  <span className="notes-count num">{tg.count}</span>
                </button>
              ))}
            </>
          )}

          <div className="notes-nav-spacer" />
          <button
            type="button"
            className="notes-nav-item"
            onClick={() => importRef.current?.click()}
            aria-busy={importing}
            disabled={importing}
            title={t('import.hint')}
          >
            <NotesIcon name="import" size={14} />
            <span className="notes-nav-name">{importing ? t('import.importing') : t('import.button')}</span>
          </button>
          <input
            ref={importRef}
            type="file"
            hidden
            multiple
            accept=".enex,.md,.markdown,.txt,text/markdown,text/plain"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void importFiles(files);
            }}
          />
          {navItem({ kind: 'trash' }, t('nav.trash'), 'trash')}
        </nav>
        {aiEnabled && (
          <div className="notes-nav-foot">
            <button type="button" className="notes-nav-item" onClick={() => setAskOpen(true)}>
              <NotesIcon name="ask" size={14} />
              <span className="notes-nav-name">{t('ask.open')}</span>
            </button>
          </div>
        )}
      </aside>

      {/* ---------- Lista ---------- */}
      <div className="notes-list" role="region" aria-label={listTitle}>
        <div className="notes-list-head">
          <button type="button" className="notes-back" onClick={() => setPane('nav')}>
            <NotesIcon name="back" size={14} />
            {t('nav.label')}
          </button>
          <div className="notes-list-title">
            <h1>{listTitle}</h1>
            <button
              type="button"
              className="btn btn-sm btn-icon notes-list-new"
              onClick={() => void createNote()}
              aria-label={t('actions.newNote')}
              title={t('actions.newNote')}
            >
              <NotesIcon name="plus" size={14} />
            </button>
          </div>
          <div className="notes-list-tools">
            <label className="notes-search">
              <NotesIcon name="search" size={14} />
              <input
                ref={searchRef}
                className="input"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && q) {
                    e.preventDefault();
                    setQ('');
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    itemsRef.current?.querySelector<HTMLButtonElement>('.notes-item')?.focus();
                  }
                }}
                placeholder={t('list.search')}
                aria-label={t('list.search')}
                aria-keyshortcuts="/"
              />
              {!q && (
                <kbd className="kbd" title={t('list.searchHint')} aria-hidden="true">
                  /
                </kbd>
              )}
            </label>
            <div className="note-share-wrap" ref={searchHelp.wrapRef}>
              <button
                ref={searchHelp.buttonRef}
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={searchHelp.toggle}
                aria-expanded={searchHelp.open}
                aria-haspopup="dialog"
                aria-label={t('searchHelp.button')}
                title={t('searchHelp.button')}
              >
                ?
              </button>
              {searchHelp.open && (
                <div className="notes-pop notes-search-help" role="dialog" aria-label={t('searchHelp.title')}>
                  <p className="notes-pop-title">{t('searchHelp.title')}</p>
                  <dl>
                    {SEARCH_OPERATORS.map((op) => (
                      <div key={op}>
                        <dt>
                          <button
                            type="button"
                            className="notes-search-op"
                            onClick={() => {
                              const syntax = t(`searchHelp.items.${op}.syntax`);
                              setQ((cur) => `${cur.trim() ? `${cur.trim()} ` : ''}${syntax}`);
                              searchHelp.close();
                              searchRef.current?.focus();
                            }}
                          >
                            {t(`searchHelp.items.${op}.syntax`)}
                          </button>
                        </dt>
                        <dd>{t(`searchHelp.items.${op}.desc`)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
          <div className="notes-list-meta">
            <span className="notes-list-count">{q.trim() ? t('list.resultCount', { count: notes.length }) : t('list.count', { count: notes.length })}</span>
            <select
              className="select notes-sort"
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
            <button type="button" className="btn btn-sm btn-danger notes-empty-trash" onClick={() => void emptyTrash()}>
              {t('trash.empty')}
            </button>
          )}
        </div>
        <div
          ref={itemsRef}
          className={`notes-list-items${loading && !showSkeleton ? ' is-refreshing' : ''}`}
          aria-busy={loading}
          onKeyDown={onListKey}
        >
          {listError ? (
            <div className="notes-list-error" role="alert">
              <p>{t('list.loadError')}</p>
              <button type="button" className="btn btn-sm" onClick={() => void refreshList()}>
                {t('list.retry')}
              </button>
            </div>
          ) : showSkeleton ? (
            <div className="notes-skeleton" aria-label={t('list.loading')}>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="notes-skeleton-item">
                  <span className="ui-skeleton ui-skeleton-text" style={{ width: `${70 - i * 6}%` }} />
                  <span className="ui-skeleton ui-skeleton-text" />
                </div>
              ))}
            </div>
          ) : notes.length === 0 ? (
            empty === 'search' ? (
              <div className="notes-no-results">
                <p>{t('list.noResults', { q })}</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setQ('');
                    searchRef.current?.focus();
                  }}
                >
                  {t('list.clearSearch')}
                </button>
              </div>
            ) : empty === 'trash' ? (
              <EmptyState quiet product="notes" className="notes-empty" title={t('trash.emptyState')} body={t('trash.emptyStateBody')} />
            ) : empty === 'shared' ? (
              <EmptyState quiet product="notes" className="notes-empty" title={t('list.emptySharedTitle')} body={t('list.emptySharedBody')} />
            ) : (
              <EmptyState
                quiet
                product="notes"
                className="notes-empty"
                title={
                  empty === 'pinned'
                    ? t('list.emptyPinnedTitle')
                    : empty === 'notebook'
                      ? t('list.emptyNotebookTitle')
                      : t('list.emptyTitle')
                }
                body={
                  empty === 'pinned'
                    ? t('list.emptyPinnedBody')
                    : empty === 'notebook'
                      ? t('list.emptyNotebookBody')
                      : t('list.emptyBody')
                }
                action={
                  empty === 'pinned' ? undefined : (
                    <button type="button" className="btn btn-primary" onClick={() => void createNote()}>
                      {t('actions.newNote')}
                    </button>
                  )
                }
                secondary={empty === 'all' ? <Link href="/app/notes/clip">{t('list.emptyClip')}</Link> : undefined}
              />
            )
          ) : (
            notes.map((n) => (
              <button
                key={n.id}
                type="button"
                data-id={n.id}
                className="notes-item"
                aria-current={note?.id === n.id ? 'true' : undefined}
                onClick={() => void openNote(n.id)}
              >
                <span className="notes-item-title">
                  {n.pinned && !n.trashed && (
                    <span className="notes-pin" title={t('editor.pinned')}>
                      <NotesIcon name="pin" size={12} />
                      <span className="sr-only">{t('editor.pinned')}</span>
                    </span>
                  )}
                  {n.title || <span className="notes-untitled">{t('untitled')}</span>}
                </span>
                {n.snippet && <span className="notes-item-snippet">{n.snippet}</span>}
                <span className="notes-item-meta">
                  <time dateTime={n.updated_at}>{relTime(n.updated_at)}</time>
                  {n.shared_by && <span className="notes-item-owner">{t('list.sharedBy', { name: n.shared_by })}</span>}
                  {n.tags.slice(0, 3).map((tg) => (
                    <span key={tg} className="notes-item-tag">
                      #{tg}
                    </span>
                  ))}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ---------- Editor ---------- */}
      <div className="notes-editor">
        {note && conflict?.id === note.id && (
          <div className="docs-banner docs-banner-bad" role="alert">
            <span>{conflict.trashed ? t('editor.conflictTrashed') : t('editor.conflict')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void reloadAfterConflict()}>
              {t('editor.conflictReload')}
            </button>
            {!conflict.trashed && conflict.retry && (
              <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => void overwriteAfterConflict()}>
                {t('editor.conflictOverwrite')}
              </button>
            )}
          </div>
        )}
        {note ? (
          <NoteEditorPane
            key={`${note.id}:${editorKey}`}
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
            onError={() => {
              setToast(t('editor.actionError'));
            }}
            onOpenNote={openLinkedNote}
            onReload={(id) => void reloadNote(id)}
            onSync={syncNote}
            onTracked={(id, issues) => {
              setOkToast(t('track.done', { count: issues.length, list: issues.map((i) => i.identifier).join(', ') }));
              void reloadNote(id);
            }}
          />
        ) : (
          <div className="notes-editor-empty">
            {notes.length > 0 && (
              <p className="notes-editor-empty-hint">
                <kbd className="kbd">N</kbd>
                {t('editor.hintNew')}
                <span aria-hidden="true">·</span>
                <kbd className="kbd">/</kbd>
                {t('editor.hintSearch')}
              </p>
            )}
          </div>
        )}
      </div>

      {sharingNotebook && (
        <NotebookShareDrawer notebookId={sharingNotebook.id} name={sharingNotebook.name} onClose={() => setSharingNotebook(null)} />
      )}

      {askOpen && aiEnabled && (
        <NotesAskPanel
          onClose={() => setAskOpen(false)}
          onOpenNote={(id) => {
            setAskOpen(false);
            void openNote(id);
          }}
        />
      )}

      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && (
          <div className="ui-toast" data-tone="error">
            {toast}
            <button type="button" className="ui-toast-action" onClick={() => setToast(null)}>
              {t('ask.close')}
            </button>
          </div>
        )}
        {okToast && !toast && (
          <div className="ui-toast" data-tone="ok">
            {okToast}
            <button type="button" className="ui-toast-action" onClick={() => setOkToast(null)}>
              {t('ask.close')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
