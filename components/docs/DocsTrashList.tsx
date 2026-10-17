'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDate } from '@/lib/utils';
import type { DocsPageSummary } from '@/lib/docs-types';

interface DocsTrashListProps {
  pages: DocsPageSummary[];
  /** Borrar para siempre es solo para admins del workspace. */
  canDelete?: boolean;
  labels: {
    restore: string;
    deleteForever: string;
    confirmDelete: string;
  };
}

export default function DocsTrashList({ pages, canDelete = true, labels }: DocsTrashListProps) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const restore = async (pageId: string) => {
    setPendingId(pageId);
    try {
      const res = await fetch(`/api/docs/pages/${pageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });
      if (res.ok) router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  const deleteForever = async (pageId: string) => {
    if (!confirm(labels.confirmDelete)) return;
    setPendingId(pageId);
    try {
      const res = await fetch(`/api/docs/pages/${pageId}`, { method: 'DELETE' });
      if (res.ok) router.refresh();
    } finally {
      setPendingId(null);
    }
  };

  return (
    <ul className="docs-trash-list">
      {pages.map((page) => (
        <li key={page.id} className="docs-trash-row">
          <span className="docs-trash-title">
            {page.icon && <span aria-hidden="true">{page.icon}</span>}
            {page.title || t('untitled')}
          </span>
          <span className="docs-trash-date num">{formatDate(page.updated_at, locale)}</span>
          <span className="docs-trash-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pendingId === page.id}
              aria-busy={pendingId === page.id || undefined}
              onClick={() => restore(page.id)}
            >
              {labels.restore}
            </button>
            {canDelete && (
              <button
                type="button"
                className="btn btn-ghost btn-danger btn-sm"
                disabled={pendingId === page.id}
                onClick={() => deleteForever(page.id)}
              >
                {labels.deleteForever}
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
