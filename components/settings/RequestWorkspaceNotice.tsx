'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export type RequestNoticeReason = 'switch' | 'notPart' | 'removed' | 'adminOnly' | 'adminsOnly';

/**
 * Un link de "pide acceso" que no puede abrir el diálogo dice por qué: es de
 * otro workspace (y se puede cambiar), la persona ya no está o quien mira no
 * puede editarla. Nunca queda mudo.
 */
export default function RequestWorkspaceNotice({ teamId, workspace, reason }: { teamId: string | null; workspace: string; reason: RequestNoticeReason }) {
  const t = useTranslations('settings.members.requestWorkspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function go() {
    setBusy(true);
    setError(false);
    const res = await fetch('/api/teams/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.reload();
      return;
    }
    setBusy(false);
    setError(true);
  }

  return (
    <div className="ws-notice ws-request-notice" role="note" data-testid="request-other-workspace">
      <p>{t(reason === 'switch' ? 'body' : reason, { workspace })}</p>
      {reason === 'switch' && (
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void go()} disabled={busy} aria-busy={busy || undefined}>
            {t('switch', { workspace })}
          </button>
          {error && (
            <p className="ui-error" role="alert">
              {t('error')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
