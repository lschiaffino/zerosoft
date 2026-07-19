'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

interface NextTaskBannerProps {
  task: {
    id: string;
    subject: string;
    due_at: string | null;
  } | null;
  locale: string;
}

/**
 * Banner "próxima tarea" para las páginas de detalle: muestra la tarea
 * abierta más próxima del registro con botón de completar inline.
 */
export default function NextTaskBanner({ task, locale }: NextTaskBannerProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!task) return null;

  const due = task.due_at
    ? new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${task.due_at.slice(0, 10)}T00:00:00Z`))
    : null;

  const overdue = task.due_at
    ? new Date(`${task.due_at.slice(0, 10)}T00:00:00Z`).getTime() < Date.now() - 86_400_000
    : false;

  async function complete() {
    setBusy(true);
    await fetch(`/api/crm/activities/${task!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true }),
    }).catch(() => null);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className={`next-task-banner${overdue ? ' overdue' : ''}${busy ? ' row-busy' : ''}`}>
      <span className="next-task-label mono">{t('common.nextTask')}</span>
      <span className="next-task-subject">{task.subject || '—'}</span>
      {due && (
        <span className="mono muted">
          {t('tasks.dueLabel')} {due}
        </span>
      )}
      <button type="button" className="bulk-btn" disabled={busy} onClick={complete}>
        {t('tasks.complete')}
      </button>
    </div>
  );
}
