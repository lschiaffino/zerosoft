'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Pantalla de quien abre el link de una nota sin permiso: no ve nada de adentro, puede pedir acceso. */
export function NoteAccessGate({ noteId, initial }: { noteId: string; initial: 'can_request' | 'pending' | 'denied' }) {
  const t = useTranslations('notes.access');
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function request() {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}/access`, { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (res?.ok) setStatus('pending');
    else setError(true);
  }

  return (
    <div className="notes-access-gate" data-testid="note-access-gate">
      <h1>{t('title')}</h1>
      <p>{status === 'pending' ? t('pending') : status === 'denied' ? t('denied') : t('body')}</p>
      {status !== 'pending' && (
        <button type="button" className="btn btn-primary" aria-busy={busy} onClick={() => void request()}>
          {status === 'denied' ? t('requestAgain') : t('request')}
        </button>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </div>
  );
}

interface AccessRequest {
  id: string;
  name: string | null;
  email: string;
}

/** Pedidos pendientes, dentro de Compartir (solo el dueño). */
export function NoteAccessRequests({ noteId, onDecided }: { noteId: string; onDecided: () => void }) {
  const t = useTranslations('notes.access');
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const url = `/api/notes/${encodeURIComponent(noteId)}/access`;

  const load = useCallback(async () => {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) setRequests(((await res.json()) as { requests: AccessRequest[] }).requests);
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, role: 'view' | 'edit' | null) {
    setBusy(true);
    setError(false);
    const res = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request_id: id, role }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(true);
      return;
    }
    setRequests(((await res.json()) as { requests: AccessRequest[] }).requests);
    onDecided();
  }

  if (!requests.length && !error) return null;
  return (
    <div className="notes-people notes-access-requests">
      <p className="notes-pop-title">{t('requests')}</p>
      <ul className="notes-people-list">
        {requests.map((r) => (
          <li key={r.id}>
            <span className="notes-people-who">{r.name || r.email}</span>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void decide(r.id, 'view')}>
              {t('approveView')}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void decide(r.id, 'edit')}>
              {t('approveEdit')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void decide(r.id, null)}>
              {t('deny')}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
    </div>
  );
}
