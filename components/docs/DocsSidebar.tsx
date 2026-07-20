'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { buildPageTree, flattenPageTree, type DocsPage } from '@/lib/docs-types';

interface DocsSidebarProps {
  pages: DocsPage[];
  currentId?: string;
  createAction: (parentId?: string | null) => void;
  moveAction: (pageId: string, parentId: string | null) => void;
  labels: {
    newPage: string;
    newSubpage: string;
    empty: string;
  };
}

export default function DocsSidebar({
  pages,
  currentId,
  createAction,
  moveAction,
  labels,
}: DocsSidebarProps) {
  const t = useTranslations('docs');
  const pathname = usePathname();
  const tree = useMemo(() => buildPageTree(pages), [pages]);
  const flat = useMemo(() => flattenPageTree(tree), [tree]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string | null) => {
      e.preventDefault();
      const pageId = e.dataTransfer.getData('text/plain');
      if (!pageId || pageId === targetId) return;
      startTransition(() => moveAction(pageId, targetId));
      setDragId(null);
    },
    [moveAction],
  );

  return (
    <div className="docs-sidebar">
      <div className="docs-sidebar-head">
        <span className="docs-sidebar-title">Docs</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => startTransition(() => createAction(null))}
          title={labels.newPage}
          disabled={isPending}
        >
          ＋
        </button>
      </div>

      {flat.length === 0 ? (
        <div className="docs-sidebar-empty">
          <p>{labels.empty}</p>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => startTransition(() => createAction(null))}
            disabled={isPending}
          >
            {labels.newPage}
          </button>
        </div>
      ) : (
        <nav className="docs-tree">
          {flat.map((page) => {
            const active = page.id === currentId;
            const href = `/app/docs/${page.id}`;
            return (
              <a
                key={page.id}
                href={href}
                className={`docs-tree-link${active ? ' active' : ''}`}
                style={{ paddingLeft: `${12 + page.depth * 16}px` }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', page.id);
                  setDragId(page.id);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, page.id)}
              >
                <span className="docs-tree-icon">{page.icon ?? '📄'}</span>
                <span className="docs-tree-title">{page.title || t('untitled')}</span>
                <button
                  type="button"
                  className="docs-tree-add"
                  onClick={(e) => {
                    e.preventDefault();
                    startTransition(() => createAction(page.id));
                  }}
                  disabled={isPending}
                  title={labels.newSubpage}
                >
                  ›
                </button>
              </a>
            );
          })}
        </nav>
      )}

      {dragId && (
        <div
          className="docs-tree-drop-root"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, null)}
        >
          {t('sidebar.dropTopLevel')}
        </div>
      )}
    </div>
  );
}
