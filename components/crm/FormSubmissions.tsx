'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';

interface Row {
  id: string;
  createdAt: string;
  contactId: string | null;
  contactLabel: string | null;
  created: boolean;
  data: Record<string, unknown>;
  utm: Record<string, string>;
  pageUrl: string;
}

interface Props {
  formId: string;
  fields: Array<{ id: string; label: string }>;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
}

function show(v: unknown, yes: string, no: string): string {
  if (typeof v === 'boolean') return v ? yes : no;
  if (v === null || v === undefined || v === '') return '';
  return String(v);
}

/** Envíos de un form: tabla con los primeros campos, fila expandible con todo y export CSV. */
export default function FormSubmissions({ formId, fields, rows, total, page, pageSize }: Props) {
  const t = useTranslations('crm');
  const [open, setOpen] = useState<string | null>(null);
  const cols = fields.slice(0, 3);
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="forms-subs">
      <div className="forms-subs-bar">
        <span className="ui-help">{t('forms.submissionsCount', { count: total })}</span>
        <a className="btn btn-secondary btn-sm" href={`/api/crm/forms/${formId}/submissions?format=csv`} data-testid="form-export-csv">
          {t('forms.exportCsv')}
        </a>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('forms.noSubmissions')} body={t('forms.noSubmissionsSub')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('forms.table.date')}</th>
                <th scope="col">{t('forms.table.contact')}</th>
                {cols.map((c) => (
                  <th scope="col" key={c.id}>
                    {c.label}
                  </th>
                ))}
                <th scope="col">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr data-testid="form-submission-row">
                    <td className="data">{r.createdAt}</td>
                    <td>
                      {r.contactId ? (
                        <Link href={`/app/crm/contacts/${r.contactId}`}>{r.contactLabel ?? t('forms.contact')}</Link>
                      ) : null}
                      {r.created && <span className="badge badge-ok forms-new">{t('forms.newContact')}</span>}
                    </td>
                    {cols.map((c) => (
                      <td key={c.id}>{show(r.data[c.id], t('common.yes'), t('common.no'))}</td>
                    ))}
                    <td className="crm-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setOpen(open === r.id ? null : r.id)}
                        aria-expanded={open === r.id}
                      >
                        {open === r.id ? t('common.close') : t('forms.view')}
                      </button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="forms-sub-detail">
                      <td colSpan={cols.length + 3}>
                        <dl className="forms-dl">
                          {fields.map((f) => (
                            <Fragment key={f.id}>
                              <dt>{f.label}</dt>
                              <dd>{show(r.data[f.id], t('common.yes'), t('common.no'))}</dd>
                            </Fragment>
                          ))}
                          {'__consent' in r.data && (
                            <>
                              <dt>{t('forms.consent')}</dt>
                              <dd>{show(r.data.__consent, t('common.yes'), t('common.no'))}</dd>
                            </>
                          )}
                          {Object.entries(r.utm).map(([k, v]) => (
                            <Fragment key={k}>
                              <dt className="data">{k}</dt>
                              <dd>{v}</dd>
                            </Fragment>
                          ))}
                          {r.pageUrl && (
                            <>
                              <dt>{t('forms.page')}</dt>
                              <dd className="data">{r.pageUrl}</dd>
                            </>
                          )}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="crm-pager" aria-label={t('quotes.pagination')}>
          {page > 1 ? (
            <Link href={{ pathname: `/app/crm/forms/${formId}`, query: { tab: 'submissions', page: String(page - 1) } }} className="btn btn-secondary btn-sm">
              {t('common.pagePrev')}
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">{t('common.pagePrev')}</span>
          )}
          <span className="data">{t('common.pageOf', { page, pages })}</span>
          {page < pages ? (
            <Link href={{ pathname: `/app/crm/forms/${formId}`, query: { tab: 'submissions', page: String(page + 1) } }} className="btn btn-secondary btn-sm">
              {t('common.pageNext')}
            </Link>
          ) : (
            <span className="btn btn-secondary btn-sm" aria-disabled="true">{t('common.pageNext')}</span>
          )}
        </nav>
      )}
    </div>
  );
}
