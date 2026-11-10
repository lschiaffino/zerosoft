'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { HubspotDto } from '@/lib/groups-hubspot';
import { Modal, api, useErrorText, useToast } from './ui';

export interface HubspotScopes {
  read: readonly string[];
  optional: readonly string[];
  log: readonly string[];
}

/**
 * HubSpot en Ajustes › Integraciones: conectar con el token de una private
 * app (se muestran los permisos que necesita), y los dos ajustes del
 * workspace: vincular solo con una única coincidencia y registrar la
 * conversación como notas. El token nunca vuelve del servidor.
 */
export default function HubspotCard({ initial, scopes, canEdit }: { initial: HubspotDto; scopes: HubspotScopes; canEdit: boolean }) {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [toast, showToast] = useToast();
  const scopesId = useId();
  const [row, setRow] = useState(initial);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [autoLink, setAutoLink] = useState(initial.autoLink);
  const [logNotes, setLogNotes] = useState(initial.logNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);

  function edit() {
    setToken('');
    setAutoLink(row.autoLink);
    setLogNotes(row.logNotes);
    setError('');
    setOpen(true);
  }

  async function save() {
    if (!row.connected && !token.trim()) return setError(errText('hubspot_invalid_token'));
    setBusy(true);
    setError('');
    const body: Record<string, unknown> = {};
    if (token.trim()) body.token = token.trim();
    if (row.connected) {
      body.autoLink = autoLink;
      body.logNotes = logNotes;
    }
    const res = await api<HubspotDto>('/api/groups/hubspot', { body });
    setBusy(false);
    if (!res.data) {
      setError(errText(res.error));
      // El token pudo guardarse aunque un ajuste haya fallado: se relee el estado.
      const now = await api<HubspotDto>('/api/groups/hubspot');
      if (now.data) setRow(now.data);
      return;
    }
    setRow(res.data);
    setOpen(false);
    showToast(t('common.saved'));
  }

  async function remove() {
    const res = await api('/api/groups/hubspot', { method: 'DELETE' });
    setRemoving(false);
    if (!res.data) return showToast(errText(res.error), true);
    setRow({ ...row, connected: false, portalId: '', scopes: [], missingLogScopes: [], autoLink: false, logNotes: false, lastError: '', lastUsedAt: null });
  }

  const missingLog = row.connected && row.missingLogScopes.length > 0;
  const scopeList = (items: readonly string[]) => (
    <ul className="gr-hs-scopes gr-mono">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );

  return (
    <li className="gr-integration">
      <span>
        <strong>HubSpot</strong> <span className="ui-help">{t('hubspot.card.desc')}</span>
        <br />
        <span className={row.lastError ? 'ui-error' : 'ui-help'}>
          {!row.connected
            ? t('integrations.notConnected')
            : row.lastError
              ? t('integrations.error', { code: errText(row.lastError) || row.lastError })
              : t('hubspot.card.connectedTo', { id: row.portalId })}
        </span>
      </span>
      {canEdit && (
        <span className="gr-inline-form">
          <button type="button" className="btn btn-secondary btn-sm" onClick={edit}>
            {row.connected ? t('integrations.edit') : t('integrations.connect')}
          </button>
          {row.connected && (
            <button type="button" className="btn btn-ghost btn-sm gr-danger" onClick={() => setRemoving(true)}>
              {t('integrations.disconnect')}
            </button>
          )}
        </span>
      )}
      <Modal
        open={open}
        title="HubSpot"
        onClose={() => setOpen(false)}
        onSubmit={() => void save()}
        busy={busy}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>
              {row.connected ? t('common.save') : t('integrations.connect')}
            </button>
          </>
        }
      >
        <div className="ui-fields">
          <p className="ui-help">{t('hubspot.card.help')}</p>
          <label className="ui-field">
            <span className="label">{t('hubspot.card.token')}</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={row.connected ? t('integrations.keep') : 'pat-…'}
              aria-describedby={scopesId}
            />
          </label>
          <div className="gr-hs-scope-groups" id={scopesId}>
            <div>
              <p className="label">{t('hubspot.card.scopesRead')}</p>
              {scopeList(scopes.read)}
            </div>
            <div>
              <p className="label">{t('hubspot.card.scopesOptional')}</p>
              {scopeList(scopes.optional)}
            </div>
            <div>
              <p className="label">{t('hubspot.card.scopesLog')}</p>
              {scopeList(scopes.log)}
            </div>
          </div>
          {row.connected && (
            <fieldset className="ui-field">
              <legend className="label">{t('hubspot.card.settings')}</legend>
              <label className="gr-check-label gr-hs-check">
                <input type="checkbox" className="ui-check" checked={autoLink} onChange={(e) => setAutoLink(e.target.checked)} />
                {t('hubspot.card.autoLink')}
              </label>
              <p className="ui-help">{t('hubspot.card.autoLinkHelp')}</p>
              <label className="gr-check-label gr-hs-check">
                <input type="checkbox" className="ui-check" checked={logNotes} onChange={(e) => setLogNotes(e.target.checked)} />
                {t('hubspot.card.logNotes')}
              </label>
              <p className="ui-help">{t('hubspot.card.logNotesHelp')}</p>
              {missingLog && <p className="ui-help">{t('hubspot.card.logNotesNeedsScope', { scopes: row.missingLogScopes.join(', ') })}</p>}
            </fieldset>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={removing}
        title={t('integrations.disconnectTitle', { name: 'HubSpot' })}
        body={t('hubspot.card.disconnectBody')}
        confirmLabel={t('integrations.disconnect')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(false)}
      />
      {toast}
    </li>
  );
}
