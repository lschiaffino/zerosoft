'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import type { BoardFolder, BoardSummary } from '@/lib/boards-types';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';
import { preloadCanvas } from './preloadCanvas';

/** Evento que avisa al sidebar que la lista de pizarras cambió (crear, renombrar, borrar, mover). */
export const BOARDS_CHANGED = 'zs:boards-changed';

export function notifyBoardsChanged() {
  window.dispatchEvent(new Event(BOARDS_CHANGED));
}

const MAX = 50;

/**
 * Pizarras del workspace en el sidebar, como las páginas de Docs: las
 * carpetas primero (se despliegan con sus pizarras) y después las sueltas,
 * las más recientes primero. Se recarga al navegar y cuando la lista o el
 * editor avisan un cambio (BOARDS_CHANGED).
 */
export default function BoardBranch() {
  const t = useTranslations('board');
  const pathname = usePathname();
  const params = useSearchParams();
  const slot = useShellBranch();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [folders, setFolders] = useState<BoardFolder[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch('/api/boards')
        .then((r) => (r.ok ? (r.json() as Promise<{ boards: BoardSummary[] }>) : null))
        .then((d) => {
          if (alive && d) setBoards(d.boards);
        })
        .catch(() => null);
      void fetch('/api/boards/folders')
        .then((r) => (r.ok ? (r.json() as Promise<{ folders: BoardFolder[] }>) : null))
        .then((d) => {
          if (alive && d) setFolders(d.folders);
        })
        .catch(() => null);
    };
    load();
    window.addEventListener(BOARDS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(BOARDS_CHANGED, load);
    };
  }, [pathname]);

  // La carpeta de la pizarra abierta (o la carpeta abierta en la lista) queda desplegada.
  const activeBoard = boards?.find((b) => pathname === `/app/board/${b.id}`);
  const activeFolder = pathname === '/app/board' ? params?.get('folder') : (activeBoard?.folder_id ?? null);
  useEffect(() => {
    if (activeFolder) setOpen((s) => (s.has(activeFolder) ? s : new Set(s).add(activeFolder)));
  }, [activeFolder]);

  if (!slot || !boards) return null;
  const sorted = [...boards].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const known = new Set(folders.map((f) => f.id));
  const loose = sorted.filter((b) => !b.folder_id || !known.has(b.folder_id)).slice(0, MAX);
  const row = (b: BoardSummary, nested = false) => {
    const active = pathname === `/app/board/${b.id}`;
    return (
      <li key={b.id} className={`docs-tree-row${active ? ' active' : ''}${nested ? ' is-nested' : ''}`}>
        <span className="docs-tree-chevron-spacer" aria-hidden="true" />
        <Link
          href={`/app/board/${b.id}`}
          className="docs-tree-link"
          aria-current={active ? 'page' : undefined}
          onPointerEnter={preloadCanvas}
          onFocus={preloadCanvas}
        >
          <span className="docs-tree-icon" aria-hidden="true">
            <Icon name="board" size={14} />
          </span>
          <span className="docs-tree-title">{b.name || t('list.untitled')}</span>
        </Link>
      </li>
    );
  };
  return createPortal(
    <nav className="docs-branch board-branch" aria-label={t('list.title')}>
      {sorted.length === 0 && folders.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branch.empty')}</p>
      ) : (
        <ul className="docs-tree" role="list">
          {folders.map((f) => {
            const inside = sorted.filter((b) => b.folder_id === f.id);
            const isOpen = open.has(f.id);
            const current = pathname === '/app/board' && params?.get('folder') === f.id;
            return (
              <li key={f.id} className="board-branch-folder">
                <div className={`docs-tree-row${current ? ' active' : ''}`}>
                  {inside.length ? (
                    <button
                      type="button"
                      className={`docs-tree-chevron${isOpen ? ' open' : ''}`}
                      onClick={() =>
                        setOpen((s) => {
                          const n = new Set(s);
                          if (n.has(f.id)) n.delete(f.id);
                          else n.add(f.id);
                          return n;
                        })
                      }
                      aria-label={`${isOpen ? t('branch.collapse') : t('branch.expand')}: ${f.name}`}
                      aria-expanded={isOpen}
                    >
                      <Icon name="chevronRight" size={12} />
                    </button>
                  ) : (
                    <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                  )}
                  <Link href={`/app/board?folder=${encodeURIComponent(f.id)}`} className="docs-tree-link" aria-current={current ? 'page' : undefined}>
                    <span className="docs-tree-icon" aria-hidden="true">
                      <Icon name="folder" size={14} />
                    </span>
                    <span className="docs-tree-title">{f.name}</span>
                  </Link>
                </div>
                {isOpen && inside.length > 0 && (
                  <ul className="docs-tree board-branch-children" role="list">
                    {inside.slice(0, MAX).map((b) => row(b, true))}
                  </ul>
                )}
              </li>
            );
          })}
          {loose.map((b) => row(b))}
        </ul>
      )}
    </nav>,
    slot,
  );
}
