'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface TaskDonePinProps {
  taskId: string;
  done: boolean;
  pinned: boolean;
}

export default function TaskDonePin({ taskId, done, pinned }: TaskDonePinProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function patch(patch: { done?: boolean; pinned?: boolean }) {
    setBusy(true);
    await fetch(`/api/crm/activities/${taskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={`task-done-pin${busy ? ' row-busy' : ''}`}>
      <button
        type="button"
        className={`btn btn-small${done ? ' btn-ghost' : ' btn-solid'}`}
        onClick={() => patch({ done: !done })}
        disabled={busy}
      >
        {done ? t('tasks.reopen') : t('tasks.complete')}
      </button>
      <button
        type="button"
        className={`btn btn-small${pinned ? ' btn-ghost' : ' btn-solid'}`}
        onClick={() => patch({ pinned: !pinned })}
        disabled={busy}
      >
        {pinned ? t('common.unpin') : t('common.pin')}
      </button>
    </div>
  );
}
