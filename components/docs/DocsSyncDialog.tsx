'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Icon from '@/components/app/icons';
import type { DocsBlock, DbSyncProvider } from '@/lib/docs-types';

const PROVIDERS: DbSyncProvider[] = ['github', 'jira', 'salesforce', 'crm'];
const SF_OBJECTS = ['Opportunity', 'Account', 'Contact', 'Lead', 'Case'];
const INTERVALS = [15, 60, 360, 1440];

/**
 * "Base sincronizada" (como las synced databases de Notion): elegir el
 * origen (GitHub, Jira, Salesforce o el CRM de zerosoft), conectarlo y crear
 * una base de solo lectura que se refresca sola. La primera sincronización
 * valida la conexión: si falla, se muestra el error y no se crea nada.
 */
export default function DocsSyncDialog({ pageId, onCreated, onClose }: { pageId: string; onCreated: (block: DocsBlock) => void; onClose: () => void }) {
  const t = useTranslations('docs.sync');
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState<DbSyncProvider>('github');
  const [form, setForm] = useState<Record<string, string>>({ kind: 'issues', state: 'open', object: 'Opportunity', crmObject: 'deals', jql: 'ORDER BY updated DESC' });
  const [interval, setIntervalMin] = useState(15);
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (state === 'saving') return;
    setState('saving');
    setError(null);
    const config: Record<string, string> =
      provider === 'github'
        ? { repo: form.repo ?? '', kind: form.kind, state: form.state }
        : provider === 'jira'
          ? { site: form.site ?? '', jql: form.jql ?? '', email: form.email ?? '' }
          : provider === 'salesforce'
            ? { instanceUrl: form.instanceUrl ?? '', object: form.object }
            : { crmObject: form.crmObject };
    const secret: Record<string, string> = {};
    if (form.token?.trim()) secret.token = form.token.trim();
    if (provider === 'salesforce') {
      if (form.refreshToken?.trim()) secret.refreshToken = form.refreshToken.trim();
      if (form.clientId?.trim()) secret.clientId = form.clientId.trim();
      if (form.clientSecret?.trim()) secret.clientSecret = form.clientSecret.trim();
    }
    try {
      const res = await fetch('/api/docs/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, provider, config, secret, intervalMin: interval }),
      });
      const data = (await res.json().catch(() => ({}))) as { block?: DocsBlock; error?: string };
      if (!res.ok || !data.block) {
        setError(data.error ?? 'failed');
        setState('error');
        return;
      }
      onCreated(data.block);
      dialogRef.current?.close();
    } catch {
      setError('network_error');
      setState('error');
    }
  };

  const field = (key: string, opts: { type?: string; placeholder?: string; help?: string; autoComplete?: string } = {}) => (
    <div className="ui-field">
      <label className="label" htmlFor={`${uid}-${key}`}>
        {t(`fields.${key}`)}
      </label>
      <input
        id={`${uid}-${key}`}
        className="input"
        type={opts.type ?? 'text'}
        value={form[key] ?? ''}
        placeholder={opts.placeholder}
        autoComplete={opts.autoComplete ?? 'off'}
        onChange={(e) => set(key, e.target.value)}
      />
      {opts.help && <p className="ui-help">{opts.help}</p>}
    </div>
  );

  const errorKey = (code: string | null) =>
    code && ['invalid_repo', 'invalid_site', 'invalid_email', 'invalid_instance', 'missing_token', 'auth_failed', 'source_not_found', 'rate_limited', 'limit_reached', 'timeout', 'unsafe_url'].includes(code)
      ? `errors.${code}`
      : 'errors.generic';

  return (
    <dialog
      ref={dialogRef}
      className="ui-modal docs-sync-dialog"
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dialogRef.current?.close();
      }}
      data-testid="docs-sync-dialog"
    >
      <div className="ui-modal-head">
        <h2 className="ui-modal-title" id={`${uid}-title`}>
          {t('title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => dialogRef.current?.close()} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="ui-modal-body">
          <div className="ui-fields">
            <p className="ui-help">{t('intro')}</p>
            <div className="docs-sync-providers" role="radiogroup" aria-label={t('source')}>
              {PROVIDERS.map((p) => (
                <label key={p} className={`docs-sync-provider${provider === p ? ' active' : ''}`}>
                  <input type="radio" name={`${uid}-provider`} value={p} checked={provider === p} onChange={() => setProvider(p)} />
                  <span>{t(`providers.${p}`)}</span>
                </label>
              ))}
            </div>
            {provider === 'github' && (
              <>
                {field('repo', { placeholder: 'acme/web', help: t('help.repo') })}
                <div className="docs-sync-row">
                  <div className="ui-field">
                    <label className="label" htmlFor={`${uid}-kind`}>
                      {t('fields.kind')}
                    </label>
                    <select id={`${uid}-kind`} className="select" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                      <option value="issues">{t('options.issues')}</option>
                      <option value="pulls">{t('options.pulls')}</option>
                    </select>
                  </div>
                  <div className="ui-field">
                    <label className="label" htmlFor={`${uid}-state`}>
                      {t('fields.state')}
                    </label>
                    <select id={`${uid}-state`} className="select" value={form.state} onChange={(e) => set('state', e.target.value)}>
                      <option value="open">{t('options.open')}</option>
                      <option value="all">{t('options.all')}</option>
                    </select>
                  </div>
                </div>
                {field('token', { type: 'password', help: t('help.githubToken') })}
              </>
            )}
            {provider === 'jira' && (
              <>
                {field('site', { placeholder: 'acme.atlassian.net' })}
                {field('email', { type: 'email', placeholder: 'ada@acme.com' })}
                {field('token', { type: 'password', help: t('help.jiraToken') })}
                {field('jql', { help: t('help.jql') })}
              </>
            )}
            {provider === 'salesforce' && (
              <>
                {field('instanceUrl', { placeholder: 'https://acme.my.salesforce.com' })}
                <div className="ui-field">
                  <label className="label" htmlFor={`${uid}-object`}>
                    {t('fields.object')}
                  </label>
                  <select id={`${uid}-object`} className="select" value={form.object} onChange={(e) => set('object', e.target.value)}>
                    {SF_OBJECTS.map((o) => (
                      <option key={o} value={o}>
                        {t(`sfObjects.${o}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {field('refreshToken', { type: 'password', help: t('help.salesforce') })}
                {field('clientId')}
                {field('clientSecret', { type: 'password' })}
                {field('token', { type: 'password', help: t('help.salesforceToken') })}
              </>
            )}
            {provider === 'crm' && (
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-crm`}>
                  {t('fields.crmObject')}
                </label>
                <select id={`${uid}-crm`} className="select" value={form.crmObject} onChange={(e) => set('crmObject', e.target.value)}>
                  <option value="deals">{t('options.deals')}</option>
                  <option value="contacts">{t('options.contacts')}</option>
                  <option value="companies">{t('options.companies')}</option>
                </select>
                <p className="ui-help">{t('help.crm')}</p>
              </div>
            )}
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-interval`}>
                {t('fields.interval')}
              </label>
              <select id={`${uid}-interval`} className="select" value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))}>
                {INTERVALS.map((m) => (
                  <option key={m} value={m}>
                    {t(`intervals.m${m}`)}
                  </option>
                ))}
              </select>
            </div>
            {state === 'error' && (
              <p className="ui-error" role="alert" data-testid="docs-sync-error">
                {t(errorKey(error))}
              </p>
            )}
          </div>
        </div>
        <div className="ui-modal-foot">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => dialogRef.current?.close()}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={state === 'saving'} aria-busy={state === 'saving' || undefined}>
            {state === 'saving' ? t('connecting') : t('create')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
