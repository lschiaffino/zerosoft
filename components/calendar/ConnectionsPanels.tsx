'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import FormSection from '@/components/ui/FormSection';
import { Link } from '@/i18n/navigation';
import CalCopyButton from './CalCopyButton';

interface ExternalCalendar {
  id: string;
  name: string;
  primary: boolean;
  canWrite: boolean;
}

interface ProviderState {
  connected: boolean;
  email?: string;
  calendars?: ExternalCalendar[] | null;
  needsReconnect?: boolean;
}

interface CalendarsState {
  google: ProviderState;
  outlook: ProviderState;
  icloud: ProviderState;
  settings: {
    google?: { check?: string[] };
    outlook?: { check?: string[] };
    icloud?: { check?: string[] };
    write?: { provider: Provider; calendarId: string };
  };
}

type Provider = 'google' | 'outlook' | 'icloud';

/** OAuth: navegación completa al consentimiento. iCloud se conecta con un formulario. */
const START: Record<Exclude<Provider, 'icloud'>, string> = {
  google: '/api/integrations/google-calendar/start',
  outlook: '/api/calendar/outlook/start',
};
const DISCONNECT: Record<Provider, { url: string; method: string }> = {
  google: { url: '/api/integrations/google-calendar/disconnect', method: 'POST' },
  outlook: { url: '/api/calendar/outlook/disconnect', method: 'POST' },
  icloud: { url: '/api/calendar/icloud', method: 'DELETE' },
};
const PROVIDER_SHORT: Record<Provider, string> = { google: 'Google', outlook: 'Outlook', icloud: 'iCloud' };

/** Id con el que se guarda "el principal" de cada proveedor. */
function primaryId(provider: Provider, cal: ExternalCalendar): string {
  return provider === 'google' && cal.primary ? 'primary' : provider === 'outlook' && cal.primary ? '' : cal.id;
}

/**
 * Calendarios de la persona logueada (como "Calendar connections" de
 * Calendly): conectar Google y Outlook, qué calendarios bloquean horarios y
 * en cuál se agregan las reservas nuevas.
 */
export function CalendarConnectionsPanel({
  notice,
  googleConfigured,
  outlookConfigured,
  googleRedirectUri,
  outlookRedirectUri,
}: {
  notice: { provider: Provider; result: string } | null;
  googleConfigured: boolean;
  outlookConfigured: boolean;
  googleRedirectUri: string;
  outlookRedirectUri: string;
}) {
  const t = useTranslations('calendar');
  const id = useId();
  const [data, setData] = useState<CalendarsState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [check, setCheck] = useState<Record<Provider, string[]>>({ google: [], outlook: [], icloud: [] });
  const [write, setWrite] = useState('');
  const [busy, setBusy] = useState<Provider | null>(null);
  const [icloudOpen, setICloudOpen] = useState(false);
  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [icloudError, setICloudError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    const res = await fetch('/api/calendar/calendars').catch(() => null);
    if (!res?.ok) {
      setLoadError(true);
      return;
    }
    const next = (await res.json()) as CalendarsState;
    setData(next);
    setCheck({
      google: next.settings.google?.check?.length ? next.settings.google.check : ['primary'],
      outlook: next.settings.outlook?.check?.length ? next.settings.outlook.check : [''],
      // iCloud sin elegir: el primer calendario.
      icloud: next.settings.icloud?.check?.length ? next.settings.icloud.check : next.icloud.calendars?.[0] ? [next.icloud.calendars[0].id] : [],
    });
    setWrite(next.settings.write ? `${next.settings.write.provider}:${next.settings.write.calendarId}` : '');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(provider: Provider) {
    setBusy(provider);
    await fetch(DISCONNECT[provider].url, { method: DISCONNECT[provider].method }).catch(() => null);
    setBusy(null);
    await load();
  }

  async function connectICloud() {
    if (!appleId.trim() || !appPassword.trim()) return;
    setBusy('icloud');
    setICloudError(null);
    const res = await fetch('/api/calendar/icloud', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appleId: appleId.trim(), password: appPassword.trim() }),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setAppPassword('');
      setICloudOpen(false);
      await load();
      return;
    }
    const body = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
    setICloudError(code === 'icloud_auth_failed' ? t('connections.icloudAuthFailed') : code === 'invalid_input' ? t('connections.icloudInvalid') : t('connections.noticeError', { provider: 'iCloud' }));
  }

  async function save(): Promise<string | undefined> {
    const [provider, ...rest] = write.split(':');
    const res = await fetch('/api/calendar/calendars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(data?.google.connected ? { google: { check: check.google.filter(Boolean) } } : {}),
        ...(data?.outlook.connected ? { outlook: { check: check.outlook } } : {}),
        ...(data?.icloud.connected ? { icloud: { check: check.icloud.filter(Boolean) } } : {}),
        write: write ? { provider, calendarId: rest.join(':') } : null,
      }),
    }).catch(() => null);
    return res?.ok ? undefined : t('errors.generic');
  }

  const noticeText = notice
    ? notice.result === 'connected'
      ? t('connections.noticeConnected', { provider: notice.provider === 'google' ? 'Google Calendar' : 'Outlook' })
      : notice.result === 'scopes'
        ? t(notice.provider === 'google' ? 'google.noticeScopes' : 'connections.outlookScopes')
        : t('connections.noticeError', { provider: notice.provider === 'google' ? 'Google Calendar' : 'Outlook' })
    : null;

  const providers: Array<{ key: Provider; name: string; configured: boolean; redirect: string }> = [
    { key: 'google', name: 'Google Calendar', configured: googleConfigured, redirect: googleRedirectUri },
    { key: 'outlook', name: 'Outlook / Microsoft 365', configured: outlookConfigured, redirect: outlookRedirectUri },
    { key: 'icloud', name: 'iCloud', configured: true, redirect: '' },
  ];
  const anyConnected = !!data && (data.google.connected || data.outlook.connected || data.icloud.connected);
  const writable = data
    ? providers.flatMap((p) =>
        (data[p.key].connected ? (data[p.key].calendars ?? []) : [])
          .filter((c) => c.canWrite)
          .map((c) => ({ value: `${p.key}:${primaryId(p.key, c)}`, label: `${c.name}${c.primary ? ` (${t('connections.primary')})` : ''} · ${PROVIDER_SHORT[p.key]}` })),
      )
    : [];

  return (
    <FormSection title={t('connections.calendarsTitle')} description={t('connections.calendarsLead')} onSubmit={anyConnected ? save : undefined}>
      {noticeText && (
        <p className={notice?.result === 'connected' ? 'cal-callout cal-callout-ok' : 'cal-callout'} role="status">
          {noticeText}
        </p>
      )}
      {loadError ? (
        <p className="ui-error" role="alert">
          {t('connections.loadError')}{' '}
          <button type="button" className="cal-inline-link" onClick={() => void load()}>
            {t('connections.retry')}
          </button>
        </p>
      ) : !data ? (
        <p className="cal-muted" role="status" aria-busy="true">
          {t('common.loading')}
        </p>
      ) : (
        <ul className="cal-conn-list">
          {providers.map((p) => {
            const st = data[p.key];
            return (
              <li key={p.key} className="cal-conn">
                <div className="cal-conn-head">
                  <div>
                    <strong>{p.name}</strong>
                    <p className="cal-muted">{st.connected ? t('google.connectedAs', { email: st.email ?? '' }) : t('google.notConnected')}</p>
                  </div>
                  {st.connected ? (
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void disconnect(p.key)} aria-busy={busy === p.key || undefined}>
                      {t('google.disconnect')}
                    </button>
                  ) : p.key === 'icloud' ? (
                    !icloudOpen && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => setICloudOpen(true)}>
                        {t('connections.connect')}
                      </button>
                    )
                  ) : p.configured ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        // Navegación completa: el endpoint redirige al consentimiento del proveedor.
                        window.location.href = START[p.key as Exclude<Provider, 'icloud'>];
                      }}
                    >
                      {t('connections.connect')}
                    </button>
                  ) : null}
                </div>
                {p.key === 'icloud' && !st.connected && icloudOpen && (
                  <div
                    className="cal-icloud-form"
                    onKeyDown={(e) => {
                      // Enter conecta iCloud (no guarda el formulario de afuera); Esc cierra.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void connectICloud();
                      } else if (e.key === 'Escape') {
                        setICloudOpen(false);
                      }
                    }}
                  >
                    <p className="ui-help">{t('connections.icloudHelp')}</p>
                    <div className="ui-fields-2">
                      <div className="ui-field">
                        <label className="label" htmlFor={`${id}-apple`}>
                          {t('connections.appleId')}
                        </label>
                        <input id={`${id}-apple`} className="input" type="email" autoComplete="username" value={appleId} onChange={(e) => setAppleId(e.target.value)} autoFocus />
                      </div>
                      <div className="ui-field">
                        <label className="label" htmlFor={`${id}-apppw`}>
                          {t('connections.appPassword')}
                        </label>
                        <input
                          id={`${id}-apppw`}
                          className="input data"
                          type="password"
                          autoComplete="off"
                          placeholder="xxxx-xxxx-xxxx-xxxx"
                          value={appPassword}
                          onChange={(e) => setAppPassword(e.target.value)}
                        />
                      </div>
                    </div>
                    {icloudError && (
                      <p className="ui-error" role="alert">
                        {icloudError}
                      </p>
                    )}
                    <div className="cal-row-gap">
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setICloudOpen(false)}>
                        {t('common.cancel')}
                      </button>
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => void connectICloud()} aria-busy={busy === 'icloud' || undefined} disabled={!appleId.trim() || !appPassword.trim()}>
                        {t('connections.connectICloud')}
                      </button>
                    </div>
                  </div>
                )}
                {!st.connected && !p.configured && <p className="ui-help cal-wrap">{t(`connections.notConfigured_${p.key}`, { uri: p.redirect })}</p>}
                {st.connected && st.needsReconnect && p.key !== 'icloud' && (
                  <p className="ui-help">
                    {t('connections.reconnect')}{' '}
                    <a className="cal-inline-link" href={START[p.key as Exclude<Provider, 'icloud'>]}>
                      {t('connections.reconnectCta')}
                    </a>
                  </p>
                )}
                {st.connected && st.calendars === null && !st.needsReconnect && <p className="ui-help">{t('connections.listError')}</p>}
                {st.connected && st.calendars && st.calendars.length > 0 && (
                  <fieldset className="cal-conn-cals">
                    <legend className="label">{t('connections.checkConflicts')}</legend>
                    {st.calendars.map((c) => {
                      const value = primaryId(p.key, c);
                      const checked = check[p.key].includes(value);
                      return (
                        <label key={c.id} className="ui-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setCheck((prev) => ({
                                ...prev,
                                [p.key]: e.target.checked ? [...prev[p.key], value] : prev[p.key].filter((x) => x !== value),
                              }))
                            }
                          />
                          <span>
                            {c.name}
                            {c.primary && <span className="cal-muted"> · {t('connections.primary')}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {anyConnected && (
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-write`}>
            {t('connections.addTo')}
          </label>
          <select id={`${id}-write`} className="select" value={write} onChange={(e) => setWrite(e.target.value)}>
            <option value="">{t('connections.addToDefault')}</option>
            {writable.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </select>
          <p className="ui-help">{t('connections.addToHelp')}</p>
        </div>
      )}
    </FormSection>
  );
}

/** Zoom del workspace: una reunión por reserva (app Server-to-Server, la misma del CRM). */
export function ZoomPanel({ initialConnected, canEdit }: { initialConnected: boolean; canEdit: boolean }) {
  const t = useTranslations('calendar');
  const id = useId();
  const [connected, setConnected] = useState(initialConnected);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(fd: FormData): Promise<string | undefined> {
    const res = await fetch('/api/calendar/zoom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId: String(fd.get('accountId') ?? ''),
        clientId: String(fd.get('clientId') ?? ''),
        clientSecret: String(fd.get('clientSecret') ?? ''),
      }),
    }).catch(() => null);
    if (res?.ok) {
      setConnected(true);
      return;
    }
    return t('connections.zoomError');
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/zoom', { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) setConnected(false);
    else setError(t('errors.generic'));
  }

  if (connected) {
    return (
      <FormSection
        title="Zoom"
        description={t('connections.zoomLead')}
        footer={
          <>
            <p className="ui-section-note" role="status" data-tone={error ? 'error' : 'ok'}>
              {error ?? t('connections.zoomConnected')}
            </p>
            {canEdit && (
              <button type="button" className="btn btn-danger" onClick={() => void disconnect()} aria-busy={busy || undefined}>
                {t('google.disconnect')}
              </button>
            )}
          </>
        }
      />
    );
  }
  return (
    <FormSection
      title="Zoom"
      description={t('connections.zoomLead')}
      onSubmit={canEdit ? connect : undefined}
      submitLabel={t('connections.connect')}
      footer={canEdit ? undefined : <p className="ui-section-note">{t('payments.adminOnly')}</p>}
    >
      <p className="ui-help">{t('connections.zoomHelp')}</p>
      <div className="ui-fields-2">
        {(['accountId', 'clientId'] as const).map((k) => (
          <div key={k} className="ui-field">
            <label className="label" htmlFor={`${id}-${k}`}>
              {t(`connections.zoom_${k}`)}
            </label>
            <input id={`${id}-${k}`} name={k} className="input data" autoComplete="off" required disabled={!canEdit} />
          </div>
        ))}
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-secret`}>
            {t('connections.zoom_clientSecret')}
          </label>
          <input id={`${id}-secret`} name="clientSecret" type="password" className="input data" autoComplete="off" required disabled={!canEdit} />
        </div>
      </div>
    </FormSection>
  );
}

interface SmsView {
  configured: boolean;
  accountSid: string;
  fromNumber: string;
  tokenHint: string | null;
}

/** Twilio del workspace para los pasos de workflow por SMS. */
export function SmsPanel({ initial, canEdit }: { initial: SmsView; canEdit: boolean }) {
  const t = useTranslations('calendar');
  const id = useId();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save(fd: FormData): Promise<string | undefined> {
    const res = await fetch('/api/calendar/sms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountSid: String(fd.get('accountSid') ?? ''),
        authToken: String(fd.get('authToken') ?? '') || undefined,
        fromNumber: String(fd.get('fromNumber') ?? ''),
      }),
    }).catch(() => null);
    if (res?.ok) {
      setView((await res.json()) as SmsView);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    return code === 'sms_auth_failed' ? t('connections.smsAuthFailed') : t('connections.smsInvalid');
  }

  async function remove() {
    setBusy(true);
    const res = await fetch('/api/calendar/sms', { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (res?.ok) setView((await res.json()) as SmsView);
  }

  return (
    <FormSection
      title={t('connections.smsTitle')}
      description={t('connections.smsLead')}
      onSubmit={canEdit ? save : undefined}
      note={view.configured ? t('connections.smsConnected', { from: view.fromNumber }) : undefined}
      footer={canEdit ? undefined : <p className="ui-section-note">{t('payments.adminOnly')}</p>}
    >
      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-sid`}>
            Account SID
          </label>
          <input id={`${id}-sid`} name="accountSid" className="input data" defaultValue={view.accountSid} placeholder="AC…" autoComplete="off" required disabled={!canEdit} />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-token`}>
            Auth Token
          </label>
          <input
            id={`${id}-token`}
            name="authToken"
            type="password"
            className="input data"
            placeholder={view.tokenHint ?? ''}
            autoComplete="off"
            required={!view.configured}
            disabled={!canEdit}
          />
        </div>
        <div className="ui-field">
          <label className="label" htmlFor={`${id}-from`}>
            {t('connections.smsFrom')}
          </label>
          <input id={`${id}-from`} name="fromNumber" className="input data" defaultValue={view.fromNumber} placeholder="+15551234567" autoComplete="off" required disabled={!canEdit} />
          <p className="ui-help">{t('connections.smsFromHelp')}</p>
        </div>
      </div>
      {view.configured && canEdit && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove()} aria-busy={busy || undefined}>
          {t('connections.smsRemove')}
        </button>
      )}
    </FormSection>
  );
}

/**
 * Asistentes de IA (servidor MCP de Cal) y automatizaciones (Zapier, Make):
 * el link del servidor y cómo llevar los eventos de reserva a otras apps.
 */
export function AutomationPanel({ mcpUrl }: { mcpUrl: string }) {
  const t = useTranslations('calendar');
  return (
    <FormSection title={t('connections.mcpTitle')} description={t('connections.mcpLead')}>
      <div className="cal-share-url">
        <span className="data">{mcpUrl}</span>
        <CalCopyButton text={mcpUrl} />
      </div>
      <pre className="cal-pre data">{`{
  "mcpServers": {
    "zerosoft-cal": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer zs_…" }
    }
  }
}`}</pre>
      <p className="ui-help">
        {t('connections.mcpTools')}{' '}
        <Link href="/app/settings/api" className="cal-inline-link">
          {t('connections.apiKeys')}
        </Link>
      </p>
      <p className="ui-help">
        {t('connections.zapier')}{' '}
        <Link href="/app/settings/api" className="cal-inline-link">
          {t('connections.webhooks')}
        </Link>
      </p>
    </FormSection>
  );
}
