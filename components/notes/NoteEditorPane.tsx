'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import DocsEditor from '@/components/docs/DocsEditor';
import type { DocsBlock, DocsPage } from '@/lib/docs-types';
import type { DocsFileSource } from '@/lib/docs-files';
import type { PageLinkSource } from '@/lib/docs-page-links';
import { noteFileHref, noteHref, normalizeTag, type NoteDetail, type NoteLockEnvelope, type NoteSummary, type NotebookInfo } from '@/lib/notes-types';
import { fileBlocksOnly, newNoteKey, openNoteWithKey, sealNote, type LockedPayload, type NoteKey } from '@/lib/notes-crypto';
import NoteBlocksView from './NoteBlocksView';
import NoteHistoryDrawer from './NoteHistoryDrawer';
import NoteReminderButton from './NoteReminderButton';
import { NoteSharePeople } from './NoteSharePeople';
import NoteTrackDrawer from './NoteTrackDrawer';
import NotesIcon from './NotesIcon';
import RowMenu from './RowMenu';
import { usePopover } from './usePopover';
import { AudioRecordButton, ScanDialog } from './NoteCapture';
import { LockedNoteGate, LockSetDialog, openNoteKeys } from './NoteLock';
import { PromptDialog } from './NotesModal';
import { parseDbUtc } from '@/lib/utils';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'local';

interface Props {
  note: NoteDetail;
  notebooks: NotebookInfo[];
  focusTitle: number;
  status: SaveStatus;
  onBack: () => void;
  onSaveContent: (id: string, patch: { title: string; content: DocsBlock[]; lock?: NoteLockEnvelope; lock_proof?: string }) => Promise<void>;
  /** Grabación que no se pudo agregar en el editor (cambio de nota o sin red): el padre la sube y la agrega. */
  onRecording?: (noteId: string, file: File) => Promise<'added' | 'saved' | 'failed'>;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<NoteDetail | null>;
  onTrash: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onDeleteForever: (id: string) => Promise<void>;
  onShareChange: (token: string | null) => void;
  /** Error de red en una acción del panel (compartir): el padre muestra el aviso. */
  onError?: (msg?: string) => void;
  /** Aviso de éxito (plantilla guardada). */
  onNotice?: (msg: string) => void;
  /** Abre otra nota (links [[ ]] y "Enlazada desde"). */
  onOpenNote: (id: string) => void;
  /** Vuelve a cargar la nota del servidor (después de restaurar una versión). */
  onReload: (id: string) => void;
  /** La nota cambió entera en el servidor (bloquear o sacar el bloqueo): el padre la reemplaza. */
  onReplace: (note: NoteDetail) => void;
  /** Espera el autoguardado y trae la nota del servidor (antes de mandarla a Track). */
  onSync: (id: string) => Promise<NoteDetail | null>;
  /** Se crearon issues de Track desde la nota (el padre avisa y recarga). */
  onTracked: (id: string, issues: Array<{ id: string; identifier: string }>) => void;
  /** Se creó una nota desde el popover [[ (el padre la suma a la lista). */
  onCreated?: (note: NoteDetail) => void;
  /** Sin conexión: se ocultan las acciones que necesitan el servidor. */
  offline?: boolean;
  focusMode?: boolean;
  onToggleFocus?: () => void;
  /** Palabras de la búsqueda con la que se abrió: se resaltan en la nota. */
  highlight?: string[];
}

const HIGHLIGHT = 'notes-search';

/** Resalta los términos en el cuerpo con la CSS Custom Highlight API y lleva la vista al primero. */
function paintHighlights(root: HTMLElement | null, terms: string[]): number {
  const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!reg || !HighlightCtor) return 0;
  reg.delete(HIGHLIGHT);
  if (!root || !terms.length) return 0;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && ranges.length < 200; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLowerCase();
    for (const term of terms) {
      for (let i = text.indexOf(term); i >= 0 && ranges.length < 200; i = text.indexOf(term, i + term.length)) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + term.length);
        ranges.push(r);
      }
    }
  }
  if (!ranges.length) return 0;
  reg.set(HIGHLIGHT, new HighlightCtor(...ranges));
  ranges[0].startContainer.parentElement?.scrollIntoView({ block: 'center' });
  return ranges.length;
}

export default function NoteEditorPane({
  note,
  notebooks,
  focusTitle,
  status,
  onBack,
  onSaveContent,
  onPatch,
  onTrash,
  onRestore,
  onDeleteForever,
  onShareChange,
  onError,
  onNotice,
  onOpenNote,
  onReload,
  onReplace,
  onSync,
  onTracked,
  onCreated,
  offline = false,
  onRecording,
  focusMode = false,
  onToggleFocus,
  highlight = [],
}: Props) {
  const t = useTranslations('notes');
  const format = useFormatter();
  const locale = useLocale();
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagDraft, setTagDraft] = useState('');
  const [pinned, setPinned] = useState(note.pinned);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const share = usePopover();
  const [reminder, setReminder] = useState(note.reminder ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [peopleCount, setPeopleCount] = useState(0);
  /** Nota bloqueada abierta en esta pestaña: el contenido descifrado y la clave. */
  const [unlocked, setUnlocked] = useState<{ payload: LockedPayload; key: NoteKey } | null>(null);
  const insertRef = useRef<((blocks: DocsBlock[]) => void) | null>(null);
  /** Guardados cifrados en fila (cada uno espera al anterior). */
  const sealChain = useRef<Promise<unknown>>(Promise.resolve());
  /** Propia, o compartida por otra persona (para ver o editar). */
  const access = note.access ?? 'owner';
  const isOwner = access === 'owner';
  const locked = Boolean(note.locked && note.lock);

  // Clave ya abierta en esta pestaña: se abre sola.
  const noteLock = note.lock;
  useEffect(() => {
    if (!locked || !noteLock) return;
    const key = openNoteKeys.get(note.id);
    if (!key) return;
    let alive = true;
    openNoteWithKey(key, noteLock)
      .then((payload) => alive && setUnlocked({ payload, key }))
      .catch(() => openNoteKeys.delete(note.id));
    return () => {
      alive = false;
    };
  }, [locked, noteLock, note.id]);

  const noteIdForLinks = note.id;
  const notebookForLinks = note.notebook_id ?? null;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const untitled = t('untitled');
  /** Links [[ ]] a otras notas de la persona (el buscador de la lista, sin la nota abierta). */
  const pageLinks = useMemo<PageLinkSource>(
    () => ({
      search: async (q) => {
        const res = await fetch(`/api/notes?q=${encodeURIComponent(q)}&sort=updated`);
        if (!res.ok) return [];
        const data = (await res.json()) as { notes: NoteSummary[] };
        return data.notes
          .filter((n) => n.id !== noteIdForLinks)
          .slice(0, 8)
          .map((n) => ({ id: n.id, title: n.title || untitled }));
      },
      href: noteHref,
      open: onOpenNote,
      // "Crear nota «x»": nueva nota en la misma libreta, sin salir de esta.
      create: async (title) => {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            title,
            notebook_id: notebookForLinks,
            content: [{ id: crypto.randomUUID(), type: 'paragraph', content: '' }],
          }),
        }).catch(() => null);
        if (!res?.ok) return null;
        const created = (await res.json()) as NoteDetail;
        onCreatedRef.current?.(created);
        return { id: created.id, title: created.title || untitled };
      },
      labels: {
        create: (q) => t('editor.linkCreate', { query: q }),
        empty: t('editor.linkEmpty'),
      },
    }),
    [noteIdForLinks, notebookForLinks, onOpenNote, untitled, t],
  );
  /** Adjuntos: rutas de Notes (solo la persona dueña sube y descarga). */
  const files = useMemo<DocsFileSource>(
    () => ({
      uploadUrl: `/api/notes/${encodeURIComponent(noteIdForLinks)}/files`,
      href: (blockId, opts) => noteFileHref(noteIdForLinks, blockId, opts),
    }),
    [noteIdForLinks],
  );

  // Página sintética para reutilizar el editor de bloques de Docs (modo embebido).
  // Bloqueada y abierta: título y bloques salen del sobre descifrado.
  const page = useMemo<DocsPage>(
    () => ({
      id: note.id,
      user_id: '',
      parent_id: null,
      title: note.title,
      icon: null,
      cover_url: null,
      content: unlocked ? unlocked.payload.content : note.content,
      is_public: false,
      archived: false,
      created_at: note.created_at,
      updated_at: note.updated_at,
    }),
    // Solo al cambiar de nota o al abrirla: el editor maneja su propio estado mientras se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id, unlocked?.key],
  );

  // El editor manda solo lo que edita (título y bloques), sin id: se usa el de la nota.
  const noteId = note.id;
  const unlockedKey = unlocked?.key ?? null;
  const lockHint = note.lock?.hint;
  const handleSave = useCallback(
    (p: Partial<DocsPage>) => {
      const title = p.title ?? '';
      const content = p.content ?? [];
      if (!unlockedKey) {
        void onSaveContent(noteId, { title, content });
        return;
      }
      // Bloqueada: se cifra acá y al servidor solo van el sobre y los adjuntos.
      sealChain.current = sealChain.current
        .catch(() => undefined)
        .then(async () => {
          const lock = await sealNote(unlockedKey, { title, content }, lockHint);
          await onSaveContent(noteId, { title, content: fileBlocksOnly(content), lock, lock_proof: unlockedKey.proof });
        });
    },
    [noteId, onSaveContent, unlockedKey, lockHint],
  );

  // Nota recién creada: foco en el título.
  useEffect(() => {
    if (!focusTitle) return;
    const el = wrapRef.current?.querySelector<HTMLElement>('.docs-title');
    el?.focus();
  }, [focusTitle]);

  // Abierta desde una búsqueda: resalta las coincidencias (se borran al escribir).
  const highlightKey = highlight.join(' ');
  useEffect(() => {
    if (!highlightKey) return;
    const terms = highlightKey.split(' ').filter(Boolean);
    const h = setTimeout(() => paintHighlights(wrapRef.current?.querySelector('.note-body') ?? null, terms), 250);
    const clear = () => paintHighlights(null, []);
    const el = wrapRef.current;
    el?.addEventListener('input', clear, { once: true });
    return () => {
      clearTimeout(h);
      el?.removeEventListener('input', clear);
      clear();
    };
  }, [highlightKey, note.id, unlocked]);

  async function saveTags(next: string[]) {
    const prev = tags;
    setTags(next);
    if (!(await onPatch(note.id, { tags: next }))) setTags(prev);
  }

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    setTagDraft('');
    if (!tag || tags.includes(tag)) return;
    void saveTags([...tags, tag]);
  }

  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    if (!(await onPatch(note.id, { pinned: next }))) setPinned(!next);
  }

  async function setShare(shared: boolean) {
    setShareBusy(true);
    try {
      const res = await fetch(`/api/notes/${note.id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shared }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { share_token: string | null };
      onShareChange(data.share_token);
    } catch {
      onError?.();
    } finally {
      setShareBusy(false);
    }
  }

  /** Bloquear: cifra lo último guardado con una clave nueva y deja en el servidor solo el sobre. */
  async function lockWith(password: string, hint: string): Promise<boolean> {
    const fresh = await onSync(note.id);
    if (!fresh) return false;
    try {
      const key = await newNoteKey(password);
      const lock = await sealNote(key, { title: fresh.title, content: fresh.content }, hint);
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'lock', lock, content: fileBlocksOnly(fresh.content), base_updated_at: fresh.updated_at }),
      });
      if (!res.ok) return false;
      openNoteKeys.delete(note.id);
      onReplace((await res.json()) as NoteDetail);
      return true;
    } catch {
      return false;
    }
  }

  /** Quitar el bloqueo: descifra lo último guardado y lo vuelve a guardar en claro. */
  async function removeLock() {
    if (!unlocked) return;
    const fresh = await onSync(note.id);
    try {
      if (!fresh?.lock) throw new Error('no_lock');
      const payload = await openNoteWithKey(unlocked.key, fresh.lock);
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}/lock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // El título visible (el del servidor) manda; la prueba demuestra que se sabe la contraseña.
        body: JSON.stringify({ action: 'unlock', proof: unlocked.key.proof, title: fresh.title, content: payload.content, base_updated_at: fresh.updated_at }),
      });
      if (!res.ok) throw new Error(String(res.status));
      openNoteKeys.delete(note.id);
      onReplace((await res.json()) as NoteDetail);
    } catch {
      onError?.(t('lock.removeError'));
    }
  }

  function lockNow() {
    openNoteKeys.delete(note.id);
    setUnlocked(null);
  }

  async function saveTemplate(name: string): Promise<boolean> {
    const fresh = await onSync(note.id);
    if (!fresh) {
      onError?.();
      return false;
    }
    const res = await fetch('/api/notes/templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, title: fresh.title, content: fresh.content }),
    }).catch(() => null);
    if (!res?.ok) {
      onError?.(res?.status === 409 ? t('templates.limit') : undefined);
      return false;
    }
    onNotice?.(t('templates.saved', { name }));
    return true;
  }

  const shareUrl =
    note.share_token && typeof window !== 'undefined' ? `${window.location.origin}/n/${note.share_token}` : '';

  const statusLabel =
    status === 'saving'
      ? t('editor.saving')
      : status === 'saved'
        ? t('editor.saved')
        : status === 'error'
          ? t('editor.saveError')
          : status === 'local'
            ? t('offline.savedLocal')
            : '';

  const back = (
    <button type="button" className="notes-back" onClick={onBack}>
      <NotesIcon name="back" size={14} />
      {t('editor.back')}
    </button>
  );

  const focusButton = onToggleFocus && (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon note-focus-toggle"
      onClick={onToggleFocus}
      aria-pressed={focusMode}
      aria-label={focusMode ? t('focus.exit') : t('focus.enter')}
      title={focusMode ? t('focus.exit') : t('focus.enter')}
    >
      <NotesIcon name="focus" size={15} />
    </button>
  );

  const trackDrawer = trackOpen && (
    <NoteTrackDrawer
      noteId={note.id}
      onSync={() => onSync(note.id)}
      onClose={() => setTrackOpen(false)}
      onDone={(issues) => {
        setTrackOpen(false);
        onTracked(note.id, issues);
      }}
    />
  );

  const gate = locked && note.lock && !unlocked && (
    <div className="note-body">
      <LockedNoteGate
        noteId={note.id}
        title={note.title}
        envelope={note.lock}
        untitled={untitled}
        onOpen={(payload, key) => setUnlocked({ payload, key })}
      />
    </div>
  );

  // Compartida conmigo: aviso de quién es y qué puedo hacer.
  if (!isOwner) {
    const by = note.owner_name ?? t('sharedNote.someone');
    const canEdit = access === 'edit' && !locked;
    return (
      <div className="note-pane" ref={wrapRef}>
        <div className="note-bar">
          {back}
          <span className="note-bar-info">
            {locked ? t('lock.sharedReadOnly') : canEdit ? t('sharedNote.editBanner', { name: by }) : t('sharedNote.viewBanner', { name: by })}
          </span>
          {canEdit && (
            <span className={`note-status${status === 'error' ? ' is-error' : ''}`} aria-live="polite">
              {statusLabel}
            </span>
          )}
          {canEdit && !offline && (
            <div className="note-bar-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTrackOpen(true)}>
                <NotesIcon name="track" size={14} />
                <span className="note-bar-label">{t('track.open')}</span>
              </button>
            </div>
          )}
        </div>
        {trackDrawer}
        {gate ||
          (canEdit ? (
            <div className="note-body">
              <DocsEditor
                page={page}
                ancestors={[]}
                onSave={handleSave}
                embedded
                files={files}
                aiUrl={!offline ? '/api/notes/ai' : undefined}
                titlePlaceholder={t('editor.titlePlaceholder')}
              />
            </div>
          ) : (
            <div className="note-body note-body-readonly">
              <h1 className="note-view-title">{note.title || t('untitled')}</h1>
              <NoteBlocksView blocks={unlocked ? unlocked.payload.content : note.content} fileHref={files.href} />
            </div>
          ))}
      </div>
    );
  }

  if (note.trashed) {
    return (
      <div className="note-pane" ref={wrapRef}>
        <div className="note-bar">
          {back}
          <span className="note-bar-info">{t('trash.banner')}</span>
          <div className="note-bar-actions">
            <button type="button" className="btn btn-sm" onClick={() => void onRestore(note.id)}>
              {t('trash.restore')}
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void onDeleteForever(note.id)}>
              {t('trash.deleteForever')}
            </button>
          </div>
        </div>
        {gate || (
          <div className="note-body note-body-readonly">
            <h1 className="note-view-title">{note.title || t('untitled')}</h1>
            <NoteBlocksView blocks={unlocked ? unlocked.payload.content : note.content} fileHref={files.href} />
          </div>
        )}
      </div>
    );
  }

  const exportHref = (format: string) => `/api/notes/${encodeURIComponent(note.id)}/export?format=${format}&locale=${locale}`;
  const canWrite = !locked || Boolean(unlocked);
  const menuItems: Array<{ label: string; onSelect: () => void; danger?: boolean }> = [];
  const item = (label: string, run: () => void, danger = false) =>
    menuItems.push({
      label,
      danger,
      onSelect: () => {
        setMenuOpen(false);
        run();
      },
    });
  if (!locked && !offline) item(t('history.open'), () => setHistoryOpen(true));
  if (!locked && !offline) item(t('track.open'), () => setTrackOpen(true));
  if (!locked && !offline) item(t('templates.saveAs'), () => setTplOpen(true));
  if (!locked && !offline) {
    item(t('export.markdown'), () => (window.location.href = exportHref('md')));
    item(t('export.enex'), () => (window.location.href = exportHref('enex')));
    item(t('export.html'), () => (window.location.href = exportHref('html')));
  }
  if (canWrite) item(t('export.print'), () => window.print());
  if (!locked && !offline) item(t('lock.lock'), () => setLockOpen(true));
  if (locked && unlocked) item(t('lock.lockNow'), lockNow);
  if (locked && unlocked && !offline) item(t('lock.removeLock'), () => void removeLock());

  return (
    <div className="note-pane" ref={wrapRef}>
      <div className="note-bar">
        {back}
        <select
          className="select note-notebook"
          value={note.notebook_id ?? ''}
          onChange={(e) => void onPatch(note.id, { notebook_id: e.target.value || null })}
          aria-label={t('editor.moveTo')}
          title={t('editor.moveTo')}
        >
          <option value="">{t('editor.noNotebook')}</option>
          {notebooks.map((nb) => (
            <option key={nb.id} value={nb.id}>
              {nb.stack ? `${nb.stack} / ${nb.name}` : nb.name}
            </option>
          ))}
        </select>
        {locked && (
          <span className="note-locked-badge" title={t('lock.locked')}>
            <NotesIcon name="lock" size={13} />
            <span className="note-bar-label">{t('lock.locked')}</span>
          </span>
        )}
        <span className={`note-status${status === 'error' ? ' is-error' : ''}`} aria-live="polite">
          {statusLabel}
        </span>
        <div className="note-bar-actions">
          {canWrite && (!offline || !locked) && (
            <AudioRecordButton
              noteId={note.id}
              offline={offline}
              onInsert={(b) => insertRef.current?.(b)}
              onPending={onRecording}
              onNotice={(m) => onNotice?.(m)}
              onError={(m) => onError?.(m)}
            />
          )}
          {canWrite && !offline && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setScanOpen(true)}
                aria-label={t('capture.scan')}
                title={t('capture.scan')}
              >
                <NotesIcon name="scan" size={15} />
              </button>
            </>
          )}
          {focusButton}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon note-pin"
            onClick={() => void togglePin()}
            aria-pressed={pinned}
            aria-label={pinned ? t('editor.unpin') : t('editor.pin')}
            title={pinned ? t('editor.unpin') : t('editor.pin')}
          >
            <NotesIcon name="pin" size={15} />
          </button>
          {!offline && <NoteReminderButton noteId={note.id} reminder={reminder} onChange={setReminder} onError={() => onError?.()} />}
          {!offline && (
            <div className="note-share-wrap" ref={share.wrapRef}>
              <button
                ref={share.buttonRef}
                type="button"
                className={`btn btn-ghost btn-sm${note.shared || peopleCount > 0 ? ' is-on' : ''}`}
                onClick={share.toggle}
                aria-expanded={share.open}
                aria-haspopup="dialog"
                aria-label={t('share.button')}
              >
                <NotesIcon name="share" size={14} />
                <span className="note-bar-label">{t('share.button')}</span>
              </button>
              {share.open && (
                <div className="notes-pop" role="dialog" aria-label={t('share.title')}>
                  <p className="notes-pop-title">{t('share.title')}</p>
                  <p className="notes-pop-hint">{locked ? t('lock.setWarn') : t('share.hint')}</p>
                  {locked ? null : note.share_token ? (
                    <>
                      <div className="notes-pop-row">
                        <input className="input data" readOnly value={shareUrl} aria-label={t('share.title')} onFocus={(e) => e.currentTarget.select()} />
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            void navigator.clipboard?.writeText(shareUrl).catch(() => {});
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          }}
                        >
                          {copied ? t('share.copied') : t('share.copy')}
                        </button>
                      </div>
                      <button type="button" className="btn btn-sm btn-ghost btn-danger notes-pop-off" aria-busy={shareBusy} onClick={() => void setShare(false)}>
                        {t('share.disable')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm btn-primary" aria-busy={shareBusy} onClick={() => void setShare(true)}>
                      {t('share.enable')}
                    </button>
                  )}
                  <NoteSharePeople apiUrl={`/api/notes/${encodeURIComponent(note.id)}/shares`} onCount={setPeopleCount} />
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => void onTrash(note.id)}
            aria-label={t('editor.trash')}
            title={t('editor.trash')}
          >
            <NotesIcon name="trash" size={15} />
          </button>
          {menuItems.length > 0 && <RowMenu open={menuOpen} label={t('editor.more')} onToggle={setMenuOpen} items={menuItems} />}
        </div>
      </div>
      {trackDrawer}
      {historyOpen && (
        <NoteHistoryDrawer noteId={note.id} onClose={() => setHistoryOpen(false)} onRestored={() => onReload(note.id)} />
      )}
      {scanOpen && (
        <ScanDialog noteId={note.id} onInsert={(b) => insertRef.current?.(b)} onClose={() => setScanOpen(false)} onError={(m) => onError?.(m)} />
      )}
      {lockOpen && <LockSetDialog onLock={lockWith} onClose={() => setLockOpen(false)} />}
      {tplOpen && (
        <PromptDialog
          title={t('templates.saveAs')}
          label={t('templates.nameLabel')}
          initial={note.title}
          confirmLabel={t('templates.save')}
          cancelLabel={t('templates.cancel')}
          onSubmit={saveTemplate}
          onClose={() => setTplOpen(false)}
        />
      )}

      <div className="note-meta">
        {tags.map((tg) => (
          <span key={tg} className="note-tag">
            <span>
              <span className="note-tag-hash" aria-hidden="true">#</span>
              {tg}
            </span>
            <button type="button" onClick={() => void saveTags(tags.filter((x) => x !== tg))} aria-label={t('editor.removeTag', { tag: tg })}>
              <NotesIcon name="close" size={11} />
            </button>
          </span>
        ))}
        <input
          className="note-tag-input"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(tagDraft);
            } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
              void saveTags(tags.slice(0, -1));
            }
          }}
          onBlur={() => tagDraft && addTag(tagDraft)}
          placeholder={t('editor.addTag')}
          aria-label={t('editor.addTag')}
          maxLength={60}
        />
      </div>

      {note.source_url && (
        <p className="note-source">
          {t('editor.source')}{' '}
          <a href={note.source_url} target="_blank" rel="noopener noreferrer">
            {note.source_url.replace(/^https?:\/\//, '').slice(0, 80)}
          </a>
        </p>
      )}

      {gate || (
        <div className="note-body">
          <DocsEditor
            key={unlocked ? 'open' : 'plain'}
            page={page}
            ancestors={[]}
            onSave={handleSave}
            embedded
            pageLinks={pageLinks}
            files={files}
            aiUrl={!locked && !offline ? '/api/notes/ai' : undefined}
            insertRef={insertRef}
            titlePlaceholder={t('editor.titlePlaceholder')}
          />
        </div>
      )}
      {note.backlinks && note.backlinks.length > 0 && (
        <nav className="note-backlinks" aria-label={t('links.linkedFrom')}>
          <span className="note-backlinks-label">{t('links.linkedFrom')}</span>
          <ul>
            {note.backlinks.map((b) => (
              <li key={b.id}>
                <button type="button" className="note-backlink" onClick={() => onOpenNote(b.id)}>
                  <NotesIcon name="link" size={13} />
                  {b.title || untitled}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <p className="note-foot">
        {t('editor.created', { date: format.dateTime(parseDbUtc(note.created_at), { dateStyle: 'medium' }) })}
      </p>
    </div>
  );
}
