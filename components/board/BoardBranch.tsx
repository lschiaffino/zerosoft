'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import type { BoardSummary } from '@/lib/boards-types';
import Icon from '@/components/app/icons';

/** Evento que avisa al sidebar que la lista de pizarras cambió (crear, renombrar, borrar). */
export const BOARDS_CHANGED = 'zs:boards-changed';

export function notifyBoardsChanged() {
  window.dispatchEvent(new Event(BOARDS_CHANGED));
}

const DESKTOP = '(min-width: 1024px)';
const MAX = 50;

/** Hueco #side-branch del shell (bajo "Pizarras"), solo en ≥1024px con el sidebar abierto. */
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
