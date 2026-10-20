'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useKeyShortcut } from '@/components/app/QuickModal';
import Icon from '@/components/app/icons';
import { buildPageTree, type DocsPageSummary } from '@/lib/docs-types';
import DocsGlyph from './DocsGlyphs';
import DocsPageSwitcher, { DOCS_SWITCHER_EVENT } from './DocsPageSwitcher';

interface DocsSidebarProps {
  pages: DocsPageSummary[];
  currentId?: string;
  /** En mobile el árbol arranca abierto (landing) o plegado (editor). */
  mobileOpenByDefault?: boolean;
  createAction: (parentId?: string | null) => void;
  moveAction: (pageId: string, parentId: string | null) => void | Promise<void>;
  /** Reordenar entre hermanas (soltar arriba/abajo de una fila). */
  reorderAction?: (pageId: string, targetId: string, placement: 'before' | 'after') => void | Promise<void>;
  /** "Subir / Bajar" (menú de la fila y Alt+↑/↓). */
  stepAction?: (pageId: string, dir: -1 | 1) => void | Promise<void>;
  labels: {
    newPage: string;
    newSubpage: string;
    empty: string;
  };
  /** Páginas de otros workspaces compartidas con la persona. */
  shared?: Array<{ id: string; title: string; icon: string | null; role: 'view' | 'edit'; owner_name: string | null; owner_email: string }>;
}

type TreeNode = DocsPageSummary & { children?: TreeNode[] };
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
const DESKTOP = '(min-width: 1024px)';

/**
 * Hueco del árbol en el sidebar del shell (#side-branch, bajo "Páginas").
 * Solo en ≥1024px y con el sidebar abierto: colapsado (solo íconos) o en
 * mobile (drawer) el árbol vuelve a la columna propia / al botón "Páginas".
 */
function useShellBranch(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const frame = document.querySelector('.app-frame');
    let raf = 0;
    const update = () => {
      const slot = document.getElementById('side-branch');
      const collapsed = frame?.classList.contains('sidebar-collapsed') ?? false;
      setEl(mq.matches && !collapsed ? slot : null);
      // Al entrar desde otro producto el hueco puede montarse un frame después.
      if (!slot && mq.matches && !collapsed && !raf) raf = requestAnimationFrame(update);
    };
    update();
    mq.addEventListener('change', update);
    const mo = frame ? new MutationObserver(update) : null;
    mo?.observe(frame!, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mq.removeEventListener('change', update);
      mo?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  return el;
}

/**
 * Árbol de páginas de Docs, como el sidebar de Notion. En ≥1024px vive bajo
 * "Páginas" en el sidebar del shell (portal a #side-branch), sin columna
 * propia. Cada fila: flecha para plegar (si tiene subpáginas), el ícono de la
 * página (o un documento genérico), el título y, al pasar, "…" y "+" para
 * crear una subpágina. Cada nivel se sangra 14px, sin líneas que los unan; la
 * página abierta lleva un fondo suave.
 * Nueva página y Papelera ya están en el sidebar del shell: acá no se repiten.
 */
export default function DocsSidebar({
  pages,
  currentId,
  mobileOpenByDefault = false,
  createAction,
  moveAction,
  reorderAction,
  stepAction,
  labels,
  shared = [],
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
  const menuRef = useRef<HTMLSpanElement>(null);
  const branch = useShellBranch();

  // Ramas plegadas: preferencia local del navegador.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* storage bloqueado */
    }
  }, []);

  // Menú de fila: el foco entra al primer ítem; clic afuera lo cierra.
  useEffect(() => {
    if (!menuId) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuId]);

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

  const closeMenu = (id: string) => {
    setMenuId(null);
    document.getElementById(`docs-more-${id}`)?.focus();
  };

  const menuKeys = (e: React.KeyboardEvent<HTMLElement>, id: string) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(id);
    } else if (e.key === 'Tab') setMenuId(null);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const active = node.id === currentId;
    const hasChildren = !!node.children?.length;
    const open = hasChildren && (!collapsed.has(node.id) || ancestorsOfCurrent.has(node.id));
    return (
      <li key={node.id} style={{ '--d': depth } as CSSProperties}>
        <div
          className={`docs-tree-row${active ? ' active' : ''}${dropId === node.id ? ` drop drop-${dropZone}` : ''}${dragId === node.id ? ' dragging' : ''}`}
          data-testid="docs-tree-row"
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
          {hasChildren ? (
            <button
              type="button"
              className={`docs-tree-chevron${open ? ' open' : ''}`}
              onClick={() => toggle(node.id)}
              aria-label={`${open ? t('sidebar.collapse') : t('sidebar.expand')}: ${node.title || t('untitled')}`}
              aria-expanded={open}
            >
              <Icon name="chevronRight" size={12} />
            </button>
          ) : (
            <span className="docs-tree-chevron-spacer" aria-hidden="true" />
          )}
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
            <span className="docs-tree-icon" aria-hidden="true">
              {node.icon ? node.icon : <DocsGlyph name="page" size={16} />}
            </span>
            <span className="docs-tree-title">{node.title || t('untitled')}</span>
          </Link>
          <span className="docs-tree-actions">
          {stepAction && (
            <span className="docs-tree-more-wrap" ref={menuId === node.id ? menuRef : undefined}>
              <button
                type="button"
                id={`docs-more-${node.id}`}
                className="docs-tree-btn docs-tree-more"
                onClick={() => setMenuId((m) => (m === node.id ? null : node.id))}
                aria-haspopup="menu"
                aria-expanded={menuId === node.id}
                aria-label={t('sidebar.pageActions')}
                title={t('sidebar.pageActions')}
              >
                <DocsGlyph name="more" size={14} />
              </button>
              {menuId === node.id && (
                <span className="docs-menu docs-tree-menu" role="menu" onKeyDown={(e) => menuKeys(e, node.id)}>
                  <button type="button" role="menuitem" className="docs-menu-item" onClick={() => step(node.id, -1)} disabled={isPending}>
                    <DocsGlyph name="up" size={14} />
                    {t('sidebar.moveUp')}
                  </button>
                  <button type="button" role="menuitem" className="docs-menu-item" onClick={() => step(node.id, 1)} disabled={isPending}>
                    <DocsGlyph name="down" size={14} />
                    {t('sidebar.moveDown')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="docs-menu-item"
                    onClick={() => {
                      setMenuId(null);
                      create(node.id);
                    }}
                    disabled={isPending}
                  >
                    <Icon name="plus" size={14} />
                    {labels.newSubpage}
                  </button>
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            className="docs-tree-btn docs-tree-add"
            onClick={() => create(node.id)}
            disabled={isPending}
            title={labels.newSubpage}
            aria-label={`${labels.newSubpage}: ${node.title || t('untitled')}`}
          >
            <Icon name="plus" size={14} />
          </button>
          </span>
        </div>
        {open && <ul>{node.children!.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  const count = t('sidebar.count', { count: pages.length });

  const body = (inShell: boolean) => (
    <>
      {/* Buscar (Cmd+P): títulos y contenido de las páginas. */}
      <button
        type="button"
        className="docs-tree-search"
        onClick={() => window.dispatchEvent(new Event(DOCS_SWITCHER_EVENT))}
        aria-keyshortcuts="Meta+P Control+P"
        data-testid="docs-search-button"
      >
        <DocsGlyph name="search" size={14} />
        <span className="docs-tree-search-label">{t('switcher.open')}</span>
        <kbd className="docs-tree-search-kbd">{t('switcher.shortcut')}</kbd>
      </button>
      {tree.length === 0 ? (
        <div className="docs-sidebar-empty">
          <p>{labels.empty}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => create(null)} disabled={isPending}>
            <Icon name="plus" size={14} />
            {labels.newPage}
          </button>
        </div>
      ) : inShell ? (
        // Ya está dentro del <nav> del sidebar: una lista, no otro landmark.
        <ul className="docs-tree" aria-label={t('sidebar.pages')}>
          {tree.map((n) => renderNode(n, 0))}
        </ul>
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

      {shared.length > 0 && (
        <div className="docs-shared" role="group" aria-label={t('sidebar.sharedWithMe')}>
          <p className="docs-shared-label">{t('sidebar.sharedWithMe')}</p>
          <ul className="docs-shared-list">
            {shared.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/app/docs/${p.id}`}
                  className={`docs-shared-row${p.id === currentId ? ' active' : ''}`}
                  aria-current={p.id === currentId ? 'page' : undefined}
                  title={t('sidebar.sharedBy', { name: p.owner_name || p.owner_email })}
                >
                  <span className="docs-shared-title">{p.title || t('untitled')}</span>
                  <span className="docs-shared-role">{t(`share.roles.${p.role}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  // ≥1024px con el sidebar abierto: el árbol cuelga de "Páginas".
  const switcher = <DocsPageSwitcher pages={pages} />;

  if (branch) {
    return (
      <>
        {createPortal(<div className="docs-branch">{body(true)}</div>, branch)}
        {switcher}
      </>
    );
  }

  return (
    <div className={`docs-sidebar${mobileOpen ? ' mobile-open' : ''}`}>
      {switcher}
      <div className="docs-sidebar-head">
        <button
          type="button"
          className="docs-sidebar-toggle"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="docs-sidebar-body"
        >
          <span className="docs-sidebar-title">{t('sidebar.pages')}</span>
          <span className="docs-sidebar-count">{count}</span>
          <Icon name="chevronDown" size={14} />
        </button>
        <p className="docs-sidebar-title docs-sidebar-title-desk">
          {t('sidebar.pages')}
          <span className="docs-sidebar-count">{count}</span>
        </p>
        <button
          type="button"
          className="docs-tree-btn docs-sidebar-new"
          onClick={() => create(null)}
          title={`${labels.newPage} (C)`}
          aria-label={labels.newPage}
          aria-keyshortcuts="C"
          disabled={isPending}
          aria-busy={isPending || undefined}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>

      <div className="docs-sidebar-body" id="docs-sidebar-body">
        {body(false)}
      </div>
    </div>
  );
}
