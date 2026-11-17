'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { HUBSPOT_MAX_PINNED, type HubspotSchemaDto } from '@/lib/groups-hubspot-shared';
import { setHubspotSchema, useHubspotSchema } from './hubspot-client';
import { Modal, api, useErrorText } from './dialog-kit';

/**
 * "Elegir propiedades": qué propiedades de la empresa ve esta persona en los
 * detalles del chat y arriba del panel de HubSpot, igual en Lines y en Inbox
 * (hasta 12, en el orden elegido). Arranca de las del workspace; "Usar las del
 * workspace" vuelve a ellas. Cada cambio se guarda en el momento.
 */
export default function HubspotMyProps({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const t = useTranslations('groups.hubspot');
  const tc = useTranslations('groups.common');
  const errText = useErrorText();
  const { schema, failed, reload } = useHubspotSchema(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(mine: string[] | null) {
    setBusy(true);
    setError('');
    const res = await api<HubspotSchemaDto>('/api/groups/hubspot/properties', { body: { mine } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setHubspotSchema(res.data);
    onSaved?.();
  }

  const current = schema ? (schema.mine ?? schema.pinned) : [];
  const defs = new Map((schema?.props ?? []).map((p) => [p.name, p]));
  const chosen = current.map((n) => defs.get(n)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const move = (i: number, by: number) => {
    const next = [...current];
    const [it] = next.splice(i, 1);
    next.splice(i + by, 0, it);
    void save(next);
  };

  return (
    <Modal
      open={open}
      title={t('mine.title')}
      onClose={onClose}
      busy={busy}
      foot={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {tc('close')}
        </button>
      }
    >
      {failed ? (
        <p className="ui-help" role="alert">
          {t('card.propsError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
            {tc('retry')}
          </button>
        </p>
      ) : !schema ? (
        <p className="ui-help" role="status">
          {tc('loading')}
        </p>
      ) : (
        <div className="ui-fields gr-hs-mine" data-testid="hubspot-my-props">
          <p className="ui-help">{t('mine.help', { n: HUBSPOT_MAX_PINNED })}</p>
          <p className="ui-help" role="status" data-testid="hubspot-my-props-source">
            {schema.mine ? t('mine.custom') : t('mine.workspace')}
          </p>
          <ul className="gr-hs-pins" aria-label={t('mine.list')}>
            {chosen.map((p, i) => (
              <li key={p.name}>
                <span>{p.label}</span>
                <span className="gr-hs-pin-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy || i === 0} aria-label={t('mine.up', { label: p.label })} title={t('mine.up', { label: p.label })} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy || i === chosen.length - 1}
                    aria-label={t('mine.down', { label: p.label })}
                    title={t('mine.down', { label: p.label })}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    aria-label={t('screen.unpin', { label: p.label })}
                    onClick={() => void save(current.filter((n) => n !== p.name))}
                  >
                    {t('card.unpin')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {chosen.length === 0 && <p className="ui-help">{t('mine.none')}</p>}
          {current.length < HUBSPOT_MAX_PINNED && (
            <select
              className="select"
              value=""
              disabled={busy}
              aria-label={t('card.pinAdd')}
              onChange={(e) => {
                if (e.target.value) void save([...current, e.target.value]);
              }}
            >
              <option value="">{t('card.pinAdd')}</option>
              {schema.groups.map((g) => (
                <optgroup key={g.name} label={g.label}>
                  {schema.props
                    .filter((p) => p.group === g.name && !current.includes(p.name))
                    .map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          )}
          {schema.mine && (
            <div>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void save(null)} data-testid="hubspot-my-props-reset">
                {t('mine.reset')}
              </button>
            </div>
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
