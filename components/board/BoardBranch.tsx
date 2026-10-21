'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import type { BoardSummary } from '@/lib/boards-types';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';

/** Evento que avisa al sidebar que la lista de pizarras cambió (crear, renombrar, borrar). */
export const BOARDS_CHANGED = 'zs:boards-changed';

export function notifyBoardsChanged() {
  window.dispatchEvent(new Event(BOARDS_CHANGED));
}

const MAX = 50;

/**
 * Pizarras del workspace en el sidebar, como las páginas de Docs: las más
 * recientes primero. Se recarga al navegar y cuando la lista o el editor
 * avisan un cambio (BOARDS_CHANGED).
 */
export default function BoardBranch() {
  const t = useTranslations('board');
  const pathname = usePathname();
  const slot = useShellBranch();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/boards')
        .then((r) => (r.ok ? (r.json() as Promise<{ boards: BoardSummary[] }>) : null))
        .then((d) => {
          if (alive && d) setBoards(d.boards);
        })
        .catch(() => null);
    void load();
    window.addEventListener(BOARDS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(BOARDS_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !boards) return null;
  const list = [...boards].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, MAX);
  return createPortal(
    <nav className="docs-branch board-branch" aria-label={t('list.title')}>
      {list.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branch.empty')}</p>
      ) : (
        <ul className="docs-tree" role="list">
          {list.map((b) => {
            const active = pathname === `/app/board/${b.id}`;
            return (
              <li key={b.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={`/app/board/${b.id}`} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                  <span className="docs-tree-icon" aria-hidden="true">
                    <Icon name="board" size={14} />
                  </span>
                  <span className="docs-tree-title">{b.name || t('list.untitled')}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>,
    slot,
  );
}
