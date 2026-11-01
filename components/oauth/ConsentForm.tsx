'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

export interface ConsentWorkspace {
  teamId: string | null;
  name: string;
  own: boolean;
}

/**
 * Qué se le da al cliente, dicho en claro: su nombre (lo eligió el cliente, por
 * eso va con el destino al lado), la cuenta, el workspace y si puede escribir.
 * Enter aprueba; Esc y Cancelar deniegan, nada queda aprobado por defecto.
 */
export default function ConsentForm({
  mode,
  target,
  clientName,
  redirectHost,
  askedScope,
  personEmail,
  workspaces,
  activeTeamId,
  onDone,
}: {
  mode: 'code' | 'device';
  target: string;
  clientName: string;
  /** Adónde vuelve; null = una app en esta misma computadora (loopback); sin definir = dispositivo. */
  redirectHost?: string | null;
  askedScope: string;
  personEmail: string;
  workspaces: ConsentWorkspace[];
  activeTeamId: string | null;
  onDone?: (approved: boolean) => void;
}) {
  const t = useTranslations('settings.oauth');
  const canWrite = askedScope.split(' ').includes('write');
  const [scope, setScope] = useState(canWrite ? 'read write' : 'read');
  const [team, setTeam] = useState(activeTeamId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'approve' | 'deny') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === 'code' ? '/api/oauth/consent' : '/api/oauth/device', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(mode === 'code' ? { request: target } : { code: target }),
          decision,
          ...(decision === 'approve' ? { scope, teamId: team || null } : {}),
        }),
      });
      if (!res.ok) {
        setError(t(res.status === 410 || res.status === 404 ? 'errorExpired' : 'errorGeneric'));
        setBusy(false);
        return;
      }
      const data = (await res.json()) as { redirect?: string };
      if (data.redirect) {
        window.location.assign(data.redirect);
        return;
      }
      onDone?.(decision === 'approve');
      setBusy(false);
    } catch {
      setError(t('errorGeneric'));
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void decide('approve');
  }

  return (
    <form
      className="oauth-form"
      onSubmit={onSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') void decide('deny');
      }}
    >
      <h1>{t('title', { client: clientName })}</h1>
      <p className="oauth-origin">{redirectHost ? t('redirectsTo', { host: redirectHost }) : t(redirectHost === null ? 'redirectsLocal' : 'deviceOrigin')}</p>
      <p className="auth-sub oauth-sub">{t('asPerson', { email: personEmail })}</p>

      {workspaces.length > 1 && (
        <div className="ui-field oauth-field">
          <label className="label" htmlFor="oauth-workspace">{t('workspace')}</label>
          <select id="oauth-workspace" className="select" value={team} onChange={(e) => setTeam(e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.teamId ?? 'own'} value={w.teamId ?? ''}>
                {w.name || t('personalWorkspace')}
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="oauth-scopes">
        <legend className="label">{t('access')}</legend>
        {canWrite && (
          <label className="oauth-scope">
            <input type="radio" name="scope" value="read write" checked={scope === 'read write'} onChange={() => setScope('read write')} />
            <span>
              <strong>{t('scopeWrite')}</strong>
              <span className="ui-help">{t('scopeWriteHelp')}</span>
            </span>
          </label>
        )}
        <label className="oauth-scope">
          <input type="radio" name="scope" value="read" checked={scope === 'read'} onChange={() => setScope('read')} />
          <span>
            <strong>{t('scopeRead')}</strong>
            <span className="ui-help">{t('scopeReadHelp')}</span>
          </span>
        </label>
      </fieldset>

      <ul className="oauth-notes">
        <li>{t('noteSame')}</li>
        <li>{t('noteOut')}</li>
        <li>{t('noteRevoke')}</li>
      </ul>

      {error && <p className="ui-error" role="alert">{error}</p>}

      <div className="oauth-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void decide('deny')} disabled={busy}>{t('deny')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('working') : t('approve')}</button>
      </div>
      <p className="oauth-warning">{t('warning')}</p>
    </form>
  );
}
