'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';
import type { SavedListDto } from '@/lib/groups-org';

/** Evento que avisa al sidebar que cambiaron las listas guardadas (crear, renombrar, borrar). */
export const LISTS_CHANGED = 'zs:groups-lists-changed';

export function notifyListsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LISTS_CHANGED));
}

/**
 * Listas guardadas de chats en el sidebar de Groups, colgadas de "Bandeja"
 * (como las pizarras de Board). La abierta queda marcada; cuenta los chats.
 */
export default function GroupsListsBranch() {
  const t = useTranslations('groups');
  const pathname = usePathname();
  const params = useSearchParams();
  const slot = useShellBranch();
  const [lists, setLists] = useState<SavedListDto[] | null>(null);
  const current = pathname.startsWith('/app/groups/inbox') ? params.get('list') : null;

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/groups/lists?counts=1')
        .then((r) => (r.ok ? (r.json() as Promise<{ lists: SavedListDto[] }>) : null))
        .then((d) => {
          if (alive && d) setLists(d.lists);
        })
        .catch(() => null);
    void load();
    window.addEventListener(LISTS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(LISTS_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !lists || lists.length === 0) return null;
  return createPortal(
    <nav className="docs-branch gr-lists-branch" aria-label={t('lists.sidebar')}>
      <ul className="docs-tree" role="list">
        {lists.map((l) => {
          const active = current === l.id;
          return (
            <li key={l.id} className={`docs-tree-row${active ? ' active' : ''}`}>
              <span className="docs-tree-chevron-spacer" aria-hidden="true" />
              <Link href={`/app/groups/inbox?list=${l.id}`} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                <span className="docs-tree-icon" aria-hidden="true">
                  <Icon name="lists" size={14} />
                </span>
                <span className="docs-tree-title">{l.name}</span>
                {typeof l.count === 'number' && l.count > 0 && <span className="gr-branch-count">{l.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>,
    slot,
  );
}
