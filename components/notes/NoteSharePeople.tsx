'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { NoteShareInfo, NoteShareRole } from '@/lib/notes-shares';
import NotesIcon from './NotesIcon';

interface Candidate {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Compartir con compañeros del workspace (una nota o una libreta): quién
 * tiene acceso, con qué rol, y sumar a alguien más. `apiUrl` es la ruta
 * .../shares de la nota o de la libreta.
 */
export function NoteSharePeople({ apiUrl, onCount }: { apiUrl: string; onCount?: (n: number) => void }) {
  const t = useTranslations('notes.people');
  const [shares, setShares] = useState<NoteShareInfo[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<NoteShareRole>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  const apply = useCallback((data: { shares: NoteShareInfo[]; candidates: Candidate[] }) => {
    setShares(data.shares);
    setCandidates(data.candidates);
    onCountRef.current?.(data.shares.length);
  }, []);

  useEffect(() => {
    let alive = true;
    void fetch(apiUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        if (alive) apply(await res.json());
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [apiUrl, apply]);

  async function patch(personId: string, next: NoteShareRole | null) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personId, role: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      apply(await res.json());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const taken = new Set((shares ?? []).map((s) => s.person_id));
  const options = candidates.filter((c) => !taken.has(c.id));

  return (
    <div className="notes-people">
      <p className="notes-pop-title">{t('title')}</p>
      {shares === null && !error ? (
        <p className="notes-pop-hint" role="status">
          {t('loading')}
        </p>
      ) : shares && shares.length > 0 ? (
        <ul className="notes-people-list">
          {shares.map((s) => (
            <li key={s.person_id}>
              <span className="notes-people-who">{s.name || s.email}</span>
              <select
                className="select"
                value={s.role}
                disabled={busy}
                aria-label={t('roleFor', { name: s.name || s.email })}
                onChange={(e) => void patch(s.person_id, e.target.value as NoteShareRole)}
              >
                <option value="view">{t('roles.view')}</option>
                <option value="edit">{t('roles.edit')}</option>
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                disabled={busy}
                onClick={() => void patch(s.person_id, null)}
                aria-label={t('remove', { name: s.name || s.email })}
                title={t('remove', { name: s.name || s.email })}
              >
                <NotesIcon name="close" size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="notes-pop-hint">{t('nobody')}</p>
      )}
      {shares !== null &&
        (options.length > 0 ? (
          <div className="notes-pop-row notes-people-add">
            <select className="select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('choose')}>
              <option value="">{t('choose')}</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.email}
                </option>
              ))}
            </select>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value as NoteShareRole)} aria-label={t('role')}>
              <option value="view">{t('roles.view')}</option>
              <option value="edit">{t('roles.edit')}</option>
            </select>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!pick || busy}
              onClick={() => {
                const id = pick;
                setPick('');
                void patch(id, role);
              }}
            >
              {t('add')}
            </button>
          </div>
        ) : candidates.length === 0 && shares.length === 0 ? (
          <p className="notes-pop-hint">{t('noTeam')}</p>
        ) : null)}
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </div>
  );
}

/** Drawer para compartir una libreta entera (menú de la libreta). */
export function NotebookShareDrawer({ notebookId, name, onClose }: { notebookId: string; name: string; onClose: () => void }) {
  const t = useTranslations('notes.people');
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="ui-drawer notes-history"
      aria-labelledby="notebook-share-title"
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
        <h2 id="notebook-share-title" className="ui-drawer-title">
          {t('notebookTitle', { name })}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label={t('close')}>
          <NotesIcon name="close" size={16} />
        </button>
      </div>
      <div className="ui-drawer-body">
        <p className="notes-pop-hint">{t('notebookHint')}</p>
        <NoteSharePeople apiUrl={`/api/notes/notebooks/${encodeURIComponent(notebookId)}/shares`} />
      </div>
    </dialog>
  );
}
