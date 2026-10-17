'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { RoadmapItemRow } from '@/lib/db';
import { RoadmapAdminRow, type AdminItem } from './RoadmapAdminRow';

/**
 * Panel de edición de un ítem del roadmap (kanban y lista). Es un <dialog>
 * nativo: foco atrapado, Esc cierra y el foco vuelve a lo que lo abrió.
 * `item` null lo cierra.
 */
export default function RoadmapItemDrawer({
  item,
  targets,
  locale,
  onClose,
  onSaved,
  onMerged,
}: {
  item: AdminItem | null;
  targets: Array<{ id: string; title: string }>;
  locale: string;
  onClose: () => void;
  onSaved: (id: string, next: RoadmapItemRow) => void;
  onMerged: (sourceId: string, target: RoadmapItemRow) => void;
}) {
  const t = useTranslations('roadmap');
  const ref = useRef<HTMLDialogElement>(null);
  const openId = item?.id ?? null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (openId && !d.open) d.showModal();
    if (!openId && d.open) d.close();
  }, [openId]);

  return (
    <dialog ref={ref} className="ui-drawer st-kb-drawer" aria-labelledby="st-kb-drawer-title" onClose={onClose}>
      {item && (
        <>
          <div className="ui-drawer-head">
            <h2 className="ui-drawer-title" id="st-kb-drawer-title">
              {t('admin.edit')}
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()}>
              {t('admin.close')}
            </button>
          </div>
          <div className="ui-drawer-body">
            <RoadmapAdminRow
              key={item.id}
              item={item}
              targets={targets.filter((x) => x.id !== item.id)}
              locale={locale}
              t={t}
              onSaved={(next) => onSaved(item.id, next)}
              onMerged={(target) => onMerged(item.id, target)}
            />
          </div>
        </>
      )}
    </dialog>
  );
}
