'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { TrashEntity } from '@/lib/crm-trash';

export interface TrashTableRow {
  id: string;
  entity: TrashEntity;
  label: string;
  owner: string;
  deletedBy: string;
  deletedAt: string;
  daysLeft: number;
}

interface TrashTableProps {
  rows: TrashTableRow[];
  /** Borrar para siempre / vaciar: solo admins. */
  canPurge: boolean;
}

const RECORD_PATH: Record<TrashEntity, string> = {
  contact: '/app/crm/contacts',
  company: '/app/crm/companies',
  deal: '/app/crm/deals',
  activity: '/app/crm/tasks',
};

/** Tabla de la papelera: restaurar, borrar para siempre y vaciar. */
export default function TrashTable({ rows, canPurge }: TrashTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href?: string } | null>(null);

  async function restore(row: TrashTableRow) {
    setBusyId(row.id);
    setNotice(null);
    const res = await fetch(`/api/crm/trash/${row.id}/restore`, { method: 'POST' }).catch(() => null);
    setBusyId(null);
    const data = (await res?.json().catch(() => null)) as { error?: string; recordId?: string } | null;
    if (!res?.ok) {
      setNotice({ text: data?.error === 'trash_conflict' ? t('errors.trash_conflict') : t('errors.generic') });
      return;
    }
    setNotice({ text: t('trash.restored'), href: data?.recordId ? `${RECORD_PATH[row.entity]}/${data.recordId}` : undefined });
    router.refresh();
  }

  async function purge(body: { ids: string[] } | { all: true }) {
    setBusyId('ids' in body ? body.ids[0] : '*');
    setNotice(null);
    const res = await fetch('/api/crm/trash', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusyId(null);
    setConfirmId(null);
    setConfirmAll(false);
    if (!res?.ok) {
      setNotice({ text: res?.status === 403 ? t('errors.forbidden') : t('errors.generic') });
      return;
    }
    router.refresh();
  }

  return (
    <>
      {(canPurge || notice) && (
        <div className="trash-bar">
          {notice ? (
            <p className="muted" role="status">
              {notice.text}
              {notice.href && (
                <>
                  {' '}
                  <Link href={notice.href}>{t('trash.open')}</Link>
                </>
              )}
            </p>
          ) : (
            <span />
          )}
          {canPurge &&
            (confirmAll ? (
              <span className="trash-confirm">
                <span className="muted">{t('trash.emptyBinConfirm', { count: rows.length })}</span>
                <button type="button" className="btn btn-danger btn-sm" disabled={busyId !== null} onClick={() => purge({ all: true })}>
                  {t('common.yes')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(false)}>
                  {t('common.no')}
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmAll(true)}>
                {t('trash.emptyBin')}
              </button>
            ))}
        </div>
      )}

      <div className="table-wrap">
        <table className="table crm-table">
          <thead>
            <tr>
              <th>{t('trash.col.name')}</th>
              <th>{t('trash.col.type')}</th>
              <th>{t('trash.col.owner')}</th>
              <th>{t('trash.col.deletedBy')}</th>
              <th className="num cell-date">{t('trash.col.deletedAt')}</th>
              <th className="num">{t('trash.col.left')}</th>
              <th className="cell-actions-head">
                <span className="sr-only">{t('contacts.table.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={busyId === row.id ? 'row-busy' : undefined}>
                <td className="cell-name">{row.label || t('trash.untitled')}</td>
                <td className="muted">{t(`trash.entity.${row.entity}`)}</td>
                <td className="muted cell-sub">{row.owner || '—'}</td>
                <td className="muted cell-sub">{row.deletedBy || '—'}</td>
                <td className="num muted cell-date">{row.deletedAt}</td>
                <td className="num muted">{t('trash.daysLeft', { count: row.daysLeft })}</td>
                <td className="cell-actions trash-actions">
                  {confirmId === row.id ? (
                    <>
                      <span className="muted">{t('trash.purgeConfirm')}</span>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busyId !== null}
                        onClick={() => purge({ ids: [row.id] })}
                      >
                        {t('common.yes')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>
                        {t('common.no')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyId !== null}
                        onClick={() => restore(row)}
                      >
                        {t('trash.restore')}
                      </button>
                      {canPurge && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(row.id)}>
                          {t('trash.purge')}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
