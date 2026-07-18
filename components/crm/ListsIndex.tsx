'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ListForm, { type EnumOption } from './ListForm';

export interface ListRow {
  id: string;
  name: string;
  entity: string;
  kind: 'static' | 'dynamic';
  memberCount: number;
  created: string;
}

interface ListsIndexProps {
  rows: ListRow[];
  lifecycles: EnumOption[];
  leadStatuses: EnumOption[];
  sources: EnumOption[];
}

/** Index de listas: form de nueva lista (toggle) + tabla con delete confirmado inline. */
export default function ListsIndex({ rows, lifecycles, leadStatuses, sources }: ListsIndexProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/lists/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmingId(null);
    router.refresh();
  }

  return (
    <>
      <div>
        <button type="button" className="btn btn-solid btn-small" onClick={() => setShowForm((v) => !v)}>
          {t('lists.newCta')}
        </button>
      </div>

      {showForm && (
        <div className="panel">
          <ListForm
            lifecycles={lifecycles}
            leadStatuses={leadStatuses}
            sources={sources}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0 0 0 0 0
          </p>
          <h2>{t('lists.emptyTitle')}</h2>
          <p className="muted">{t('lists.emptySub')}</p>
          <button type="button" className="btn btn-solid btn-small" onClick={() => setShowForm(true)}>
            {t('lists.emptyCta')}
          </button>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <thead>
              <tr>
                <th>{t('lists.nameLabel')}</th>
                <th>{t('lists.kind')}</th>
                <th className="th-num">{t('lists.membersTitle')}</th>
                <th>{t('lists.created')}</th>
                <th aria-label={t('common.actions')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={busyId === row.id ? 'row-busy' : undefined}>
                  <td>
                    <Link href={`/app/crm/lists/${row.id}`} className="cell-name">
                      {row.name}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge kind-${row.kind}`}>{t(`lists.${row.kind}`)}</span>
                  </td>
                  <td className="mono td-num">{row.memberCount}</td>
                  <td className="mono muted cell-date">{row.created}</td>
                  <td>
                    {confirmingId === row.id ? (
                      <div className="cell-actions confirm">
                        <span className="confirm-label">{t('lists.deleteConfirm')}</span>
                        <button type="button" className="icon-btn danger" onClick={() => remove(row.id)}>
                          {t('common.yes')}
                        </button>
                        <button type="button" className="icon-btn" onClick={() => setConfirmingId(null)}>
                          {t('common.no')}
                        </button>
                      </div>
                    ) : (
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="icon-btn danger"
                          title={t('common.delete')}
                          onClick={() => setConfirmingId(row.id)}
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
      )}
    </>
  );
}
