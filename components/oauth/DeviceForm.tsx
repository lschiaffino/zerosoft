'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import ConsentForm, { type ConsentWorkspace } from './ConsentForm';

/**
 * El código viene de la URL o se tipea, y la persona siempre confirma que es el
 * que ve en su terminal: un link con el código puesto no salta a los permisos.
 */
export default function DeviceForm({
  initialCode,
  personEmail,
  workspaces,
  activeTeamId,
}: {
  initialCode: string;
  personEmail: string;
  workspaces: ConsentWorkspace[];
  activeTeamId: string | null;
}) {
  const t = useTranslations('settings.oauth');
  const [code, setCode] = useState(initialCode);
  const [found, setFound] = useState<{ clientName: string; scope: string } | null>(null);
  const [done, setDone] = useState<'approved' | 'denied' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function lookup(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/oauth/device', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: value, decision: 'lookup' }),
      });
      const data = res.ok ? ((await res.json()) as { found: boolean; clientName: string; scope: string }) : null;
      if (data?.found) setFound(data);
      else {
        setError(t(res.status === 429 ? 'errorTooMany' : 'errorCode'));
        input.current?.focus();
      }
    } catch {
      setError(t('errorGeneric'));
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="oauth-form">
        <h1>{t(done === 'approved' ? 'deviceDoneTitle' : 'deviceDeniedTitle')}</h1>
        <p className="auth-sub oauth-sub">{t(done === 'approved' ? 'deviceDoneBody' : 'deviceDeniedBody')}</p>
      </div>
    );
  }
  if (found) {
    return (
      <ConsentForm
        mode="device"
        target={code}
        clientName={found.clientName}
        askedScope={found.scope}
        personEmail={personEmail}
        workspaces={workspaces}
        activeTeamId={activeTeamId}
        onDone={(approved) => setDone(approved ? 'approved' : 'denied')}
      />
    );
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (code.trim() && !busy) void lookup(code.trim());
  }
  return (
    <form className="oauth-form" onSubmit={onSubmit}>
      <h1>{t('deviceTitle')}</h1>
      <p className="auth-sub oauth-sub">{t(initialCode ? 'deviceConfirm' : 'deviceBody')}</p>
      <div className="ui-field oauth-field">
        <label className="label" htmlFor="oauth-code">{t('deviceCode')}</label>
        <input
          id="oauth-code"
          ref={input}
          aria-invalid={Boolean(error)}
          className="input oauth-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCD-EFGH"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={20}
          autoFocus
        />
      </div>
      {error && <p className="ui-error" role="alert">{error}</p>}
      <div className="oauth-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>{busy ? t('working') : t('deviceContinue')}</button>
      </div>
    </form>
  );
}
