'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ChatWidgetRow } from '@/lib/db';

interface WidgetListProps {
  widgets: ChatWidgetRow[];
}

export default function WidgetList({ widgets }: WidgetListProps) {
  const t = useTranslations('chat');
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm(t('common.delete'))) return;
    setDeleting(id);
    await fetch(`/api/chat/widgets/${id}`, { method: 'DELETE' });
    window.location.reload();
  }

  if (widgets.length === 0) {
    return (
      <div className="empty-inline">
        <p className="empty-zeros mono" aria-hidden>0 0 0</p>
        <p className="muted">{t('overview.noWidgets')}</p>
        <Link href="/app/chat/widgets/new" className="btn btn-solid btn-small">
          {t('overview.newWidget')}
        </Link>
      </div>
    );
  }

  return (
    <ul className="chat-widget-list">
      {widgets.map((w) => (
        <li key={w.id} className="chat-widget-card panel">
          <div className="chat-widget-card-main">
            <span className="chat-widget-dot" style={{ backgroundColor: w.color }} aria-hidden />
            <Link href={`/app/chat/widgets/${w.id}`} className="chat-widget-name">
              {w.name}
            </Link>
            <span className="mono muted chat-widget-id">{w.id.slice(0, 8)}</span>
          </div>
          <div className="chat-widget-card-actions">
            <Link href={`/app/chat/widgets/${w.id}`} className="btn btn-small">
              {t('common.edit') || 'Edit'}
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={deleting === w.id}
              onClick={() => remove(w.id)}
            >
              {t('common.delete')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
