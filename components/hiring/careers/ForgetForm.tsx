'use client';

import { useState } from 'react';
import { fill, type CareersStrings } from '@/lib/hiring/careers-i18n';

/** Pedido de borrado de datos del candidato (link del email de acuse). */
export default function ForgetForm({ token, company, t }: { token: string; company: string; t: CareersStrings }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const run = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/hiring/public/forget', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };
  return (
    <div className="cr-wrap">
      <h1 className="cr-title">{t.privacyTitle}</h1>
      {state === 'done' ? (
        <p className="cr-done" role="status">
          {t.privacyDone}
        </p>
      ) : (
        <>
          <p>{fill(t.privacyBody, { company })}</p>
          {state === 'error' && (
            <p className="cr-error" role="alert">
              {t.notFound}
            </p>
          )}
          <button type="button" className="cr-button" disabled={state === 'busy'} onClick={run}>
            {t.privacyButton}
          </button>
        </>
      )}
    </div>
  );
}
