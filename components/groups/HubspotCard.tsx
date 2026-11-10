'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalText from '@/components/ui/LocalText';
import { Link } from '@/i18n/navigation';
import type { HubspotDto } from '@/lib/groups-hubspot';
import { HUBSPOT_MAX_PINNED, type HubspotSchemaDto } from '@/lib/groups-hubspot-shared';
import { parseDbUtc } from '@/lib/utils';
import { setHubspotSchema, useHubspotSchema } from './hubspot-client';
import { Modal, api, useErrorText, useToast } from './ui';

export interface HubspotScopes {
  read: readonly string[];
  /** Para editar propiedades de la empresa desde Lines. */
  sync?: readonly string[];
  optional: readonly string[];
  log: readonly string[];
}

/**
 * Propiedades de HubSpot del workspace: cuándo se importaron, "Actualizar
 * propiedades" y cuáles van fijadas arriba (y en los detalles del chat).
 */
function PropertiesModal({ open, onClose, showToast }: { open: boolean; onClose: () => void; showToast: (text: string, error?: boolean) => void }) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const errText = useErrorText();
  const { schema, failed, reload } = useHubspotSchema(open);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    const res = await api<HubspotSchemaDto>('/api/groups/hubspot/properties', { body });
    setBusy(false);
    if (!res.data) return showToast(errText(res.error), true);
    setHubspotSchema(res.data);
    showToast(done);
  }

  const pinned = (schema?.pinned ?? []).map((n) => schema?.props.find((p) => p.name === n)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  return (
    <Modal
      open={open}
      title={t('hubspot.card.propsTitle')}
      onClose={onClose}
      foot={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      {failed ? (
        <p className="ui-help" role="alert">
          {t('hubspot.card.propsError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            {t('common.retry')}
          </button>
        </p>
      ) : !schema ? (
        <p className="ui-help" role="status">
          {t('common.loading')}
        </p>
      ) : (
        <div className="ui-fields">
          <div className="gr-hs-refresh">
            <p className="ui-help">
              <LocalText>
                {t('hubspot.card.propsCount', {
                  n: schema.props.length,
                  time: schema.syncedAt ? parseDbUtc(schema.syncedAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '',
                })}
              </LocalText>
            </p>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} aria-busy={busy || undefined} onClick={() => void send({ refresh: true }, t('hubspot.card.propsRefreshed'))}>
              {t('hubspot.card.propsRefresh')}
            </button>
          </div>
          <fieldset className="ui-field">
            <legend className="label">{t('hubspot.card.pinnedTitle')}</legend>
            <p className="ui-help">{t('hubspot.card.pinnedHelp', { n: HUBSPOT_MAX_PINNED })}</p>
            <ul className="gr-hs-pins" aria-label={t('hubspot.card.pinnedTitle')}>
              {pinned.map((p) => (
                <li key={p.name}>
                  <span>{p.label}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    aria-label={t('hubspot.screen.unpin', { label: p.label })}
                    onClick={() => void send({ pinned: schema.pinned.filter((n) => n !== p.name) }, t('common.saved'))}
                  >
                    {t('hubspot.card.unpin')}
                  </button>
                </li>
              ))}
            </ul>
            {schema.pinned.length < HUBSPOT_MAX_PINNED && (
              <select
                className="select"
                value=""
                disabled={busy}
                aria-label={t('hubspot.card.pinAdd')}
                onChange={(e) => {
                  if (e.target.value) void send({ pinned: [...schema.pinned, e.target.value] }, t('common.saved'));
                }}
              >
                <option value="">{t('hubspot.card.pinAdd')}</option>
                {schema.groups.map((g) => (
                  <optgroup key={g.name} label={g.label}>
                    {schema.props
                      .filter((p) => p.group === g.name && !schema.pinned.includes(p.name))
                      .map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            )}
          </fieldset>
        </div>
      )}
    </Modal>
  );
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
  const [propsOpen, setPropsOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  function edit() {
    setToken('');
    setSecret('');
    // La URL del webhook la arma el servidor (no viene con la página).
    void api<{ webhookUrl?: string }>('/api/groups/hubspot').then((r) => setWebhookUrl(r.data?.webhookUrl ?? ''));
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
      if (secret.trim()) body.webhookSecret = secret.trim();
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
    setRow({ ...row, connected: false, portalId: '', scopes: [], missingLogScopes: [], missingSyncScopes: [], autoLink: false, logNotes: false, lastError: '', lastUsedAt: null, schemaSyncedAt: null, syncedAt: null, webhook: false });
    setHubspotSchema(null);
  }

  async function removeSecret() {
    setBusy(true);
    const res = await api<HubspotDto>('/api/groups/hubspot', { body: { webhookSecret: '' } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setRow(res.data);
    setSecret('');
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
        {row.connected && (
          <>
            <br />
            <span className="ui-help">
              {t('hubspot.card.bulkHint')} <Link href="/app/lines/list/unlinked">{t('hubspot.bulk.open')}</Link>
            </span>
          </>
        )}
      </span>
      {canEdit && (
        <span className="gr-inline-form">
          <button type="button" className="btn btn-secondary btn-sm" onClick={edit}>
            {row.connected ? t('integrations.edit') : t('integrations.connect')}
          </button>
          {row.connected && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPropsOpen(true)}>
              {t('hubspot.card.props')}
            </button>
          )}
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
            {scopes.sync && (
              <div>
                <p className="label">{t('hubspot.card.scopesSync')}</p>
                {scopeList(scopes.sync)}
              </div>
            )}
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
              {row.missingSyncScopes.length > 0 && <p className="ui-help">{t('hubspot.card.syncNeedsScope', { scopes: row.missingSyncScopes.join(', ') })}</p>}
            </fieldset>
          )}
          {row.connected && (
            <div className="ui-field">
              <label className="ui-field">
                <span className="label">{t('hubspot.card.webhookSecret')}</span>
                <input
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={row.webhook ? t('integrations.keep') : ''}
                />
              </label>
              <p className="ui-help">{t('hubspot.card.webhookHelp')}</p>
              {webhookUrl && <p className="gr-mono gr-hs-webhook-url">{webhookUrl}</p>}
              {row.webhook && (
                <div>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void removeSecret()}>
                    {t('hubspot.card.webhookRemove')}
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <PropertiesModal open={propsOpen} onClose={() => setPropsOpen(false)} showToast={showToast} />
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
