'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { CrmAppView } from '@/lib/crm-apps';
import { AUTOMATION_DEFAULT_EVENTS, SLACK_EVENTS, type CrmAppKey } from '@/lib/crm-apps-schema';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CopyButton from '@/components/link/CopyButton';

const eventKey = (ev: string) => ev.replace(/\./g, '_');

/**
 * Marketplace de apps del CRM (Ajustes › Integraciones): Slack, Zoom, Stripe,
 * Zapier y Make, cada una con conectar, estado, ajustes, actividad reciente y
 * desconectar. Más la tarjeta de webhooks y API para el resto.
 */
export default function AppsPanel({ initial, canEdit }: { initial: CrmAppView[]; canEdit: boolean }) {
  const t = useTranslations('crm.apps');
  const locale = useLocale();
  const [apps, setApps] = useState(initial);
  const [openKey, setOpenKey] = useState<CrmAppKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: CrmAppKey; message: string } | null>(null);
  const [notice, setNotice] = useState<{ key: CrmAppKey; message: string } | null>(null);
  const [confirm, setConfirm] = useState<CrmAppKey | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [slackEvents, setSlackEvents] = useState<string[]>(
    () => initial.find((a) => a.key === 'slack')?.events ?? ['deal.won', 'form.submitted', 'quote.accepted', 'quote.paid'],
  );

  const field = (name: string) => form[name] ?? '';
  const setField = (name: string, value: string) => setForm((f) => ({ ...f, [name]: value }));

  function replace(view: CrmAppView | undefined) {
    if (!view) return;
    setApps((prev) => prev.map((a) => (a.key === view.key ? view : a)));
  }

  async function errorOf(res: Response | null, key: CrmAppKey) {
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError({ key, message: code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic') });
  }

  async function connect(e: FormEvent, key: CrmAppKey) {
    e.preventDefault();
    setBusy(key);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> =
      key === 'slack'
        ? { webhookUrl: field('slackUrl').trim(), events: slackEvents }
        : key === 'zoom'
          ? { accountId: field('zoomAccount'), clientId: field('zoomClient'), clientSecret: field('zoomSecret') }
          : key === 'stripe'
            ? { secretKey: field('stripeKey'), webhookSecret: field('stripeWhsec') || undefined }
            : { hookUrl: field(`${key}Url`).trim() };
    const res = await fetch(`/api/crm/apps/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (res?.status === 201) {
      replace(((await res.json()) as { app: CrmAppView }).app);
      setForm({});
      setOpenKey(key);
      setNotice({ key, message: t('connectedNotice') });
    } else await errorOf(res, key);
  }

  async function patch(key: CrmAppKey, body: Record<string, unknown>, message: string) {
    setBusy(key);
    setError(null);
    const res = await fetch(`/api/crm/apps/${key}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      replace(((await res.json()) as { app: CrmAppView }).app);
      setNotice({ key, message });
    } else await errorOf(res, key);
  }

  async function action(key: CrmAppKey, name: 'test' | 'sync') {
    setBusy(`${key}:${name}`);
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/crm/apps/${key}/${name}`, { method: 'POST' }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return errorOf(res, key);
    if (name === 'sync') {
      const data = (await res.json()) as { created: number; existing: number };
      setNotice({ key, message: t('stripe.synced', { created: data.created, existing: data.existing }) });
    } else setNotice({ key, message: t('slack.testSent') });
    const list = await fetch('/api/crm/apps').catch(() => null);
    if (list?.ok) setApps(((await list.json()) as { apps: CrmAppView[] }).apps);
  }

  async function disconnect(key: CrmAppKey) {
    setBusy(key);
    const res = await fetch(`/api/crm/apps/${key}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    setConfirm(null);
    if (res?.status === 204) {
      setApps((prev) =>
        prev.map((a) =>
          a.key === key ? { ...a, connected: false, hint: '', events: [], log: [], webhookUrl: null, lastError: null, connectedAt: null } : a,
        ),
      );
      setNotice({ key, message: t('disconnectedNotice') });
    } else await errorOf(res, key);
  }

  const fmt = (d: string | null) => {
    if (!d) return '';
    const date = new Date(d.includes('T') ? d : `${d.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? d : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  };

  function input(name: string, label: string, opts: { type?: string; placeholder?: string; mono?: boolean; required?: boolean } = {}) {
    const id = `crm-app-${name}`;
    return (
      <div className="ui-field">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className={`input${opts.mono ? ' data' : ''}`}
          type={opts.type ?? 'text'}
          value={field(name)}
          onChange={(e) => setField(name, e.target.value)}
          placeholder={opts.placeholder}
          autoComplete="off"
          spellCheck={false}
          required={opts.required ?? true}
        />
      </div>
    );
  }

  function slackEventPicker(onToggle?: (next: string[]) => void) {
    return (
      <fieldset className="crm-app-events">
        <legend className="label">{t('slack.events')}</legend>
        <ul>
          {SLACK_EVENTS.map((ev) => (
            <li key={ev}>
              <label className="ui-check">
                <input
                  type="checkbox"
                  checked={slackEvents.includes(ev)}
                  onChange={() => {
                    const next = slackEvents.includes(ev) ? slackEvents.filter((x) => x !== ev) : [...slackEvents, ev];
                    setSlackEvents(next);
                    onToggle?.(next);
                  }}
                />
                <span>{t(`events.${eventKey(ev)}`)}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );
  }

  function connectForm(key: CrmAppKey): ReactNode {
    const fields =
      key === 'slack' ? (
        <>
          {input('slackUrl', t('slack.url'), { type: 'url', placeholder: 'https://hooks.slack.com/services/…', mono: true })}
          <p className="ui-help">{t('slack.urlHelp')}</p>
          {slackEventPicker()}
        </>
      ) : key === 'zoom' ? (
        <>
          <p className="ui-help">{t('zoom.help')}</p>
          {input('zoomAccount', t('zoom.accountId'), { mono: true })}
          {input('zoomClient', t('zoom.clientId'), { mono: true })}
          {input('zoomSecret', t('zoom.clientSecret'), { type: 'password', mono: true })}
        </>
      ) : key === 'stripe' ? (
        <>
          <p className="ui-help">{t('stripe.help')}</p>
          {input('stripeKey', t('stripe.secretKey'), { type: 'password', placeholder: 'sk_live_… / rk_live_…', mono: true })}
          {input('stripeWhsec', t('stripe.webhookSecret'), { type: 'password', placeholder: 'whsec_…', mono: true, required: false })}
        </>
      ) : (
        <>
          <p className="ui-help">{t(`${key}.help`)}</p>
          {input(`${key}Url`, t(`${key}.url`), {
            type: 'url',
            placeholder: key === 'zapier' ? 'https://hooks.zapier.com/hooks/catch/…' : 'https://hook.eu1.make.com/…',
            mono: true,
          })}
          <p className="ui-help">
            {t('automation.defaultEvents', { events: AUTOMATION_DEFAULT_EVENTS.map((ev) => t(`events.${eventKey(ev)}`)).join(', ') })}
          </p>
        </>
      );
    return (
      <form
        className="crm-app-form"
        onSubmit={(e) => connect(e, key)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpenKey(null);
        }}
      >
        {fields}
        <div className="crm-app-actions">
          <button type="submit" className="btn btn-primary btn-sm" aria-busy={busy === key || undefined} disabled={busy !== null}>
            {t('connect')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenKey(null)}>
            {t('cancel')}
          </button>
        </div>
      </form>
    );
  }

  function connectedBody(app: CrmAppView): ReactNode {
    const key = app.key;
    return (
      <div className="crm-app-connected">
        {app.hint && <p className="data muted crm-app-hint">{app.hint}</p>}
        {key === 'slack' && (
          <>
            {slackEventPicker(canEdit ? (next) => void patch('slack', { events: next }, t('saved')) : undefined)}
            <div className="crm-app-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => action('slack', 'test')}
                disabled={busy !== null || !canEdit}
                aria-busy={busy === 'slack:test' || undefined}
              >
                {t('slack.test')}
              </button>
            </div>
          </>
        )}
        {key === 'zoom' && <p className="ui-help">{t('zoom.connectedHelp')}</p>}
        {key === 'stripe' && (
          <>
            <p className="ui-help">{t('stripe.connectedHelp')}</p>
            {app.webhookUrl && (
              <div className="ui-field">
                <span className="label">{t('stripe.endpoint')}</span>
                <div className="crm-app-copy">
                  <code className="data">{app.webhookUrl}</code>
                  <CopyButton text={app.webhookUrl} className="btn btn-secondary btn-sm" />
                </div>
                <p className="ui-help">{t('stripe.endpointHelp')}</p>
              </div>
            )}
            {canEdit && (
              <form
                className="crm-app-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  void patch('stripe', { webhookSecret: field('stripeWhsec2') }, t('saved')).then(() => setField('stripeWhsec2', ''));
                }}
              >
                {input('stripeWhsec2', t('stripe.webhookSecret'), { type: 'password', placeholder: 'whsec_…', mono: true })}
                <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== null || !field('stripeWhsec2')}>
                  {t('save')}
                </button>
              </form>
            )}
            <div className="crm-app-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => action('stripe', 'sync')}
                disabled={busy !== null || !canEdit}
                aria-busy={busy === 'stripe:sync' || undefined}
              >
                {t('stripe.sync')}
              </button>
            </div>
          </>
        )}
        {(key === 'zapier' || key === 'make') && (
          <p className="ui-help">
            {t('automation.connectedHelp', { count: app.events.length })}{' '}
            <Link href="/app/settings/workspace#webhooks">{t('automation.editEvents')}</Link>
          </p>
        )}
        {app.log.length > 0 && (
          <details className="crm-app-log">
            <summary>{t('activity')}</summary>
            <ul>
              {app.log.map((l, i) => (
                <li key={`${l.at}-${i}`}>
                  <span className={`badge ${l.status === 'ok' ? 'badge-ok' : 'badge-bad'}`}>{l.status === 'ok' ? t('ok') : t('failed')}</span>
                  <span className="data">{l.event}</span>
                  {l.detail && <span className="muted crm-app-log-detail">{l.detail}</span>}
                  <span className="data muted">{fmt(l.at)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {canEdit && (
          <div className="crm-app-actions">
            <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setConfirm(key)} disabled={busy !== null}>
              {t('disconnect')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="crm-apps" data-testid="crm-apps">
      {!canEdit && <p className="ui-help">{t('adminOnly')}</p>}
      <ul className="crm-apps-grid">
        {apps.map((app) => {
          const status = app.connected ? (app.lastError ? 'error' : 'connected') : 'off';
          return (
            <li key={app.key} className="crm-app-card" data-app={app.key} data-testid={`crm-app-${app.key}`}>
              <div className="crm-app-head">
                <span className="crm-app-mark" aria-hidden="true">
                  {t(`${app.key}.name`).slice(0, 1)}
                </span>
                <div className="crm-app-title">
                  <h3>{t(`${app.key}.name`)}</h3>
                  <p className="ui-help">{t(`${app.key}.desc`)}</p>
                </div>
                <span className={`badge ${status === 'connected' ? 'badge-ok' : status === 'error' ? 'badge-bad' : ''}`}>
                  {t(`status.${status}`)}
                </span>
              </div>
              {app.connected && app.connectedAt && (
                <p className="muted crm-app-meta">
                  {t('connectedOn', { date: fmt(app.connectedAt) })}
                  {app.lastUsedAt ? ` · ${t('lastUsed', { date: fmt(app.lastUsedAt) })}` : ''}
                </p>
              )}
              {app.connected && app.lastError && (
                <p className="ui-error" role="status">
                  {t('lastError', { error: app.lastError })}
                </p>
              )}
              {notice?.key === app.key && <p className="ui-help crm-app-notice" role="status">{notice.message}</p>}
              {error?.key === app.key && (
                <p className="ui-error" role="alert">
                  {error.message}
                </p>
              )}
              {app.connected
                ? connectedBody(app)
                : openKey === app.key
                  ? connectForm(app.key)
                  : canEdit && (
                      <div className="crm-app-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenKey(app.key)}>
                          {t('connect')}
                        </button>
                      </div>
                    )}
            </li>
          );
        })}
        <li className="crm-app-card" data-testid="crm-app-webhooks">
          <div className="crm-app-head">
            <span className="crm-app-mark" aria-hidden="true">
              {'{}'}
            </span>
            <div className="crm-app-title">
              <h3>{t('webhooks.name')}</h3>
              <p className="ui-help">{t('webhooks.desc')}</p>
            </div>
          </div>
          <div className="crm-app-actions">
            <Link className="btn btn-secondary btn-sm" href="/app/settings/workspace#webhooks">
              {t('webhooks.open')}
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/docs">
              {t('webhooks.api')}
            </Link>
          </div>
        </li>
      </ul>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm ? t('disconnectTitle', { app: t(`${confirm}.name`) }) : ''}
        body={t('disconnectBody')}
        confirmLabel={t('disconnect')}
        cancelLabel={t('cancel')}
        danger
        busy={busy !== null}
        onConfirm={() => confirm && disconnect(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
