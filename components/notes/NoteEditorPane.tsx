'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import DocsEditor from '@/components/docs/DocsEditor';
import type { DocsBlock, DocsPage } from '@/lib/docs-types';
import { normalizeTag, type NoteDetail, type NotebookInfo } from '@/lib/notes-types';
import NoteBlocksView from './NoteBlocksView';

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
}: Props) {
  const t = useTranslations('notes');
  const format = useFormatter();
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagDraft, setTagDraft] = useState('');
  const [pinned, setPinned] = useState(note.pinned);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);

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

  const handleSave = useCallback(
    (p: DocsPage) => {
      void onSaveContent(p.id, { title: p.title, content: p.content });
    },
    [onSaveContent],
  );

  // Nota recién creada: foco en el título.
  useEffect(() => {
    if (!focusTitle) return;
    const el = wrapRef.current?.querySelector<HTMLElement>('.docs-title');
    el?.focus();
  }, [focusTitle]);

  useEffect(() => {
    if (!shareOpen) return;
    function onDoc(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [shareOpen]);

  async function saveTags(next: string[]) {
    setTags(next);
    await onPatch(note.id, { tags: next });
  }

  function addTag(raw: string) {
    const tag = normalizeTag(raw);
    setTagDraft('');
    if (!tag || tags.includes(tag)) return;
    void saveTags([...tags, tag]);
  }

  async function togglePin() {
    setPinned((v) => !v);
    await onPatch(note.id, { pinned: !pinned });
  }

  async function setShare(shared: boolean) {
    const res = await fetch(`/api/notes/${note.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shared }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { share_token: string | null };
    onShareChange(data.share_token);
  }

  const shareUrl =
    note.share_token && typeof window !== 'undefined' ? `${window.location.origin}/n/${note.share_token}` : '';

  const statusLabel =
    status === 'saving' ? t('editor.saving') : status === 'saved' ? t('editor.saved') : status === 'error' ? t('editor.saveError') : '';

  if (note.trashed) {
    return (
      <div className="note-pane" ref={wrapRef}>
        <div className="note-bar">
          <button type="button" className="notes-back" onClick={onBack}>
            ‹ {t('editor.back')}
          </button>
          <span className="note-bar-info">{t('trash.banner')}</span>
          <div className="note-bar-actions">
            <button type="button" className="btn btn-small" onClick={() => void onRestore(note.id)}>
              {t('trash.restore')}
            </button>
            <button type="button" className="btn btn-small notes-danger" onClick={() => void onDeleteForever(note.id)}>
              {t('trash.deleteForever')}
            </button>
          </div>
        </div>
        <div className="note-body note-body-readonly">
          <h1 className="note-view-title">{note.title || t('untitled')}</h1>
          <NoteBlocksView blocks={note.content} />
        </div>
      </div>
    );
  }

  return (
    <div className="note-pane" ref={wrapRef}>
      <div className="note-bar">
        <button type="button" className="notes-back" onClick={onBack}>
          ‹ {t('editor.back')}
        </button>
        <select
          className="note-notebook"
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
        <span className="note-status mono" aria-live="polite">
          {statusLabel}
        </span>
        <div className="note-bar-actions">
          <button
            type="button"
            className={`notes-icon-btn note-pin${pinned ? ' on' : ''}`}
            onClick={() => void togglePin()}
            aria-pressed={pinned}
            title={pinned ? t('editor.unpin') : t('editor.pin')}
          >
            {pinned ? t('editor.pinned') : t('editor.pin')}
          </button>
          <div className="note-share-wrap" ref={shareRef}>
            <button
              type="button"
              className={`notes-icon-btn${note.shared ? ' on' : ''}`}
              onClick={() => setShareOpen((v) => !v)}
              aria-expanded={shareOpen}
            >
              {t('share.button')}
            </button>
            {shareOpen && (
              <div className="note-pop" role="dialog" aria-label={t('share.title')}>
                <p className="note-pop-title">{t('share.title')}</p>
                <p className="note-pop-hint">{t('share.hint')}</p>
                {note.share_token ? (
                  <>
                    <div className="note-share-row">
                      <input className="notes-inline-input" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => {
                          void navigator.clipboard.writeText(shareUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                      >
                        {copied ? t('share.copied') : t('share.copy')}
                      </button>
                    </div>
                    <button type="button" className="notes-link-btn danger" onClick={() => void setShare(false)}>
                      {t('share.disable')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-small btn-solid" onClick={() => void setShare(true)}>
                    {t('share.enable')}
                  </button>
                )}
              </div>
            )}
          </div>
          <button type="button" className="notes-icon-btn" onClick={() => void onTrash(note.id)} title={t('editor.trash')}>
            {t('editor.trash')}
          </button>
        </div>
      </div>

      <div className="note-tags">
        {tags.map((tg) => (
          <span key={tg} className="notes-tag">
            #{tg}
            <button type="button" onClick={() => void saveTags(tags.filter((x) => x !== tg))} aria-label={t('editor.removeTag', { tag: tg })}>
              ×
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
        <DocsEditor page={page} ancestors={[]} onSave={handleSave} embedded />
      </div>
      <p className="note-foot mono">
        {t('editor.created', { date: format.dateTime(new Date(note.created_at), { dateStyle: 'medium' }) })}
      </p>
    </div>
  );
}
