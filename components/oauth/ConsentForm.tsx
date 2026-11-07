'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

export interface ConsentWorkspace {
  teamId: string | null;
  name: string;
  own: boolean;
}

/** El nombre lo eligió el cliente: en el título, corto; entero en el detalle de abajo. */
const NAME_IN_TITLE = 40;
const shortName = (name: string) => (name.length > NAME_IN_TITLE ? `${name.slice(0, NAME_IN_TITLE - 1).trimEnd()}…` : name);

/**
 * Qué se le da al cliente, dicho en claro: su nombre (lo eligió el cliente, por
 * eso va marcado así y con el destino al lado), la cuenta, el workspace y si
 * puede escribir. Enter aprueba; Esc y Cancelar deniegan. En un dispositivo
 * arranca en solo lectura: nadie vio de dónde viene ese pedido.
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
  const [scope, setScope] = useState(canWrite && mode === 'code' ? 'read write' : 'read');
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

  // Esc cancela desde que abre la página, con el foco donde esté.
  const decideRef = useRef(decide);
  decideRef.current = decide;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') void decideRef.current('deny');
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void decide('approve');
  }

  return (
    <form className="oauth-form" onSubmit={onSubmit}>
      <h1 title={clientName}>{t('title', { client: shortName(clientName) })}</h1>
      <p className="oauth-origin">{t('selfDeclared', { client: clientName })}</p>
      {mode === 'device' && (
        <div className="oauth-alert" role="note">
          <strong>{t('deviceWarningTitle')}</strong>
          <span>{t('deviceWarningBody')}</span>
        </div>
      )}
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
        <li>{t('noteKeeps')}</li>
      </ul>

      {error && <p className="ui-error" role="alert">{error}</p>}

      <div className="oauth-actions">
        <button type="button" className="btn btn-secondary" onClick={() => void decide('deny')} disabled={busy}>{t('deny')}</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('working') : t('approve')}</button>
      </div>
    </form>
  );
}
