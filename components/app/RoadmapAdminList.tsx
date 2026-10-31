'use client';

import { useState } from 'react';
import { useMounted } from '@/components/ui/useMounted';
import { useTranslations } from 'next-intl';
import type { RoadmapItemRow } from '@/lib/db';
import { formatDateTime } from '@/lib/utils';
import DataTable from '@/components/ui/DataTable';
import type { AdminItem } from './RoadmapAdminRow';
import RoadmapItemDrawer from './RoadmapItemDrawer';
import ProductTag from './ProductTag';

export type { AdminItem } from './RoadmapAdminRow';

/**
 * Lista del admin: una fila por ítem (título, producto, estado, votos,
 * visibilidad, fecha). La fila abre el mismo panel de edición que el kanban.
 */
export default function RoadmapAdminList({
  initial,
  targets,
  locale,
}: {
  initial: AdminItem[];
  targets: Array<{ id: string; title: string }>;
  locale: string;
}) {
  const mounted = useMounted();
  const t = useTranslations('roadmap');
  const tp = useTranslations('feedbackBoard.product');
  const ts = useTranslations('settings.admin');
  const [items, setItems] = useState(initial);
  const [allTargets, setAllTargets] = useState(targets);
  const [openId, setOpenId] = useState<string | null>(null);

  function onSaved(id: string, next: RoadmapItemRow) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...next } : i)));
  }

  function onMerged(sourceId: string, target: RoadmapItemRow) {
    setAllTargets((prev) => prev.filter((x) => x.id !== sourceId));
    setItems((prev) => {
      const source = prev.find((i) => i.id === sourceId);
      return prev
        .filter((i) => i.id !== sourceId)
        .map((i) =>
          i.id === target.id
            ? { ...i, ...target, signals: [...(source?.signals ?? []).map((s) => ({ ...s, item_id: target.id })), ...i.signals] }
            : i,
        );
    });
    setOpenId(target.id);
  }

  const open = items.find((i) => i.id === openId) ?? null;

  return (
    <>
      <DataTable
        caption={t('admin.title')}
        rows={items}
        rowKey={(i) => i.id}
        compact
        className="st-table-stack st-rm-table"
        columns={[
          {
            key: 'title',
            header: t('admin.titleLabel'),
            cell: (i) => (
              <button type="button" className="st-row-open" onClick={() => setOpenId(i.id)} aria-haspopup="dialog">
                {i.title}
              </button>
            ),
          },
          { key: 'product', header: t('admin.productLabel'), cell: (i) => <ProductTag product={i.product} label={tp(i.product)} /> },
          { key: 'status', header: t('admin.statusLabel'), cell: (i) => t(`admin.status.${i.status}`) },
          { key: 'votes', header: ts('colVotes'), cell: (i) => i.votes, numeric: true, data: true },
          {
            key: 'visibility',
            header: ts('colVisibility'),
            cell: (i) => (
              <span className={`badge ${i.is_public === 1 ? 'badge-outline' : ''}`}>
                {i.is_public === 1 ? t('admin.public') : t('admin.private')}
              </span>
            ),
          },
          { key: 'created', header: ts('colCreated'), cell: (i) => (mounted ? formatDateTime(i.created_at, locale) : ''), data: true },
        ]}
      />

      <RoadmapItemDrawer
        item={open}
        targets={allTargets}
        locale={locale}
        onClose={() => setOpenId(null)}
        onSaved={onSaved}
        onMerged={onMerged}
      />
    </>
  );
}
