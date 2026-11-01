'use client';

import { useState } from 'react';

type State = 'idle' | 'busy' | 'sent' | 'already' | 'hasAccess' | 'limited' | 'error';

/**
 * "Pedir acceso" en la pantalla de app bloqueada: avisa al owner y a los
 * admins del workspace (POST /api/teams/access-request). Los textos llegan
 * hechos del servidor.
 */
export default function RequestAccessButton({
  app,
  labels,
}: {
  app: string;
  labels: { request: string; sending: string; sent: string; already: string; hasAccess: string; limited: string; error: string };
}) {
  const [state, setState] = useState<State>('idle');

  async function send() {
    if (state === 'busy') return;
    setState('busy');
    const res = await fetch('/api/teams/access-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app }),
    }).catch(() => null);
    if (res?.status === 429) return setState('limited');
    if (res?.status === 409) return setState('hasAccess');
    if (!res?.ok) return setState('error');
    const data = (await res.json().catch(() => ({}))) as { already?: boolean };
    setState(data.already ? 'already' : 'sent');
  }

  if (state === 'sent' || state === 'already' || state === 'hasAccess') {
    return (
      <p className="home-blocked-sent" role="status" data-testid="access-requested">
        {labels[state]}
      </p>
    );
  }
  return (
    <div className="home-blocked-actions">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void send()} disabled={state === 'busy'} aria-busy={state === 'busy' || undefined}>
        {state === 'busy' ? labels.sending : labels.request}
      </button>
      {(state === 'error' || state === 'limited') && (
        <p className="ui-error" role="alert">
          {labels[state]}
        </p>
      )}
    </div>
  );
}
