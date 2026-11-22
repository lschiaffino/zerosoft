'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import type { ViewVisibility } from '@/lib/crm-views-shared';

export interface AllViewsRow {
  id: string;
  name: string;
  createdBy: string;
  createdByLabel: string;
  mine: boolean;
  canEdit: boolean;
  visibility: ViewVisibility;
  sharedLabel: string;
  updated: string;
  href: string;
}

type SharedFilter = '' | 'mine' | ViewVisibility;

/** Tabla de "Todas las vistas": búsqueda por nombre, filtro por creador y por con quién se comparte. */
export default function AllViewsTable({
  rows,
  creators,
  backHref,
}: {
  rows: AllViewsRow[];
  creators: Array<{ value: string; label: string }>;
  backHref: string;
}) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [q, setQ] = useState('');
  const [creator, setCreator] = useState('');
  const [shared, setShared] = useState<SharedFilter>('');
  const [confirm, setConfirm] = useState<AllViewsRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!needle || r.name.toLowerCase().includes(needle)) &&
      (!creator || r.createdBy === creator) &&
      (!shared || (shared === 'mine' ? r.mine : r.visibility === shared)),
  );

  async function remove(row: AllViewsRow) {
    setBusy(true);
    const res = await fetch(`/api/crm/views/${row.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    setConfirm(null);
    if (!res?.ok) {
      setNotice(res?.status === 403 ? t('views.errors.forbidden') : t('views.errors.generic'));
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('views.all.emptyTitle')}
        body={t('views.all.emptyBody')}
        action={{ label: t('views.all.backToList'), href: backHref }}
      />
    );
  }

  return (
    <>
      <div className="filter-toolbar all-views-filters">
        <input
          className="input filter-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('views.all.search')}
          aria-label={t('views.all.search')}
          data-testid="all-views-search"
        />
        <select
          className={`filter-select${creator ? ' on' : ''}`}
          value={creator}
          onChange={(e) => setCreator(e.target.value)}
          aria-label={t('views.all.createdBy')}
          data-testid="all-views-creator"
        >
          <option value="">{t('views.all.anyone')}</option>
          {creators.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className={`filter-select${shared ? ' on' : ''}`}
          value={shared}
          onChange={(e) => setShared(e.target.value as SharedFilter)}
          aria-label={t('views.all.sharedWith')}
          data-testid="all-views-shared"
        >
          <option value="">{t('views.all.anySharing')}</option>
          <option value="mine">{t('views.all.createdByMe')}</option>
          <option value="private">{t('views.visibility.private')}</option>
          <option value="team">{t('views.visibility.team')}</option>
          <option value="everyone">{t('views.visibility.everyone')}</option>
        </select>
      </div>

      {shown.length === 0 ? (
        <p className="muted all-views-empty" role="status">
          {t('views.all.noMatch')}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table crm-table crm-cards all-views-table" data-testid="all-views-table">
            <thead>
              <tr>
                <th data-card="main">{t('views.name')}</th>
                <th>{t('views.all.createdBy')}</th>
                <th>{t('views.all.sharedWith')}</th>
                <th className="num cell-date">{t('views.all.updated')}</th>
                <th className="cell-actions-head">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} data-testid="all-views-row">
                  <td data-card="main">
                    <Link href={r.href} className="cell-name">
                      {r.name}
                    </Link>
                  </td>
                  <td data-card="line" data-card-label={t('views.all.createdBy')}>
                    {r.createdByLabel}
                  </td>
                  <td data-card="line" data-card-label={t('views.all.sharedWith')}>
                    {r.sharedLabel}
                  </td>
                  <td className="num muted cell-date">{r.updated}</td>
                  <td className="cell-actions" data-card="state">
                    {r.canEdit && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setConfirm(r)}
                        data-testid="all-views-delete"
                      >
                        {t('views.delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={t('views.deleteTitle', { name: confirm?.name ?? '' })}
        body={confirm && confirm.visibility !== 'private' ? t('views.deleteShared') : t('views.deleteBody')}
        confirmLabel={t('views.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => confirm && remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
