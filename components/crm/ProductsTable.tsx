'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { formatMoney } from '@/lib/crm-money';
import { ProductModal, type ProductFormValue } from './ProductQuickCreate';

interface ProductsTableProps {
  rows: Array<ProductFormValue & { id: string }>;
  locale: string;
  defaultCurrency: string;
}

/** Catálogo: fila clickeable abre el modal de edición; archivar y borrar en la fila. */
export default function ProductsTable({ rows, locale, defaultCurrency }: ProductsTableProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [editing, setEditing] = useState<ProductFormValue | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    await fetch(`/api/crm/products/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusyId(null);
    router.refresh();
  }

  async function remove(id: string) {
    setBusyId(id);
    await fetch(`/api/crm/products/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    setConfirmId(null);
    router.refresh();
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table crm-table prod-table">
          <thead>
            <tr>
              <th>{t('products.table.name')}</th>
              <th className="prod-col-opt">{t('products.table.sku')}</th>
              <th className="num">{t('products.table.price')}</th>
              <th className="prod-col-opt">{t('products.table.recurring')}</th>
              <th className="num prod-col-opt">{t('products.table.tax')}</th>
              <th>{t('products.table.status')}</th>
              <th aria-label={t('common.actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={busyId === p.id ? 'row-busy' : undefined}>
                <td>
                  <button type="button" className="prod-name" onClick={() => setEditing(p)}>
                    {p.name}
                  </button>
                  {p.description && <span className="muted prod-desc">{p.description}</span>}
                </td>
                <td className="mono muted prod-col-opt">{p.sku || '—'}</td>
                <td className="mono num">{formatMoney(p.price, p.currency, locale, true)}</td>
                <td className="muted prod-col-opt">{t(`enums.recurring.${p.recurring}`)}</td>
                <td className="mono num muted prod-col-opt">{p.tax_pct ? `${p.tax_pct}%` : '—'}</td>
                <td>
                  <span className={`crm-dot-status ${p.active ? 'is-ok' : 'is-dim'}`}>
                    {p.active ? t('products.active') : t('products.archived')}
                  </span>
                </td>
                <td className="prod-actions-cell">
                  <div className="prod-actions">
                  {confirmId === p.id ? (
                    <>
                      <button type="button" className="link-btn danger" onClick={() => remove(p.id)}>
                        {t('products.confirmDelete')}
                      </button>
                      <button type="button" className="link-btn" onClick={() => setConfirmId(null)}>
                        {t('common.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="link-btn" onClick={() => patch(p.id, { active: !p.active })}>
                        {p.active ? t('products.archive') : t('products.unarchive')}
                      </button>
                      <button type="button" className="link-btn" onClick={() => setConfirmId(p.id)}>
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
      {editing && (
        <ProductModal product={editing} defaultCurrency={defaultCurrency} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
