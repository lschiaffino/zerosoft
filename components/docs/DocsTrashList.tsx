'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DocsPage } from '@/lib/docs-types';

interface DocsTrashListProps {
  pages: DocsPage[];
  labels: {
    restore: string;
    deleteForever: string;
    confirmDelete: string;
  };
}

export default function DocsTrashList({ pages, labels }: DocsTrashListProps) {
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
    <ul className="docs-list">
      {pages.map((page) => (
        <li key={page.id} className="docs-trash-row">
          <span className="docs-list-icon">{page.icon ?? '📄'}</span>
          <span className="docs-list-title">{page.title || 'Untitled'}</span>
          <span className="docs-list-date mono">{page.updated_at.slice(0, 10)}</span>
          <span className="docs-trash-actions">
            <button
              type="button"
              className="btn btn-small"
              disabled={pendingId === page.id}
              onClick={() => restore(page.id)}
            >
              {labels.restore}
            </button>
            <button
              type="button"
              className="btn btn-small docs-trash-delete"
              disabled={pendingId === page.id}
              onClick={() => deleteForever(page.id)}
            >
              {labels.deleteForever}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
