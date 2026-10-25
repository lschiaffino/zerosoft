'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { ReportSource, ReportViz } from '@/lib/crm-report-builder';
import { parseDbUtc } from '@/lib/utils';

export interface CustomReportItem {
  id: string;
  name: string;
  source: ReportSource;
  viz: ReportViz;
  updatedAt: string;
}

/** Lista de reportes propios: abrir, renombrar en el lugar y borrar. */
export default function CustomReportsList({ reports, locale }: { reports: CustomReportItem[]; locale: string }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [rows, setRows] = useState(reports);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tb = (k: string) => t(`reportBuilder.${k}`);

  async function rename(id: string) {
    const name = draft.trim();
    setEditing(null);
    if (!name || rows.find((r) => r.id === id)?.name === name) return;
    const prev = rows;
    setRows((list) => list.map((r) => (r.id === id ? { ...r, name } : r)));
    const res = await fetch(`/api/crm/custom-reports/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setRows(prev);
      setError(tb('errors.generic'));
    } else router.refresh();
  }

  async function remove(id: string) {
    setDeleting(null);
    const prev = rows;
    setRows((list) => list.filter((r) => r.id !== id));
    const res = await fetch(`/api/crm/custom-reports/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      setRows(prev);
      setError(tb('errors.generic'));
    } else router.refresh();
  }

  const date = (s: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parseDbUtc(s));

  return (
    <div className="rb-list">
      <div className="rb-list-head">
        <p className="muted">{tb('listDesc')}</p>
        <Link href="/app/crm/reports/custom/new" className="btn btn-small btn-solid">
          {tb('newReport')}
        </Link>
      </div>
      {error && (
        <p className="rb-error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="panel rb-empty">
          <p className="rb-empty-title">{tb('emptyTitle')}</p>
          <p className="muted">{tb('emptyDesc')}</p>
          <Link href="/app/crm/reports/custom/new" className="btn btn-small">
            {tb('newReport')}
          </Link>
        </div>
      ) : (
        <div className="panel rb-scroll">
          <table className="table rb-list-table">
            <thead>
              <tr>
                <th>{tb('name')}</th>
                <th>{tb('source')}</th>
                <th>{tb('viz')}</th>
                <th>{tb('updated')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid="custom-report-row">
                  <td>
                    {editing === r.id ? (
                      <input
                        className="input rb-rename-input"
                        autoFocus
                        aria-label={tb('rename')}
                        value={draft}
                        maxLength={200}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void rename(r.id);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        onBlur={() => void rename(r.id)}
                      />
                    ) : (
                      <Link href={`/app/crm/reports/custom/${r.id}`}>{r.name}</Link>
                    )}
                  </td>
                  <td className="muted">{tb(`sources.${r.source}`)}</td>
                  <td className="muted">{tb(`vizs.${r.viz}`)}</td>
                  <td className="muted mono">{date(r.updatedAt)}</td>
                  <td>
                    <div className="rb-list-actions">
                      {deleting === r.id ? (
                        <>
                          <button type="button" className="btn btn-small btn-danger" onClick={() => void remove(r.id)} onKeyDown={(e) => e.key === 'Escape' && setDeleting(null)}>
                            {t('common.delete')}
                          </button>
                          <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(null)} autoFocus onKeyDown={(e) => e.key === 'Escape' && setDeleting(null)}>
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-small btn-ghost"
                            onClick={() => {
                              setDraft(r.name);
                              setEditing(r.id);
                            }}
                          >
                            {tb('rename')}
                          </button>
                          <button type="button" className="btn btn-small btn-ghost" onClick={() => setDeleting(r.id)}>
                            {t('common.delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
