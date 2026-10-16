'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useKeyShortcut } from '@/components/app/QuickModal';
import { Link, useRouter } from '@/i18n/navigation';
import ListForm, { type EnumOption } from './ListForm';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import CrmIcon from './CrmIcon';

export interface ListRow {
  id: string;
  name: string;
  entity: string;
  kind: 'static' | 'dynamic';
  memberCount: number;
  created: string;
}

interface ListsIndexProps {
  /** Título de la página: el header (título + CTA) lo arma la vista. */
  title: string;
  rows: ListRow[];
  lifecycles: EnumOption[];
  leadStatuses: EnumOption[];
  sources: EnumOption[];
}

/** Index de listas: form de nueva lista (toggle) + tabla con delete confirmado inline. */
export default function ListsIndex({ rows, lifecycles, leadStatuses, sources, title }: ListsIndexProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useKeyShortcut('c', () => setShowForm(true), !showForm);

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/lists/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmingId(null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={title}
        description={t('record.listsDesc')}
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            aria-expanded={showForm}
            onClick={() => setShowForm((v) => !v)}
          >
            {t('record.createList')}
            <kbd className="kbd" aria-hidden>
              C
            </kbd>
          </button>
        }
      />

      {showForm && (
        <div className="record-inline-form">
          <ListForm
            lifecycles={lifecycles}
            leadStatuses={leadStatuses}
            sources={sources}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {rows.length === 0 ? (
        showForm ? null : (
          <EmptyState
            title={t('record.empty.listsTitle')}
            body={t('record.empty.listsBody')}
            action={
              <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
                {t('record.createList')}
              </button>
            }
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table crm-table">
            <thead>
              <tr>
                <th>{t('lists.nameLabel')}</th>
                <th>{t('lists.kind')}</th>
                <th className="num">{t('lists.membersTitle')}</th>
                <th className="num cell-date">{t('lists.created')}</th>
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
                  <td className="num">{row.memberCount}</td>
                  <td className="num muted cell-date">{row.created}</td>
                  <td>
                    {confirmingId === row.id ? (
                      <div className="cell-actions confirm">
                        <span className="confirm-label">{t('lists.deleteConfirm')}</span>
                        <button type="button" className="btn btn-primary btn-danger btn-sm" onClick={() => remove(row.id)}>
                          {t('common.delete')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingId(null)}>
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <div className="cell-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm row-delete"
                          title={t('common.delete')}
                          aria-label={`${t('common.delete')} ${row.name}`}
                          onClick={() => setConfirmingId(row.id)}
                        >
                          <CrmIcon name="x" />
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
