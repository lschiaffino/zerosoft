'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import CrmIcon, { type CrmIconName } from './CrmIcon';
import { formatMoney } from '@/lib/crm-money';
import type { RowExpansion as Expansion, RowExpandKind } from '@/lib/crm-row-expand';

const KIND_PATH: Record<RowExpandKind, string> = { contact: 'contacts', company: 'companies', deal: 'deals' };
const ACTIVITY_ICON: Record<string, CrmIconName> = { note: 'note', email: 'mail', call: 'phone', task: 'task', meeting: 'calendar', whatsapp: 'message' };

/**
 * Filas que se despliegan en un índice: cuáles están abiertas y lo que ya se
 * trajo de cada una (se pide una vez; volver a abrirla no lo pide de nuevo).
 */
export function useRowExpansion(kind: RowExpandKind) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Record<string, Expansion | 'error' | undefined>>({});
  const loading = useRef(new Set<string>());

  const load = useCallback(
    async (id: string) => {
      if (loading.current.has(id)) return;
      loading.current.add(id);
      setData((prev) => ({ ...prev, [id]: undefined }));
      const res = await fetch(`/api/crm/row-expand?type=${kind}&id=${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as Expansion | null) : null;
      loading.current.delete(id);
      setData((prev) => ({ ...prev, [id]: body ?? 'error' }));
    },
    [kind],
  );

  const toggle = useCallback(
    (id: string) => {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!open.has(id) && (data[id] === undefined || data[id] === 'error')) void load(id);
    },
    [open, data, load],
  );

  return { open, data, toggle, retry: load };
}

/** Id del panel desplegado de una fila (aria-controls del botón). */
export const expansionId = (id: string) => `row-exp-${id}`;

/**
 * Lo que muestra una fila desplegada, como la vista previa de fila de
 * HubSpot: asociados (con su total) y la última actividad. Esc pliega la
 * fila y devuelve el foco a su botón.
 */
export function RowExpansionRow({
  kind,
  id,
  name,
  colSpan,
  data,
  onRetry,
  onClose,
}: {
  kind: RowExpandKind;
  id: string;
  name: string;
  colSpan: number;
  data: Expansion | 'error' | undefined;
  onRetry: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('crm.rowExpand');
  const locale = useLocale();
  const href = `/app/crm/${KIND_PATH[kind]}/${id}`;

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
    document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(expansionId(id))}"]`)?.focus();
  }

  return (
    <tr className="row-expansion" onKeyDown={onKeyDown}>
      <td colSpan={colSpan} className="row-expansion-cell">
        <div className="row-exp" id={expansionId(id)} role="region" aria-label={t('region', { name })} aria-busy={data === undefined} data-testid="row-expansion">
          {data === undefined ? (
            <p className="row-exp-state muted" data-testid="row-expansion-loading">
              {t('loading')}
            </p>
          ) : data === 'error' ? (
            <p className="row-exp-state" role="alert">
              {t('error')}{' '}
              <button type="button" className="link-btn" onClick={onRetry} data-testid="row-expansion-retry">
                {t('retry')}
              </button>
            </p>
          ) : (
            <div className="row-exp-grid">
              {data.contacts && (
                <section className="row-exp-sec" data-testid="row-exp-contacts" aria-labelledby={`${expansionId(id)}-contacts`}>
                  <h3 className="row-exp-title" id={`${expansionId(id)}-contacts`}>
                    {t('contacts')} <span className="row-exp-count">{data.contacts.total}</span>
                  </h3>
                  {data.contacts.rows.length === 0 ? (
                    <p className="row-exp-empty">{t('noContacts')}</p>
                  ) : (
                    <ul className="row-exp-list">
                      {data.contacts.rows.map((c) => (
                        <li key={c.id} className="row-exp-item">
                          <Link href={`/app/crm/contacts/${c.id}`} className="row-exp-link">
                            {c.name || t('unnamed')}
                          </Link>
                          {(c.jobTitle || c.email) && <span className="row-exp-meta">{c.jobTitle || c.email}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <More total={data.contacts.total} shown={data.contacts.rows.length} href={href} label={t('allContacts', { count: data.contacts.total })} />
                </section>
              )}
              {data.deals && (
                <section className="row-exp-sec" data-testid="row-exp-deals" aria-labelledby={`${expansionId(id)}-deals`}>
                  <h3 className="row-exp-title" id={`${expansionId(id)}-deals`}>
                    {kind === 'company' ? t('openDeals') : t('deals')} <span className="row-exp-count">{data.deals.total}</span>
                  </h3>
                  {data.deals.rows.length === 0 ? (
                    <p className="row-exp-empty">{kind === 'company' ? t('noOpenDeals') : t('noDeals')}</p>
                  ) : (
                    <ul className="row-exp-list">
                      {data.deals.rows.map((d) => (
                        <li key={d.id} className="row-exp-item">
                          <Link href={`/app/crm/deals/${d.id}`} className="row-exp-link">
                            {d.name}
                          </Link>
                          <span className="row-exp-meta">
                            {[
                              formatMoney(d.amount, d.currency || 'USD', locale),
                              d.status === 'open' ? d.stage : t(`status.${d.status}`),
                              d.closeDate ? t('closes', { date: day(d.closeDate, locale) }) : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <More total={data.deals.total} shown={data.deals.rows.length} href={href} label={t('allDeals', { count: data.deals.total })} />
                </section>
              )}
              {data.companies && (
                <section className="row-exp-sec" data-testid="row-exp-companies" aria-labelledby={`${expansionId(id)}-companies`}>
                  <h3 className="row-exp-title" id={`${expansionId(id)}-companies`}>
                    {t('companies')} <span className="row-exp-count">{data.companies.total}</span>
                  </h3>
                  {data.companies.rows.length === 0 ? (
                    <p className="row-exp-empty">{t('noCompanies')}</p>
                  ) : (
                    <ul className="row-exp-list">
                      {data.companies.rows.map((c) => (
                        <li key={c.id} className="row-exp-item">
                          <Link href={`/app/crm/companies/${c.id}`} className="row-exp-link">
                            {c.name}
                          </Link>
                          <span className="row-exp-meta">{[c.primary ? t('primary') : '', c.domain].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <More total={data.companies.total} shown={data.companies.rows.length} href={href} label={t('allCompanies', { count: data.companies.total })} />
                </section>
              )}
              <section className="row-exp-sec" data-testid="row-exp-activity" aria-labelledby={`${expansionId(id)}-activity`}>
                <h3 className="row-exp-title" id={`${expansionId(id)}-activity`}>
                  {t('lastActivity')}
                </h3>
                {data.lastActivity ? (
                  <p className="row-exp-activity">
                    <span className="row-exp-activity-icon" aria-hidden="true">
                      <CrmIcon name={ACTIVITY_ICON[data.lastActivity.type] ?? 'note'} size={14} />
                    </span>
                    <span className="row-exp-activity-main">
                      <span className="row-exp-activity-type">
                        {t.has(`types.${data.lastActivity.type}`) ? t(`types.${data.lastActivity.type}`) : data.lastActivity.type}
                        {' · '}
                        <time dateTime={data.lastActivity.at}>{when(data.lastActivity.at, locale)}</time>
                      </span>
                      {data.lastActivity.text && <span className="row-exp-activity-text">{data.lastActivity.text}</span>}
                    </span>
                  </p>
                ) : (
                  <p className="row-exp-empty">{t('noActivity')}</p>
                )}
                <Link href={href} className="row-exp-more">
                  {t('openRecord')}
                </Link>
              </section>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function More({ total, shown, href, label }: { total: number; shown: number; href: string; label: string }) {
  if (total <= shown) return null;
  return (
    <Link href={href} className="row-exp-more">
      {label}
    </Link>
  );
}

function day(value: string, locale: string): string {
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(d);
}

function when(value: string, locale: string): string {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}

/** Botón de la primera columna que despliega la fila. */
export function ExpandToggle({ id, name, expanded, onToggle }: { id: string; name: string; expanded: boolean; onToggle: () => void }) {
  const t = useTranslations('crm.rowExpand');
  const label = expanded ? t('collapse', { name }) : t('expand', { name });
  return (
    <button
      type="button"
      className="row-expand-btn"
      aria-expanded={expanded}
      aria-controls={expanded ? expansionId(id) : undefined}
      aria-label={label}
      title={label}
      onClick={onToggle}
      data-testid="row-expand"
    >
      <CrmIcon name={expanded ? 'chevronDown' : 'chevronRight'} size={14} />
    </button>
  );
}
