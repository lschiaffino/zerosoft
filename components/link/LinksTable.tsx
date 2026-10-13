'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import CopyButton from './CopyButton';

export interface TableRow {
  id: string;
  slug: string;
  short: string;
  url: string;
  title: string | null;
  tags: string[];
  clicks: number;
  created: string;
  status: 'active' | 'archived' | 'expired' | 'protected';
}

interface LinksTableProps {
  rows: TableRow[];
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default function LinksTable({ rows }: LinksTableProps) {
  const t = useTranslations('link');
  const router = useRouter();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    await fetch(`/api/links/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/links/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmingId(null);
    router.refresh();
  }

  const statusLabel: Record<TableRow['status'], string> = {
    active: t('table.statusActive'),
    archived: t('table.statusArchived'),
    expired: t('table.statusExpired'),
    protected: t('table.statusProtected'),
  };

  return (
    <div className="table-wrap">
      <table className="table links-table">
        <thead>
          <tr>
            <th>{t('table.link')}</th>
            <th>{t('table.destination')}</th>
            <th>{t('table.tags')}</th>
            <th className="th-num">{t('table.clicks')}</th>
            <th>{t('table.created')}</th>
            <th>{t('table.status')}</th>
            <th aria-label={t('table.actions')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={`links-row${busyId === row.id ? ' row-busy' : ''}`}>
              <td className="td-link">
                <div className="cell-link">
                  <Link href={`/app/links/${row.id}`} className="mono cell-slug" title={row.short}>
                    {row.short.replace(/^https?:\/\//, '')}
                  </Link>
                  <CopyButton text={row.short} className="copy-btn-icon" />
                </div>
                {row.title && <div className="cell-title muted">{truncate(row.title, 32)}</div>}
              </td>
              <td className="td-dest">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cell-url muted"
                  title={row.url}
                >
                  {row.url}
                </a>
              </td>
              <td className="td-tags">
                <div className="cell-tags">
                  {row.tags.map((tag) => (
                    <span key={tag} className="badge">
                      {tag}
                    </span>
                  ))}
                </div>
              </td>
              <td className="mono td-num td-clicks">{row.clicks}</td>
              <td className="mono muted cell-date">{row.created}</td>
              <td className="td-status">
                <span className={`badge status-${row.status}`}>{statusLabel[row.status]}</span>
              </td>
              <td className="td-actions">
                {confirmingId === row.id ? (
                  <div className="cell-actions confirm">
                    <span className="confirm-label">{t('table.confirmDelete')}</span>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => remove(row.id)}
                    >
                      {t('common.yes')}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setConfirmingId(null)}
                    >
                      {t('common.no')}
                    </button>
                  </div>
                ) : (
                  <div className="cell-actions">
                    <Link href={`/app/links/${row.id}#qr`} className="icon-btn" title={t('table.qr')}>
                      ▦
                    </Link>
                    <Link href={`/app/links/${row.id}#edit`} className="icon-btn" title={t('common.edit')}>
                      ✎
                    </Link>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => patch(row.id, { archived: row.status !== 'archived' })}
                      title={row.status === 'archived' ? t('common.unarchive') : t('common.archive')}
                    >
                      {row.status === 'archived' ? '↥' : '↧'}
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      onClick={() => setConfirmingId(row.id)}
                      title={t('common.delete')}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
