'use client';

import { useState } from 'react';

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
  labels: { request: string; sending: string; sent: string; error: string };
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle');

  async function send() {
    if (state === 'busy' || state === 'sent') return;
    setState('busy');
    const res = await fetch('/api/teams/access-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app }),
    }).catch(() => null);
    setState(res?.ok ? 'sent' : 'error');
  }

  if (state === 'sent') {
    return (
      <p className="home-blocked-sent" role="status" data-testid="access-requested">
        {labels.sent}
      </p>
    );
  }
  return (
    <div className="home-blocked-actions">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void send()} disabled={state === 'busy'} aria-busy={state === 'busy' || undefined}>
        {state === 'busy' ? labels.sending : labels.request}
      </button>
      {state === 'error' && (
        <p className="ui-error" role="alert">
          {labels.error}
        </p>
      )}
    </div>
  );
}
