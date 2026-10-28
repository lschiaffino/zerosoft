'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { NOTE_LOCK_MIN_PASSWORD, noteLockSupported, openNote, WrongPasswordError, type LockedPayload, type NoteKey } from '@/lib/notes-crypto';
import type { NoteLockEnvelope } from '@/lib/notes-types';
import { NotesModal } from './NotesModal';
import NotesIcon from './NotesIcon';

/**
 * Claves de las notas desbloqueadas en esta pestaña (solo en memoria: al
 * recargar o cerrar, todas vuelven a pedir la contraseña).
 */
export const openNoteKeys = new Map<string, NoteKey>();

/** Diálogo para poner contraseña (dos veces) y una pista opcional. */
export function LockSetDialog({ onLock, onClose }: { onLock: (password: string, hint: string) => Promise<boolean>; onClose: () => void }) {
  const t = useTranslations('notes.lock');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { pw: useId(), pw2: useId(), hint: useId(), err: useId() };
  const supported = noteLockSupported();

  async function submit() {
    if (busy) return;
    if (pw.length < NOTE_LOCK_MIN_PASSWORD) return setError(t('tooShort'));
    if (pw !== pw2) return setError(t('mismatch'));
    setError(null);
    setBusy(true);
    const ok = await onLock(pw, hint);
    setBusy(false);
    if (ok) onClose();
    else setError(t('error'));
  }

  return (
    <NotesModal
      title={t('setTitle')}
      onClose={onClose}
      closeLabel={t('cancel')}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} aria-busy={busy} disabled={!supported || busy}>
            {busy ? t('busy') : t('submit')}
          </button>
        </>
      }
    >
      <form
        className="notes-lock-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="notes-field-hint">{t('setBody')}</p>
        {!supported && (
          <p className="notes-lock-error" role="alert">
            {t('unsupported')}
          </p>
        )}
        <label className="notes-field" htmlFor={ids.pw}>
          <span>{t('password')}</span>
          <input id={ids.pw} className="input" type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby={error ? ids.err : undefined} />
        </label>
        <label className="notes-field" htmlFor={ids.pw2}>
          <span>{t('confirm')}</span>
          <input id={ids.pw2} className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        <label className="notes-field" htmlFor={ids.hint}>
          <span>{t('hint')}</span>
          <input id={ids.hint} className="input" maxLength={120} value={hint} onChange={(e) => setHint(e.target.value)} />
        </label>
        <p className="notes-field-hint">{t('setWarn')}</p>
        {error && (
          <p id={ids.err} className="notes-lock-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </NotesModal>
  );
}

/** Pantalla de una nota bloqueada: contraseña y "Desbloquear". */
export function LockedNoteGate({
  noteId,
  title,
  envelope,
  untitled,
  onOpen,
}: {
  noteId: string;
  title: string;
  envelope: NoteLockEnvelope;
  untitled: string;
  onOpen: (payload: LockedPayload, key: NoteKey) => void;
}) {
  const t = useTranslations('notes.lock');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errId = useId();

  async function unlock() {
    if (!pw || busy) return;
    if (!noteLockSupported()) return setError(t('unsupported'));
    setBusy(true);
    setError(null);
    try {
      const { payload, key } = await openNote(pw, envelope);
      openNoteKeys.set(noteId, key);
      onOpen(payload, key);
    } catch (err) {
      setError(err instanceof WrongPasswordError ? t('wrong') : t('unsupported'));
      setPw('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="note-locked">
      <NotesIcon name="lock" size={28} />
      <h1 className="note-view-title">{title || untitled}</h1>
      <p className="note-locked-title">{t('lockedTitle')}</p>
      <p className="notes-field-hint">{t('lockedBody')}</p>
      <form
        className="note-locked-form"
        onSubmit={(e) => {
          e.preventDefault();
          void unlock();
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          {t('password')}
        </label>
        <input
          id={inputId}
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          placeholder={t('password')}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
        />
        <button type="submit" className="btn btn-primary" aria-busy={busy} disabled={!pw || busy}>
          {busy ? t('opening') : t('open')}
        </button>
      </form>
      {envelope.hint && <p className="notes-field-hint">{t('hintShown', { hint: envelope.hint })}</p>}
      {error && (
        <p id={errId} className="notes-lock-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
