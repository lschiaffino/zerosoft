'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import NotesIcon from '@/components/notes/NotesIcon';
import RowMenu from '@/components/notes/RowMenu';
import type { BoardDetail, BoardFolder, BoardSummary } from '@/lib/boards-types';
import { BOARD_TEMPLATES, type BoardTemplateKey } from '@/lib/board-templates';
import TemplatePreview from './TemplatePreview';
import { notifyBoardsChanged } from './BoardBranch';
import { preloadCanvas } from './preloadCanvas';
import { parseDbUtc } from '@/lib/utils';

const TOAST_MS = 6000;
/** Plantillas plegadas o abiertas: se recuerda por navegador. */
const TEMPLATES_KEY = 'board.templates.collapsed';
const SEARCH_DEBOUNCE_MS = 250;

/** Qué se ve: todas, una carpeta o la papelera. */
export type BoardView = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'trash' };

type Toast = { text: string; tone: 'error' | 'info'; undo?: () => void };

/** Diálogo con un solo campo (carpeta nueva, renombrar carpeta) o un selector (mover a carpeta). */
type Prompt =
  | { kind: 'newFolder'; value: string }
  | { kind: 'renameFolder'; id: string; value: string }
  | { kind: 'move'; board: BoardSummary; value: string };

/** Pizarras del workspace: carpetas, búsqueda por contenido, papelera, importar y plantillas. */
export default function BoardList({
  initialBoards,
  initialFolders = [],
  initialView = { kind: 'all' },
  startNew = false,
  serverNow,
}: {
  initialBoards: BoardSummary[];
  initialFolders?: BoardFolder[];
  initialView?: BoardView;
  startNew?: boolean;
  /** "Ahora" del render del servidor: el primer render del cliente usa el mismo (sin hydration mismatch). */
  serverNow: number;
}) {
  const t = useTranslations('board');
  const tt = useTranslations('board.templates');
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();
  const [boards, setBoards] = useState(initialBoards);
  const [folders, setFolders] = useState(initialFolders);
  const [view, setView] = useState<BoardView>(initialView);
  const [trash, setTrash] = useState<BoardSummary[] | null>(null);
  const [trashError, setTrashError] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BoardSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  // El sidebar lista las pizarras: se le avisa cada cambio local (renombrar, duplicar, borrar).
  const firstBoards = useRef(true);
  useEffect(() => {
    if (firstBoards.current) {
      firstBoards.current = false;
      return;
    }
    notifyBoardsChanged();
  }, [boards, folders]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState<BoardTemplateKey | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  /** Pizarra a borrar para siempre (desde la papelera), esperando la confirmación. */
  const [purging, setPurging] = useState<BoardSummary | null>(null);
  const [folderDeleting, setFolderDeleting] = useState<BoardFolder | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const promptInput = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const [templatesCollapsed, setTemplatesCollapsed] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => {
    try {
      setTemplatesCollapsed(window.localStorage.getItem(TEMPLATES_KEY) === '1');
    } catch {
      // Sin storage: quedan abiertas.
    }
  }, []);

  function toggleTemplates(open: boolean) {
    setTemplatesCollapsed(!open);
    try {
      window.localStorage.setItem(TEMPLATES_KEY, open ? '0' : '1');
    } catch {
      // Sin storage: vale solo para esta visita.
    }
  }
  const [now, setNow] = useState(serverNow);

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
    if (prompt) setTimeout(() => promptInput.current?.focus(), 0);
  }, [prompt]);

  // La vista viaja en la URL (?folder= o ?view=trash): el sidebar y Cmd+K abren una carpeta directo.
  const setViewAndUrl = useCallback(
    (next: BoardView) => {
      setView(next);
      setQuery('');
      const qs = next.kind === 'folder' ? `?folder=${encodeURIComponent(next.id)}` : next.kind === 'trash' ? '?view=trash' : '';
      router.replace(`/app/board${qs}`, { scroll: false });
    },
    [router],
  );
  useEffect(() => setView(initialView), [initialView]);

  const loadTrash = useCallback(async () => {
    setTrashError(false);
    const res = await fetch('/api/boards?trash=1').catch(() => null);
    if (!res?.ok) {
      setTrashError(true);
      setTrash((x) => x ?? []);
      return;
    }
    setTrash(((await res.json()) as { boards: BoardSummary[] }).boards);
  }, []);

  useEffect(() => {
    if (view.kind === 'trash') void loadTrash();
  }, [view.kind, loadTrash]);

  // Búsqueda por nombre y contenido (stickies, textos, frames), en todas las carpetas.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const res = await fetch(`/api/boards?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        setResults(((await res.json()) as { boards: BoardSummary[] }).boards);
        setSearchError(false);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setSearchError(true);
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      clearTimeout(h);
    };
  }, [query]);

  const currentFolderId = view.kind === 'folder' ? view.id : null;

  const create = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    preloadCanvas(); // el lienzo baja mientras se crea la pizarra
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: t('list.untitled'), folderId: currentFolderId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const board = (await res.json()) as BoardDetail;
      router.push(`/app/board/${board.id}`);
    } catch {
      setToast({ text: t('list.createError'), tone: 'error' });
      setBusy(false);
    }
  }, [busy, router, t, currentFolderId]);

  /** Pizarra nueva con la escena de la plantilla, en el idioma de la interfaz. */
  async function createFromTemplate(key: BoardTemplateKey) {
    if (busy || creatingTemplate) return;
    setCreatingTemplate(key);
    preloadCanvas();
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: tt(`${key}.name`), template: key, locale, folderId: currentFolderId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const board = (await res.json()) as BoardDetail;
      router.push(`/app/board/${board.id}`);
    } catch {
      setToast({ text: t('list.createError'), tone: 'error' });
      setCreatingTemplate(null);
    }
  }

  useEffect(() => {
    if (startNew && !started.current) {
      started.current = true;
      void create();
    }
  }, [startNew, create]);

  /** Importar uno o varios .excalidraw: cada uno es una pizarra nueva (en la carpeta abierta). */
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true);
    let ok = 0;
    let failed = 0;
    let last: BoardDetail | null = null;
    for (const file of Array.from(files).slice(0, 50)) {
      try {
        const text = await file.text();
        const res = await fetch('/api/boards/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: file.name, file: text, folderId: currentFolderId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        last = (await res.json()) as BoardDetail;
        const b = last;
        setBoards((list) => [toSummary(b), ...list]);
        ok++;
      } catch {
        failed++;
      }
    }
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok === 1 && failed === 0 && last) {
      router.push(`/app/board/${last.id}`);
      return;
    }
    if (failed) setToast({ text: t('import.partial', { ok, failed }), tone: 'error' });
    else setToast({ text: t('import.done', { count: ok }), tone: 'info' });
  }

  function patchEverywhere(id: string, patch: Partial<BoardSummary>) {
    setBoards((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    setResults((list) => list?.map((b) => (b.id === id ? { ...b, ...patch } : b)) ?? null);
  }

  async function rename(id: string, name: string) {
    setRenaming(null);
    const clean = name.trim();
    const prev = boards.find((b) => b.id === id) ?? results?.find((b) => b.id === id);
    if (!clean || !prev || clean === prev.name) return;
    patchEverywhere(id, { name: clean });
    const res = await fetch(`/api/boards/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: clean }),
    }).catch(() => null);
    if (!res?.ok) {
      patchEverywhere(id, { name: prev.name });
      setToast({ text: t('list.actionError'), tone: 'error' });
    }
  }

  async function duplicate(b: BoardSummary) {
    setMenu(null);
    const res = await fetch(`/api/boards/${b.id}/duplicate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: t('list.copyName', { name: b.name }).slice(0, 120) }),
    }).catch(() => null);
    if (!res?.ok) {
      setToast({ text: t('list.actionError'), tone: 'error' });
      return;
    }
    const copy = (await res.json()) as BoardDetail;
    setBoards((list) => [toSummary(copy), ...list]);
  }

  async function restore(b: BoardSummary, silent = false) {
    const res = await fetch(`/api/boards/${b.id}/trash`, { method: 'POST' }).catch(() => null);
    if (!res?.ok) {
      setToast({ text: t('list.actionError'), tone: 'error' });
      return false;
    }
    setTrash((list) => list?.filter((x) => x.id !== b.id) ?? null);
    const { deleted_at: _d, ...alive } = b;
    void _d;
    setBoards((list) => (list.some((x) => x.id === b.id) ? list : [alive, ...list]));
    if (!silent) setToast({ text: t('trash.restored', { name: b.name }), tone: 'info' });
    return true;
  }

  /** Borrar = a la papelera (30 días), con deshacer en el aviso. */
  async function remove(b: BoardSummary) {
    setMenu(null);
    const res = await fetch(`/api/boards/${b.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) {
      setToast({ text: t('list.actionError'), tone: 'error' });
      return;
    }
    setBoards((list) => list.filter((x) => x.id !== b.id));
    setResults((list) => list?.filter((x) => x.id !== b.id) ?? null);
    setTrash(null);
    setToast({ text: t('trash.moved', { name: b.name }), tone: 'info', undo: () => void restore(b, true) });
  }

  async function purge(b: BoardSummary) {
    setDialogBusy(true);
    const res = await fetch(`/api/boards/${b.id}/trash`, { method: 'DELETE' }).catch(() => null);
    setDialogBusy(false);
    setPurging(null);
    if (res?.ok) setTrash((list) => list?.filter((x) => x.id !== b.id) ?? null);
    else setToast({ text: t('list.actionError'), tone: 'error' });
  }

  async function submitPrompt() {
    if (!prompt) return;
    const value = prompt.value.trim();
    setDialogBusy(true);
    try {
      if (prompt.kind === 'newFolder') {
        if (!value) return;
        const res = await fetch('/api/boards/folders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: value }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const folder = (await res.json()) as BoardFolder;
        setFolders((list) => [...list, folder].sort((a, b) => a.name.localeCompare(b.name)));
        setViewAndUrl({ kind: 'folder', id: folder.id });
      } else if (prompt.kind === 'renameFolder') {
        if (!value) return;
        const res = await fetch(`/api/boards/folders/${prompt.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: value }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const id = prompt.id;
        setFolders((list) => list.map((f) => (f.id === id ? { ...f, name: value } : f)));
      } else {
        const folderId = prompt.value || null;
        const board = prompt.board;
        const res = await fetch(`/api/boards/${board.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ folderId }),
        });
        if (!res.ok) throw new Error(String(res.status));
        patchEverywhere(board.id, { folder_id: folderId });
        setFolders((list) =>
          list.map((f) => ({
            ...f,
            count: f.count + (f.id === folderId ? 1 : 0) - (f.id === board.folder_id ? 1 : 0),
          })),
        );
        const target = folders.find((f) => f.id === folderId);
        setToast({ text: target ? t('folders.movedTo', { name: board.name, folder: target.name }) : t('folders.movedOut', { name: board.name }), tone: 'info' });
      }
      setPrompt(null);
    } catch {
      setToast({ text: t('list.actionError'), tone: 'error' });
    } finally {
      setDialogBusy(false);
    }
  }

  async function deleteFolder(f: BoardFolder) {
    setDialogBusy(true);
    const res = await fetch(`/api/boards/folders/${f.id}`, { method: 'DELETE' }).catch(() => null);
    setDialogBusy(false);
    setFolderDeleting(null);
    if (!res?.ok) {
      setToast({ text: t('list.actionError'), tone: 'error' });
      return;
    }
    setFolders((list) => list.filter((x) => x.id !== f.id));
    setBoards((list) => list.map((b) => (b.folder_id === f.id ? { ...b, folder_id: null } : b)));
    setViewAndUrl({ kind: 'all' });
  }

  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => void create()} aria-busy={busy}>
      {busy ? t('list.creating') : t('list.new')}
    </button>
  );
  const headerActions = (
    <>
      <button type="button" className="btn" onClick={() => fileRef.current?.click()} aria-busy={importing} data-testid="board-import">
        <NotesIcon name="import" size={14} />
        {importing ? t('import.importing') : t('import.button')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".excalidraw,.json,application/json"
        multiple
        hidden
        onChange={(e) => void importFiles(e.currentTarget.files)}
        aria-label={t('import.button')}
        data-testid="board-import-input"
      />
      {newButton}
    </>
  );

  const folder = view.kind === 'folder' ? folders.find((f) => f.id === view.id) ?? null : null;
  const searchingNow = query.trim().length > 0;
  const shown = searchingNow ? (results ?? []) : view.kind === 'folder' ? boards.filter((b) => b.folder_id === view.id) : boards;
  const folderName = (id: string | null | undefined) => (id ? folders.find((f) => f.id === id)?.name ?? null : null);

  function card(b: BoardSummary) {
    return (
      // Al apuntar o enfocar una tarjeta se precarga el lienzo (ver preloadCanvas).
      <li key={b.id} className="board-card" onPointerEnter={preloadCanvas} onFocus={preloadCanvas}>
        <div className="board-thumb" aria-hidden="true">
          {b.thumbnail ? (
            // Miniatura SVG generada por el cliente (filtrada en el servidor); como <img> no ejecuta nada.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(b.thumbnail)}`} alt="" />
          ) : null}
        </div>
        <div className="board-card-body">
          {renaming === b.id ? (
            <input
              className="input board-rename"
              defaultValue={b.name}
              autoFocus
              maxLength={120}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => void rename(b.id, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void rename(b.id, e.currentTarget.value);
                if (e.key === 'Escape') setRenaming(null);
              }}
              aria-label={t('list.rename')}
            />
          ) : (
            <Link href={`/app/board/${b.id}`} className="board-card-name">
              {b.name}
            </Link>
          )}
          {b.match && <p className="board-card-match">{b.match}</p>}
          <p className="board-card-meta">
            {t('list.updated', { when: format.relativeTime(parseDbUtc(b.updated_at), new Date(now)) })}
            {b.updated_by ? ` · ${b.updated_by}` : ''}
            {view.kind !== 'folder' && folderName(b.folder_id) ? ` · ${folderName(b.folder_id)}` : ''}
          </p>
          {b.shared && <span className="badge badge-outline board-card-shared">{t('share.on')}</span>}
          {b.access === 'restricted' && <span className="badge badge-outline board-card-shared">{t('access.restrictedBadge')}</span>}
        </div>
        <RowMenu
          className="board-card-menu"
          open={menu === b.id}
          label={`${t('list.actions')}: ${b.name}`}
          onToggle={(open) => setMenu(open ? b.id : null)}
          items={[
            { label: t('list.rename'), onSelect: () => { setMenu(null); setRenaming(b.id); } },
            { label: t('list.duplicate'), onSelect: () => void duplicate(b) },
            { label: t('folders.moveTo'), onSelect: () => { setMenu(null); setPrompt({ kind: 'move', board: b, value: b.folder_id ?? '' }); } },
            { label: t('list.delete'), danger: true, onSelect: () => void remove(b) },
          ]}
        />
      </li>
    );
  }

  return (
    <div className="ui-page board-list">
      <PageHeader title={t('list.title')} description={t('list.subtitle')} actions={headerActions} />

      <div className="board-list-tools">
        <label className="board-search">
          <span className="sr-only">{t('search.label')}</span>
          <NotesIcon name="search" size={14} />
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t('search.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            data-testid="board-search"
          />
        </label>
        <nav className="board-folders" aria-label={t('folders.title')}>
          <button type="button" className="board-folder-tab" aria-current={view.kind === 'all' ? 'page' : undefined} onClick={() => setViewAndUrl({ kind: 'all' })}>
            {t('folders.all')}
            <span className="board-folder-count">{boards.length}</span>
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              className="board-folder-tab"
              aria-current={view.kind === 'folder' && view.id === f.id ? 'page' : undefined}
              onClick={() => setViewAndUrl({ kind: 'folder', id: f.id })}
            >
              <NotesIcon name="folder" size={13} />
              {f.name}
              <span className="board-folder-count">{boards.filter((b) => b.folder_id === f.id).length}</span>
            </button>
          ))}
          <button type="button" className="board-folder-tab board-folder-new" onClick={() => setPrompt({ kind: 'newFolder', value: '' })} data-testid="board-new-folder">
            <NotesIcon name="plus" size={13} />
            {t('folders.new')}
          </button>
          <button type="button" className="board-folder-tab" aria-current={view.kind === 'trash' ? 'page' : undefined} onClick={() => setViewAndUrl({ kind: 'trash' })} data-testid="board-trash-tab">
            <NotesIcon name="trash" size={13} />
            {t('trash.title')}
          </button>
        </nav>
      </div>

      {folder && !searchingNow && (
        <div className="board-folder-head">
          <h2 className="board-folder-title">
            <NotesIcon name="folder" size={16} />
            {folder.name}
          </h2>
          <RowMenu
            open={menu === `folder:${folder.id}`}
            label={`${t('folders.actions')}: ${folder.name}`}
            onToggle={(open) => setMenu(open ? `folder:${folder.id}` : null)}
            items={[
              { label: t('folders.rename'), onSelect: () => { setMenu(null); setPrompt({ kind: 'renameFolder', id: folder.id, value: folder.name }); } },
              { label: t('folders.delete'), danger: true, onSelect: () => { setMenu(null); setFolderDeleting(folder); } },
            ]}
          />
        </div>
      )}

      {view.kind === 'trash' && !searchingNow ? (
        <section aria-labelledby="board-trash-title">
          <h2 className="board-folder-title" id="board-trash-title">
            <NotesIcon name="trash" size={16} />
            {t('trash.title')}
          </h2>
          <p className="board-pop-hint">{t('trash.hint')}</p>
          {trash === null ? (
            <div className="ui-loading-stack" aria-busy="true" aria-label={t('editor.loading')}>
              <span className="ui-skeleton ui-skeleton-row" />
              <span className="ui-skeleton ui-skeleton-row" />
            </div>
          ) : trashError ? (
            <div role="alert">
              <p className="ui-error">{t('list.actionError')}</p>
              <button type="button" className="btn btn-sm" onClick={() => void loadTrash()}>
                {t('trash.retry')}
              </button>
            </div>
          ) : trash.length === 0 ? (
            <EmptyState quiet product="board" title={t('trash.emptyTitle')} body={t('trash.emptyHint')} />
          ) : (
            <ul className="board-trash-list" data-testid="board-trash-list">
              {trash.map((b) => (
                <li key={b.id} className="board-trash-item">
                  <div className="board-trash-body">
                    <span className="board-trash-name">{b.name}</span>
                    <span className="board-card-meta">
                      {t('trash.deletedAt', { when: format.relativeTime(parseDbUtc(b.deleted_at ?? b.updated_at), new Date(now)) })}
                    </span>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => void restore(b)}>
                    {t('trash.restore')}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setPurging(b)}>
                    {t('trash.purge')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : searchingNow ? (
        <section aria-live="polite" aria-busy={searching}>
          {searchError ? (
            <p className="ui-error" role="alert">
              {t('search.error')}
            </p>
          ) : results === null ? (
            <div className="ui-loading-stack" aria-busy="true" aria-label={t('search.searching')}>
              <span className="ui-skeleton ui-skeleton-row" />
            </div>
          ) : results.length === 0 ? (
            <EmptyState quiet product="board" title={t('search.emptyTitle', { q: query.trim() })} body={t('search.emptyHint')} />
          ) : (
            <ul className="board-grid">{shown.map(card)}</ul>
          )}
        </section>
      ) : shown.length === 0 ? (
        folder ? (
          <EmptyState quiet product="board" title={t('folders.emptyTitle')} body={t('folders.emptyHint')} action={newButton} />
        ) : (
          <EmptyState quiet product="board" title={t('list.emptyTitle')} body={t('list.emptyHint')} action={newButton} />
        )
      ) : (
        <ul className="board-grid">{shown.map(card)}</ul>
      )}

      {view.kind !== 'trash' && !searchingNow && (
        <section className={`board-templates${boards.length > 0 ? ' is-compact' : ''}`} aria-labelledby="board-templates-title">
          <details
            className="board-templates-details"
            // Sin pizarras, las plantillas son el camino principal: siempre abiertas.
            open={boards.length === 0 || !templatesCollapsed}
          >
            <summary
              className="board-templates-title"
              id="board-templates-title"
              onClick={(e) => {
                // El estado manda (y se recuerda); el toggle nativo no, que también salta al hidratar.
                e.preventDefault();
                if (boards.length > 0) toggleTemplates(templatesCollapsed);
              }}
            >
              <NotesIcon name="back" size={12} />
              {t('list.templatesTitle')}
            </summary>
            <ul className="board-templates-grid">
              {BOARD_TEMPLATES.map((key) => (
                <li key={key}>
                  <button
                    type="button"
                    className="board-template"
                    onClick={() => void createFromTemplate(key)}
                    aria-busy={creatingTemplate === key}
                    disabled={creatingTemplate !== null}
                  >
                    <span className="board-template-preview" aria-hidden="true">
                      <TemplatePreview template={key} />
                    </span>
                    <span className="board-template-name">{tt(`${key}.name`)}</span>
                    <span className="board-template-desc">{tt(`${key}.description`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      <ConfirmDialog
        open={purging !== null}
        danger
        busy={dialogBusy}
        title={t('trash.purgeTitle')}
        body={purging ? t('trash.confirmPurge', { name: purging.name }) : null}
        confirmLabel={t('trash.purge')}
        cancelLabel={t('list.cancel')}
        onConfirm={() => purging && void purge(purging)}
        onCancel={() => setPurging(null)}
      />
      <ConfirmDialog
        open={folderDeleting !== null}
        danger
        busy={dialogBusy}
        title={t('folders.deleteTitle')}
        body={folderDeleting ? t('folders.confirmDelete', { name: folderDeleting.name }) : null}
        confirmLabel={t('folders.delete')}
        cancelLabel={t('list.cancel')}
        onConfirm={() => folderDeleting && void deleteFolder(folderDeleting)}
        onCancel={() => setFolderDeleting(null)}
      />
      <ConfirmDialog
        open={prompt !== null}
        busy={dialogBusy}
        title={prompt?.kind === 'newFolder' ? t('folders.new') : prompt?.kind === 'renameFolder' ? t('folders.rename') : t('folders.moveTo')}
        body={
          prompt ? (
            <div className="ui-field">
              <label className="label" htmlFor="board-prompt-field">
                {prompt.kind === 'move' ? t('folders.moveLabel', { name: prompt.board.name }) : t('folders.nameLabel')}
              </label>
              {prompt.kind === 'move' ? (
                <select
                  id="board-prompt-field"
                  className="select"
                  ref={(el) => {
                    promptInput.current = el;
                  }}
                  value={prompt.value}
                  onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
                  data-testid="board-move-select"
                >
                  <option value="">{t('folders.none')}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="board-prompt-field"
                  className="input"
                  ref={(el) => {
                    promptInput.current = el;
                  }}
                  value={prompt.value}
                  maxLength={80}
                  onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submitPrompt();
                    }
                  }}
                  data-testid="board-folder-name"
                />
              )}
            </div>
          ) : null
        }
        confirmLabel={prompt?.kind === 'move' ? t('folders.move') : t('folders.save')}
        cancelLabel={t('list.cancel')}
        onConfirm={() => void submitPrompt()}
        onCancel={() => setPrompt(null)}
      />

      <div className="ui-toasts" role="status" aria-live="polite">
        {toast && (
          <div className="ui-toast" data-tone={toast.tone}>
            {toast.text}
            {toast.undo && (
              <button
                type="button"
                className="ui-toast-action"
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
              >
                {t('trash.undo')}
              </button>
            )}
            <button type="button" className="ui-toast-action" onClick={() => setToast(null)}>
              {t('editor.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function toSummary(b: BoardDetail): BoardSummary {
  return {
    id: b.id,
    name: b.name,
    thumbnail: b.thumbnail,
    version: b.version,
    shared: b.shared,
    access: b.access,
    created_at: b.created_at,
    updated_at: b.updated_at,
    updated_by: b.updated_by,
    folder_id: b.folder_id ?? null,
  };
}
