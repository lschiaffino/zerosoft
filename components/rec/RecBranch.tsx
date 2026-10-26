'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useShellBranch } from '@/components/app/useShellBranch';
import { REC_CHANGED, type RecFolder } from './RecDialogs';

/**
 * Carpetas de Rec en el sidebar (como las pizarras de Board o las páginas de
 * Docs), separadas en Mis videos y Workspace. Se recarga al navegar y cuando
 * la biblioteca avisa un cambio (REC_CHANGED); la abierta queda marcada.
 */
export default function RecBranch() {
  const t = useTranslations('rec.library');
  const pathname = usePathname();
  const slot = useShellBranch();
  const [folders, setFolders] = useState<RecFolder[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/rec/folders')
        .then((r) => (r.ok ? (r.json() as Promise<{ folders: RecFolder[] }>) : null))
        .then((d) => {
          if (alive && d) setFolders(d.folders);
        })
        .catch(() => null);
    void load();
    window.addEventListener(REC_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(REC_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !folders) return null;
  const group = (space: 'personal' | 'workspace') => folders.filter((f) => f.space === space);
  const row = (f: RecFolder) => {
    const active = pathname === `/app/rec/f/${f.id}`;
    return (
      <li key={f.id} className={`docs-tree-row${active ? ' active' : ''}`}>
        <span className="docs-tree-chevron-spacer" aria-hidden="true" />
        <Link href={`/app/rec/f/${f.id}`} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
          <span className="docs-tree-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3 6h6l2 2h10v11H3z" />
            </svg>
          </span>
          <span className="docs-tree-title">{f.name}</span>
        </Link>
      </li>
    );
  };
  return createPortal(
    <nav className="docs-branch rec-branch" aria-label={t('folders')}>
      {folders.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branchEmpty')}</p>
      ) : (
        <>
          {group('personal').length > 0 && <ul className="docs-tree" role="list" aria-label={t('mine')}>{group('personal').map(row)}</ul>}
          {group('workspace').length > 0 && (
            <>
              <p className="rec-branch-h">{t('workspace')}</p>
              <ul className="docs-tree" role="list" aria-label={t('workspace')}>
                {group('workspace').map(row)}
              </ul>
            </>
          )}
        </>
      )}
    </nav>,
    slot,
  );
}
