'use client';

import { useEffect, useState } from 'react';
import type { DocsPage } from '@/lib/docs-types';

interface MentionPopoverProps {
  query: string;
  onSelect: (page: DocsPage) => void;
  onClose: () => void;
}

export default function MentionPopover({ query, onSelect, onClose }: MentionPopoverProps) {
  const [pages, setPages] = useState<DocsPage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setPages([]);
      return;
    }
    setLoading(true);
    fetch(`/api/docs/search?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then((data) => setPages(data.rows ?? []))
      .catch(() => setPages([]))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  if (!query.trim()) return null;

  return (
    <div className="docs-mention-popover">
      {loading ? (
        <div className="docs-mention-empty">…</div>
      ) : pages.length === 0 ? (
        <div className="docs-mention-empty">No pages</div>
      ) : (
        pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className="docs-mention-item"
            onClick={() => onSelect(page)}
          >
            <span className="docs-mention-icon">{page.icon ?? '📄'}</span>
            <span className="docs-mention-title">{page.title || 'Untitled'}</span>
          </button>
        ))
      )}
    </div>
  );
}
