'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import { buildPageTree, type DocsPage } from '@/lib/docs-types';

interface DocsSidebarProps {
  pages: DocsPage[];
  currentId?: string;
  /** Cantidad de páginas en la papelera (link al pie). */
  trashCount?: number;
  /** En mobile el árbol arranca abierto (landing) o plegado (editor). */
  mobileOpenByDefault?: boolean;
  createAction: (parentId?: string | null) => void;
  moveAction: (pageId: string, parentId: string | null) => void | Promise<void>;
  /** Reordenar entre hermanas (soltar arriba/abajo de una fila). */
  reorderAction?: (pageId: string, targetId: string, placement: 'before' | 'after') => void | Promise<void>;
  /** "Move up / Move down" (menú de la fila y Alt+↑/↓). */
  stepAction?: (pageId: string, dir: -1 | 1) => void | Promise<void>;
  labels: {
    newPage: string;
    newSubpage: string;
    empty: string;
  };
}

type TreeNode = DocsPage & { children?: TreeNode[] };
type DropZone = 'before' | 'inside' | 'after';

/** Zona de drop según la altura del puntero: borde superior/inferior = reordenar, centro = anidar. */
function zoneFor(e: React.DragEvent<HTMLElement>): DropZone {
  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  if (y < rect.height * 0.28) return 'before';
  if (y > rect.height * 0.72) return 'after';
  return 'inside';
}

const COLLAPSED_KEY = 'docs.sidebar.collapsed';

export default function DocsSidebar({
  pages,
  currentId,
  trashCount = 0,
  mobileOpenByDefault = false,
  createAction,
  moveAction,
  reorderAction,
  stepAction,
  labels,
}: DocsSidebarProps) {
  const t = useTranslations('docs');
  const router = useRouter();
  const [dropZone, setDropZone] = useState<DropZone>('inside');
  const [menuId, setMenuId] = useState<string | null>(null);
  const tree = useMemo(() => buildPageTree(pages) as TreeNode[], [pages]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(mobileOpenByDefault);

  // Ramas plegadas: preferencia local del navegador.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* storage bloqueado */
    }
  }, []);

  // La página abierta siempre visible: despliega sus ancestros.
  const ancestorsOfCurrent = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const out = new Set<string>();
    let cur = currentId ? byId.get(currentId) : undefined;
    while (cur?.parent_id && !out.has(cur.parent_id)) {
      out.add(cur.parent_id);
      cur = byId.get(cur.parent_id);
    }
    return out;
  }, [pages, currentId]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage bloqueado */
      }
      return next;
    });
  };

  const create = useCallback(
    (parentId: string | null) => startTransition(() => createAction(parentId)),
    [createAction],
  );

  // "C" crea una página nueva desde cualquier vista de Docs (fuera de campos editables).
  useKeyShortcut('c', () => create(null), !isPending);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetId: string | null, zone: DropZone = 'inside') => {
      e.preventDefault();
      const pageId = e.dataTransfer.getData('text/plain');
      setDragId(null);
      setDropId(null);
      if (!pageId || pageId === targetId) return;
      startTransition(async () => {
        if (targetId && zone !== 'inside' && reorderAction) await reorderAction(pageId, targetId, zone);
        else await moveAction(pageId, targetId);
        router.refresh();
      });
    },
    [moveAction, reorderAction, router],
  );

  const step = useCallback(
    (pageId: string, dir: -1 | 1) => {
      if (!stepAction) return;
      setMenuId(null);
      startTransition(async () => {
        await stepAction(pageId, dir);
        router.refresh();
      });
    },
    [stepAction, router],
  );

  const renderNode = (node: TreeNode, depth: number) => {
    const active = node.id === currentId;
    const hasChildren = !!node.children?.length;
    const open = hasChildren && (!collapsed.has(node.id) || ancestorsOfCurrent.has(node.id));
    return (
      <li key={node.id}>
        <div
          className={`docs-tree-row${active ? ' active' : ''}${dropId === node.id ? ` drop drop-${dropZone}` : ''}${dragId === node.id ? ' dragging' : ''}`}
          data-testid="docs-tree-row"
          style={{ paddingLeft: `${4 + depth * 14}px` }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', node.id);
            setDragId(node.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropId(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragId && dragId !== node.id) {
              setDropId(node.id);
              setDropZone(reorderAction ? zoneFor(e) : 'inside');
            }
          }}
          onDragLeave={() => setDropId((d) => (d === node.id ? null : d))}
          onDrop={(e) => handleDrop(e, node.id, reorderAction ? zoneFor(e) : 'inside')}
        >
          <button
            type="button"
            className={`docs-tree-chevron${open ? ' open' : ''}`}
            onClick={() => hasChildren && toggle(node.id)}
            aria-label={open ? t('sidebar.collapse') : t('sidebar.expand')}
            aria-expanded={hasChildren ? open : undefined}
            tabIndex={hasChildren ? 0 : -1}
            style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
              <path d="M2 1l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <Link
            href={`/app/docs/${node.id}`}
            className="docs-tree-link"
            aria-current={active ? 'page' : undefined}
            onClick={() => setMobileOpen(false)}
            onKeyDown={(e) => {
              if (stepAction && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault();
                step(node.id, e.key === 'ArrowUp' ? -1 : 1);
              }
            }}
            aria-keyshortcuts={stepAction ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
          >
            <span className="docs-tree-icon">{node.icon ?? '📄'}</span>
            <span className="docs-tree-title">{node.title || t('untitled')}</span>
          </Link>
          {stepAction && (
            <span className="docs-tree-more-wrap">
              <button
                type="button"
                className="docs-tree-more"
                onClick={() => setMenuId((m) => (m === node.id ? null : node.id))}
                aria-haspopup="menu"
                aria-expanded={menuId === node.id}
                aria-label={t('sidebar.pageActions')}
                title={t('sidebar.pageActions')}
              >
                ⋯
              </button>
              {menuId === node.id && (
                <span
                  className="docs-tree-menu"
                  role="menu"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setMenuId(null);
                  }}
                >
                  <button type="button" role="menuitem" onClick={() => step(node.id, -1)} disabled={isPending}>
                    ↑ {t('sidebar.moveUp')}
                  </button>
                  <button type="button" role="menuitem" onClick={() => step(node.id, 1)} disabled={isPending}>
                    ↓ {t('sidebar.moveDown')}
                  </button>
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            className="docs-tree-add"
            onClick={() => create(node.id)}
            disabled={isPending}
            title={labels.newSubpage}
            aria-label={labels.newSubpage}
          >
            +
          </button>
        </div>
        {open && <ul>{node.children!.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <aside className={`docs-sidebar${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="docs-sidebar-head">
        <button
          type="button"
          className="docs-sidebar-toggle"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
        >
          <span className="docs-sidebar-title">{t('sidebar.pages')}</span>
          <span className="docs-sidebar-count mono">{pages.length}</span>
          <svg className="docs-sidebar-caret" width="8" height="8" viewBox="0 0 8 8" aria-hidden>
            <path d="M1 2l3 4 3-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <span className="docs-sidebar-title docs-sidebar-title-desk">{t('sidebar.pages')}</span>
        <button
          type="button"
          className="docs-sidebar-new"
          onClick={() => create(null)}
          title={`${labels.newPage} (C)`}
          aria-label={labels.newPage}
          disabled={isPending}
        >
          +
        </button>
      </div>

      <div className="docs-sidebar-body">
        {tree.length === 0 ? (
          <div className="docs-sidebar-empty">
            <p>{labels.empty}</p>
            <button type="button" className="btn btn-small" onClick={() => create(null)} disabled={isPending}>
              {labels.newPage}
            </button>
          </div>
        ) : (
          <nav aria-label={t('sidebar.pages')}>
            <ul className="docs-tree">{tree.map((n) => renderNode(n, 0))}</ul>
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

        <div className="docs-sidebar-foot">
          <button type="button" className="docs-sidebar-foot-link" onClick={() => create(null)} disabled={isPending}>
            <span aria-hidden>+</span> {labels.newPage}
            <span className="kbd-hint">C</span>
          </button>
          {trashCount > 0 && (
            <Link href="/app/docs#trash" className="docs-sidebar-foot-link">
              <span aria-hidden>⌫</span> {t('trash.title')}
              <span className="docs-sidebar-count mono">{trashCount}</span>
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
