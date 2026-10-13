'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { ChatWidgetRow } from '@/lib/db';

interface WidgetListProps {
  widgets: ChatWidgetRow[];
}

export default function WidgetList({ widgets }: WidgetListProps) {
  const t = useTranslations('chat');
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(w: ChatWidgetRow) {
    if (!window.confirm(t('overview.deleteConfirm', { name: w.name }))) return;
    setDeleting(w.id);
    await fetch(`/api/chat/widgets/${w.id}`, { method: 'DELETE' }).catch(() => null);
    setDeleting(null);
    router.refresh();
  }

  return (
    <ul className="chat-widget-list">
      {widgets.map((w) => (
        <li key={w.id} className="chat-widget-card">
          <Link href={`/app/chat/widgets/${w.id}`} className="chat-widget-card-main">
            <span className="chat-widget-dot" style={{ backgroundColor: w.color }} aria-hidden />
            <span className="chat-widget-name">{w.name}</span>
            <span className="mono muted chat-widget-id">{w.id.slice(0, 8)}</span>
          </Link>
          <div className="chat-widget-card-actions">
            <Link href={`/app/chat/widgets/${w.id}/canned`} className="chat-widget-action mono">
              {t('canned.title')}
            </Link>
            <Link href={`/app/chat/widgets/${w.id}/rules`} className="chat-widget-action mono">
              {t('rules.title')}
            </Link>
            <button
              type="button"
              className="chat-widget-action chat-widget-action-danger mono"
              disabled={deleting === w.id}
              onClick={() => remove(w)}
            >
              {t('common.delete')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
