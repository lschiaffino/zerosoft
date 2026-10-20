'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import DocsEditor from '@/components/docs/DocsEditor';
import type { DocsBlock, DocsPage } from '@/lib/docs-types';
import type { DocsFileSource } from '@/lib/docs-files';
import type { PageLinkSource } from '@/lib/docs-page-links';
import { noteFileHref, noteHref, normalizeTag, type NoteDetail, type NoteSummary, type NotebookInfo } from '@/lib/notes-types';
import NoteBlocksView from './NoteBlocksView';
import NoteHistoryDrawer from './NoteHistoryDrawer';
import NoteReminderButton from './NoteReminderButton';
import NotesIcon from './NotesIcon';
import RowMenu from './RowMenu';
import { usePopover } from './usePopover';

interface Props {
  note: NoteDetail;
  notebooks: NotebookInfo[];
  focusTitle: number;
  status: 'idle' | 'saving' | 'saved' | 'error';
  onBack: () => void;
  onSaveContent: (id: string, patch: { title: string; content: DocsBlock[] }) => Promise<void>;
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<NoteDetail | null>;
  onTrash: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
  onDeleteForever: (id: string) => Promise<void>;
  onShareChange: (token: string | null) => void;
  /** Error de red en una acción del panel (compartir): el padre muestra el aviso. */
  onError?: () => void;
  /** Abre otra nota (links [[ ]] y "Enlazada desde"). */
  onOpenNote: (id: string) => void;
  /** Vuelve a cargar la nota del servidor (después de restaurar una versión). */
  onReload: (id: string) => void;
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
  onOpenNote,
  onReload,
}: Props) {
  const t = useTranslations('notes');
  const format = useFormatter();
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

  const noteIdForLinks = note.id;
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
    }),
    [noteIdForLinks, onOpenNote, untitled],
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
  const page = useMemo<DocsPage>(
    () => ({
      id: note.id,
      user_id: '',
      parent_id: null,
      title: note.title,
      icon: null,
      cover_url: null,
      content: note.content,
      is_public: false,
      archived: false,
      created_at: note.created_at,
      updated_at: note.updated_at,
    }),
    // Solo al cambiar de nota: el editor maneja su propio estado mientras se escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note.id],
  );

  // El editor manda solo lo que edita (título y bloques), sin id: se usa el de la nota.
  const noteId = note.id;
  const handleSave = useCallback(
    (p: Partial<DocsPage>) => {
      void onSaveContent(noteId, { title: p.title ?? '', content: p.content ?? [] });
    },
    [noteId, onSaveContent],
  );

  // Nota recién creada: foco en el título.
  useEffect(() => {
    if (!focusTitle) return;
    const el = wrapRef.current?.querySelector<HTMLElement>('.docs-title');
    el?.focus();
  }, [focusTitle]);

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

  const shareUrl =
    note.share_token && typeof window !== 'undefined' ? `${window.location.origin}/n/${note.share_token}` : '';

  const statusLabel =
    status === 'saving' ? t('editor.saving') : status === 'saved' ? t('editor.saved') : status === 'error' ? t('editor.saveError') : '';

  const back = (
    <button type="button" className="notes-back" onClick={onBack}>
      <NotesIcon name="back" size={14} />
      {t('editor.back')}
    </button>
  );

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
        <div className="note-body note-body-readonly">
          <h1 className="note-view-title">{note.title || t('untitled')}</h1>
          <NoteBlocksView blocks={note.content} fileHref={files.href} />
        </div>
      </div>
    );
  }

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
              {nb.name}
            </option>
          ))}
        </select>
        <span className={`note-status${status === 'error' ? ' is-error' : ''}`} aria-live="polite">
          {statusLabel}
        </span>
        <div className="note-bar-actions">
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
          <NoteReminderButton noteId={note.id} reminder={reminder} onChange={setReminder} onError={onError} />
          <div className="note-share-wrap" ref={share.wrapRef}>
            <button
              ref={share.buttonRef}
              type="button"
              className={`btn btn-ghost btn-sm${note.shared ? ' is-on' : ''}`}
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
                <p className="notes-pop-hint">{t('share.hint')}</p>
                {note.share_token ? (
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
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => void onTrash(note.id)}
            aria-label={t('editor.trash')}
            title={t('editor.trash')}
          >
            <NotesIcon name="trash" size={15} />
          </button>
          <RowMenu
            open={menuOpen}
            label={t('editor.more')}
            onToggle={setMenuOpen}
            items={[
              {
                label: t('history.open'),
                onSelect: () => {
                  setMenuOpen(false);
                  setHistoryOpen(true);
                },
              },
              {
                label: t('export.markdown'),
                onSelect: () => {
                  setMenuOpen(false);
                  window.location.href = `/api/notes/${encodeURIComponent(note.id)}/export`;
                },
              },
            ]}
          />
        </div>
      </div>
      {historyOpen && (
        <NoteHistoryDrawer noteId={note.id} onClose={() => setHistoryOpen(false)} onRestored={() => onReload(note.id)} />
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
          maxLength={40}
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

      <div className="note-body">
        <DocsEditor page={page} ancestors={[]} onSave={handleSave} embedded pageLinks={pageLinks} files={files} />
      </div>
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
        {t('editor.created', { date: format.dateTime(new Date(note.created_at), { dateStyle: 'medium' }) })}
      </p>
    </div>
  );
}
