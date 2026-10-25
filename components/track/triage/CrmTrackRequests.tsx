'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CustomerRequestDto } from '@/lib/track-customers';
import { RequestRow } from './RequestRow';
import { call } from './api';

/**
 * En la ficha de una empresa o un contacto del CRM: los issues de Track que
 * pidió (pedidos de clientes) y "Enlazar a un issue" con su ID.
 */
export default function CrmTrackRequests({
  companyId,
  contactId,
  locale,
}: {
  companyId?: string;
  contactId?: string;
  locale: string;
}) {
  const t = useTranslations('trackTriage.customers');
  const [rows, setRows] = useState<CustomerRequestDto[] | null>(null);
  const [error, setError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [issue, setIssue] = useState('');
  const [body, setBody] = useState('');
  const [important, setImportant] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const query = companyId ? `companyId=${encodeURIComponent(companyId)}` : `contactId=${encodeURIComponent(contactId ?? '')}`;

  const load = useCallback(async () => {
    setError(false);
    const res = await call<{ rows: CustomerRequestDto[] }>(`/api/track/customers?${query}`);
    if (res.ok) setRows(res.data.rows);
    else setError(true);
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!issue.trim()) return;
    setBusy(true);
    setFormError(null);
    const res = await call<CustomerRequestDto>('/api/track/customers', {
      method: 'POST',
      json: { issue: issue.trim(), companyId, contactId, body, important },
    });
    setBusy(false);
    if (res.ok) {
      setAdding(false);
      setIssue('');
      setBody('');
      setImportant(false);
      void load();
    } else setFormError(res.error === 'issue_not_found' ? t('issueNotFound') : t('error'));
  };

  return (
    <section className="record-block track-crm-requests" data-testid="track-crm-requests">
      <div className="track-x-head">
        <h2 className="track-section-title">
          {t('crmTitle')}
          {rows && rows.length > 0 && <span className="ui-tab-count">{rows.length}</span>}
        </h2>
        {!adding && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)} data-testid="track-crm-request-add">
            <span aria-hidden>+</span> {t('crmAdd')}
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </p>
      )}
      {!rows && !error && <p className="ui-help">{t('loading')}</p>}
      {rows && rows.length === 0 && !adding && <p className="ui-help">{t('crmEmpty')}</p>}
      {rows && rows.length > 0 && (
        <ul className="track-request-list">
          {rows.map((r) => (
            <RequestRow key={r.id} r={r} locale={locale} showIssue onChange={(next) => setRows((prev) => (prev ?? []).flatMap((x) => (x.id === r.id ? (next ? [next] : []) : [x])))} />
          ))}
        </ul>
      )}
      {adding && (
        <form
          className="track-request-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setAdding(false);
            }
          }}
        >
          <label className="ui-field">
            <span className="label">{t('issueLabel')}</span>
            <input className="input data" value={issue} onChange={(e) => setIssue(e.target.value)} placeholder={t('issuePlaceholder')} maxLength={80} autoFocus data-testid="track-crm-request-issue" />
          </label>
          <label className="sr-only" htmlFor={`crm-rq-${companyId ?? contactId}`}>
            {t('quote')}
          </label>
          <textarea
            id={`crm-rq-${companyId ?? contactId}`}
            className="textarea"
            rows={3}
            maxLength={5000}
            placeholder={t('quotePlaceholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <label className="ui-check">
            <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />
            {t('important')}
          </label>
          {formError && (
            <p className="ui-error" role="alert">
              {formError}
            </p>
          )}
          <div className="track-inline-form-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !issue.trim()} data-testid="track-crm-request-save">
              {t('save')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
