'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { TagEntity } from '@/lib/crm-constants';

interface TagBulkControlsProps {
  entity: TagEntity;
  ids: string[];
  tags: Array<{ id: string; name: string }>;
  disabled?: boolean;
  /** Se llama al terminar (la tabla limpia la selección). */
  onDone?: () => void;
}

/** Bulk bar: elegir un tag y agregarlo / quitarlo de los registros seleccionados. */
export default function TagBulkControls({ entity, ids, tags, disabled, onDone }: TagBulkControlsProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [tagId, setTagId] = useState('');
  const [busy, setBusy] = useState(false);

  if (!tags.length) return null;

  async function run(action: 'add' | 'remove') {
    if (!tagId) return;
    setBusy(true);
    await fetch('/api/crm/tags/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tagId, entity, ids, action }),
    }).catch(() => null);
    setBusy(false);
    setTagId('');
    onDone?.();
    router.refresh();
  }

  return (
    <>
      <select
        className="filter-select"
        value={tagId}
        onChange={(e) => setTagId(e.target.value)}
        aria-label={t('tags.bulkPick')}
        disabled={disabled || busy}
      >
        <option value="">{t('tags.bulkPick')}</option>
        {tags.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
      <button type="button" className="bulk-btn" disabled={disabled || busy || !tagId} onClick={() => run('add')}>
        {t('tags.bulkAdd')}
      </button>
      <button type="button" className="bulk-btn" disabled={disabled || busy || !tagId} onClick={() => run('remove')}>
        {t('tags.bulkRemove')}
      </button>
    </>
  );
}
