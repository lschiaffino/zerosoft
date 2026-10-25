'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { relDate } from '@/lib/utils';
import type { CustomerRequestDto, CustomerSummary } from '@/lib/track-customers';
import { RequestRow } from './RequestRow';
import { call } from './api';

type SortKey = 'requests' | 'revenue' | 'open' | 'last';

function money(amount: number | null, currency: string | null, locale: string): string {
  if (amount === null) return '–';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
}

function queryFor(c: CustomerSummary): string {
  if (c.kind === 'company' && c.id) return `companyId=${encodeURIComponent(c.id)}`;
  if (c.kind === 'contact' && c.id) return `contactId=${encodeURIComponent(c.id)}`;
  if (c.domain) return `domain=${encodeURIComponent(c.domain)}`;
  return `name=${encodeURIComponent(c.name)}`;
}

function CustomerRequests({ c, locale }: { c: CustomerSummary; locale: string }) {
  const t = useTranslations('trackTriage.customers');
  const [rows, setRows] = useState<CustomerRequestDto[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    const res = await call<{ rows: CustomerRequestDto[] }>(`/api/track/customers?${queryFor(c)}`);
    if (res.ok) setRows(res.data.rows);
    else setError(true);
  }, [c]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error)
    return (
      <p className="ui-error" role="alert">
        {t('loadError')}{' '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
          {t('retry')}
        </button>
      </p>
    );
  if (!rows) return <p className="ui-help">{t('loading')}</p>;
  return (
    <ul className="track-request-list">
      {rows.map((r) => (
        <RequestRow key={r.id} r={r} locale={locale} showIssue onChange={(next) => setRows((prev) => (prev ?? []).flatMap((x) => (x.id === r.id ? (next ? [next] : []) : [x])))} />
      ))}
    </ul>
  );
}

/** Lista de clientes con pedidos: cantidad, importantes, issues abiertos e ingresos del CRM. */
export default function CustomersPage({ locale }: { locale: string }) {
  const t = useTranslations('trackTriage.customers');
  const [rows, setRows] = useState<CustomerSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('requests');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    const res = await call<{ rows: CustomerSummary[] }>('/api/track/customers');
    if (res.ok) setRows(res.data.rows);
    else setError(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (rows ?? []).filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.domain ?? '').includes(needle));
    const by: Record<SortKey, (a: CustomerSummary, b: CustomerSummary) => number> = {
      requests: (a, b) => b.requests - a.requests,
      revenue: (a, b) => (b.revenue ?? -1) - (a.revenue ?? -1),
      open: (a, b) => b.openIssues - a.openIssues,
      last: (a, b) => (a.lastRequestAt < b.lastRequestAt ? 1 : -1),
    };
    return [...list].sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name));
  }, [rows, q, sort]);

  return (
    <>
      <PageHeader title={t('pageTitle')} description={t('pageSubtitle')} />
      {error ? (
        <div className="ui-error" role="alert">
          {t('loadError')}{' '}
          <button type="button" className="btn btn-sm" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      ) : !rows ? (
        <p className="ui-help" aria-busy="true">
          {t('loading')}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title={t('pageEmpty')} body={t('pageEmptyBody')} action={{ label: t('goToIssues'), href: '/app/track/issues' }} />
      ) : (
        <>
          <div className="track-x-toolbar">
            <label className="sr-only" htmlFor="track-customers-q">
              {t('search')}
            </label>
            <input id="track-customers-q" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} data-testid="track-customers-search" />
            <label className="sr-only" htmlFor="track-customers-sort">
              {t('sortBy')}
            </label>
            <select id="track-customers-sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="requests">{t('colRequests')}</option>
              <option value="revenue">{t('colRevenue')}</option>
              <option value="open">{t('colOpen')}</option>
              <option value="last">{t('colLast')}</option>
            </select>
          </div>
          {shown.length === 0 ? (
            <p className="ui-help">{t('noMatch')}</p>
          ) : (
            <ul className="track-customers" data-testid="track-customers">
              {shown.map((c) => {
                const expanded = open === c.key;
                return (
                  <li key={c.key} className="track-customer" data-testid="track-customer">
                    <button type="button" className="track-customer-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.key)}>
                      <span className="track-customer-name">
                        {c.name}
                        {c.domain && c.domain !== c.name && <span className="track-request-meta"> {c.domain}</span>}
                      </span>
                      <span className="track-customer-stat">
                        <span className="track-x-muted">{t('colRequests')}</span> {c.requests}
                      </span>
                      <span className="track-customer-stat hide-sm">
                        <span className="track-x-muted">{t('colImportant')}</span> {c.important}
                      </span>
                      <span className="track-customer-stat">
                        <span className="track-x-muted">{t('colOpen')}</span> {c.openIssues}
                      </span>
                      <span className="track-customer-stat hide-sm">
                        <span className="track-x-muted">{t('colRevenue')}</span> {money(c.revenue, c.currency, locale)}
                      </span>
                      <span className="track-customer-stat hide-sm track-x-muted">{relDate(c.lastRequestAt, locale)}</span>
                    </button>
                    {expanded && (
                      <div className="track-customer-detail">
                        {c.kind !== 'other' && c.id && (
                          <Link href={c.kind === 'company' ? `/app/crm/companies/${c.id}` : `/app/crm/contacts/${c.id}`} className="btn btn-ghost btn-sm">
                            {t('inCrm')}
                          </Link>
                        )}
                        <CustomerRequests c={c} locale={locale} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </>
  );
}
