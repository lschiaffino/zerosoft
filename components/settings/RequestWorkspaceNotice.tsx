'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * El aviso de "pide acceso" es de otro workspace que el activo: el acceso de
 * esa persona no se abre acá. Cambia de workspace y recarga (el link conserva
 * ?person=&ws=). Sin `canSwitch` la persona ya no es parte de ese workspace.
 */
export default function RequestWorkspaceNotice({
  teamId,
  workspace,
  canSwitch,
}: {
  teamId: string | null;
  workspace: string;
  canSwitch: boolean;
}) {
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
    <div className="ws-notice" role="note" data-testid="request-other-workspace">
      {canSwitch ? (
        <>
          <p>{t('body', { workspace })}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void go()} disabled={busy} aria-busy={busy || undefined}>
            {t('switch', { workspace })}
          </button>
          {error && (
            <p className="ui-error" role="alert">
              {t('error')}
            </p>
          )}
        </>
      ) : (
        <p>{t('gone')}</p>
      )}
    </div>
  );
}
