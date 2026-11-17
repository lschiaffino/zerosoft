'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { FleetPrefs } from '@/lib/fleet/types';
import type { LinkOptions } from '@/lib/fleet/link';

/**
 * Ajustes del enlace con Inbox y Lines: ver los chats con los agentes como una fila "Agentes" arriba de la lista de
 * chats de cada app, y el aviso por WhatsApp a tu propio chat (Inbox) cuando un agente termina o te espera.
 */
export default function FleetLinkSection({ prefs: initial, options }: { prefs: FleetPrefs; options: LinkOptions }) {
  const t = useTranslations('fleet.link');
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(patch: Partial<FleetPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/fleet/prefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error('save');
      setPrefs(((await res.json()) as { prefs: FleetPrefs }).prefs);
      setSaved(true);
    } catch {
      setPrefs(prefs);
      setError(t('error'));
    }
  }

  const connected = options.whatsapp.filter((a) => a.connected);
  return (
    <section className="ui-section" id="link" aria-labelledby="flt-link-title" data-testid="fleet-link-section">
      <div className="ui-section-body">
        <div className="ui-section-head">
          <h2 className="ui-section-title" id="flt-link-title">
            {t('title')}
          </h2>
          <p className="ui-section-desc">{t('desc')}</p>
        </div>
        <div className="ui-fields">
          <label className="ui-switch">
            <input type="checkbox" checked={prefs.mirrorInbox} onChange={(e) => void save({ mirrorInbox: e.target.checked })} data-testid="fleet-mirror-inbox" />
            <span>{t('mirrorInbox')}</span>
          </label>
          {options.lines && (
            <label className="ui-switch">
              <input type="checkbox" checked={prefs.mirrorLines} onChange={(e) => void save({ mirrorLines: e.target.checked })} data-testid="fleet-mirror-lines" />
              <span>{t('mirrorLines')}</span>
            </label>
          )}
          <div className="ui-field">
            <span className="label" id="flt-notify-l">
              {t('notify')}
            </span>
            {connected.length === 0 ? (
              <p className="ui-help">
                {t('noWhatsapp')} <Link href="/app/inbox/settings">{t('connectInbox')}</Link>
              </p>
            ) : (
              <div className="flt-inline-form">
                <select
                  className="select"
                  aria-labelledby="flt-notify-l"
                  value={prefs.notify}
                  onChange={(e) => void save({ notify: e.target.value as FleetPrefs['notify'], ...(prefs.notifyAccountId ? {} : { notifyAccountId: connected[0].id }) })}
                  data-testid="fleet-notify"
                >
                  {(['off', 'done', 'waiting', 'both'] as const).map((v) => (
                    <option key={v} value={v}>
                      {t(`notifyOptions.${v}`)}
                    </option>
                  ))}
                </select>
                {connected.length > 1 && prefs.notify !== 'off' && (
                  <select className="select" aria-label={t('account')} value={prefs.notifyAccountId} onChange={(e) => void save({ notifyAccountId: e.target.value })}>
                    {connected.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <p className="ui-help">{t('notifyHelp')}</p>
          </div>
        </div>
        <p className="ui-help" aria-live="polite">
          {error ? <span className="ui-error">{error}</span> : saved ? t('saved') : ''}
        </p>
      </div>
    </section>
  );
}
