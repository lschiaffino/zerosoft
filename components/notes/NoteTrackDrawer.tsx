'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { htmlLiteToText, type NoteDetail } from '@/lib/notes-types';
import { hasIssueLink } from '@/lib/notes-issue-links';
import NotesIcon from './NotesIcon';

interface ProjectOption {
  id: string;
  name: string;
}

/**
 * Nota → Track: la nota entera como un issue, o tareas elegidas como un
 * issue cada una. Antes de mostrar las tareas se espera el autoguardado
 * (`onSync` devuelve la nota fresca del servidor): así se mandan las tareas
 * tal como están y el link al issue se agrega sobre lo último guardado.
 */
export default function NoteTrackDrawer({
  noteId,
  onSync,
  onClose,
  onDone,
}: {
  noteId: string;
  onSync: () => Promise<NoteDetail | null>;
  onClose: () => void;
  onDone: (issues: Array<{ id: string; identifier: string }>) => void;
}) {
  const t = useTranslations('notes.track');
  const locale = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState<'tasks' | 'note'>('tasks');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  useEffect(() => {
    let alive = true;
    void (async () => {
      const fresh = await onSyncRef.current();
      if (!alive) return;
      if (!fresh) {
        setError(t('loadError'));
        return;
      }
      setNote(fresh);
      const open = fresh.content.filter((b) => b.type === 'todo' && !b.checked && !hasIssueLink(b.content) && htmlLiteToText(b.content).trim());
      setPicked(new Set(open.map((b) => b.id)));
      if (!fresh.content.some((b) => b.type === 'todo')) setMode('note');
    })();
    void fetch('/api/track/projects?pageSize=100')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { rows: ProjectOption[] };
        if (!alive) return;
        setProjects(data.rows.map((p) => ({ id: p.id, name: p.name })));
        setProjectId((cur) => cur || data.rows[0]?.id || '');
      })
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [noteId, t]);

  const todos = (note?.content ?? []).filter((b) => b.type === 'todo' && htmlLiteToText(b.content).trim());

  async function submit() {
    if (!note || !projectId) return;
    const blockIds = mode === 'tasks' ? todos.filter((b) => picked.has(b.id)).map((b) => b.id) : undefined;
    if (mode === 'tasks' && !blockIds?.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(note.id)}/track`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId, blockIds, base_updated_at: note.updated_at, locale }),
      });
      if (res.status === 409) {
        setError(t('conflict'));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { issues: Array<{ id: string; identifier: string }> };
      onDone(data.issues);
    } catch {
      setError(t('error'));
    } finally {
      setBusy(false);
    }
  }

  const count = mode === 'tasks' ? todos.filter((b) => picked.has(b.id)).length : 1;

  return (
    <dialog
      ref={dialogRef}
      className="ui-drawer notes-history"
      aria-labelledby="note-track-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ui-drawer-head">
        <h2 id="note-track-title" className="ui-drawer-title">
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t('close')}>
          <NotesIcon name="close" size={16} />
        </button>
      </div>
      <div className="ui-drawer-body notes-track">
        {!note ? (
          !error && (
            <p className="notes-pop-hint" role="status">
              {t('syncing')}
            </p>
          )
        ) : (
          <>
            <fieldset className="notes-track-modes">
              <legend className="sr-only">{t('title')}</legend>
              <label>
                <input type="radio" name="note-track-mode" checked={mode === 'tasks'} disabled={todos.length === 0} onChange={() => setMode('tasks')} />
                {t('modeTasks')}
              </label>
              <label>
                <input type="radio" name="note-track-mode" checked={mode === 'note'} onChange={() => setMode('note')} />
                {t('modeNote')}
              </label>
            </fieldset>
            {mode === 'tasks' ? (
              todos.length === 0 ? (
                <p className="notes-pop-hint">{t('noTasks')}</p>
              ) : (
                <ul className="notes-track-tasks">
                  {todos.map((b) => {
                    const linked = hasIssueLink(b.content);
                    return (
                      <li key={b.id}>
                        <label className={linked ? 'is-linked' : undefined}>
                          <input
                            type="checkbox"
                            checked={!linked && picked.has(b.id)}
                            disabled={linked}
                            onChange={(e) =>
                              setPicked((cur) => {
                                const next = new Set(cur);
                                if (e.target.checked) next.add(b.id);
                                else next.delete(b.id);
                                return next;
                              })
                            }
                          />
                          <span className={b.checked ? 'notes-track-done' : undefined}>{htmlLiteToText(b.content).trim()}</span>
                          {linked && <span className="notes-track-linked">{t('linked')}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <p className="notes-pop-hint">{t('noteHint', { title: note.title || t('untitled') })}</p>
            )}
            {projects === null ? (
              <p className="notes-pop-hint" role="status">
                {t('loadingProjects')}
              </p>
            ) : projects.length === 0 ? (
              <p className="notes-pop-hint">
                {t('noProjects')} <Link href="/app/track">{t('openTrack')}</Link>
              </p>
            ) : (
              <label className="notes-track-project">
                <span>{t('project')}</span>
                <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="notes-pop-hint">{t('backlinkHint')}</p>
            <div className="notes-track-actions">
              <button type="button" className="btn btn-sm" onClick={onClose}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                aria-busy={busy}
                disabled={busy || !projectId || count === 0}
                onClick={() => void submit()}
              >
                {t('create', { count })}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
