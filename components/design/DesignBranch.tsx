'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useShellBranch } from '@/components/app/useShellBranch';
import type { DesignFolder, DesignSummary } from '@/lib/design';
import { DESIGN_CHANGED } from './ui';

/**
 * Carpetas y diseños recientes de Design en el sidebar (como las pizarras de
 * Board). Se recarga al navegar y cuando algo avisa un cambio
 * (DESIGN_CHANGED): crear, renombrar, mover o borrar. El abierto queda marcado.
 */
export default function DesignBranch() {
  const t = useTranslations('design.branch');
  const pathname = usePathname();
  const search = useSearchParams();
  const folderParam = search.get('folder');
  const slot = useShellBranch();
  const [data, setData] = useState<{ designs: DesignSummary[]; folders: DesignFolder[] } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/design/designs?view=recent&limit=12')
        .then((r) => (r.ok ? (r.json() as Promise<{ designs: DesignSummary[]; folders: DesignFolder[] }>) : null))
        .then((d) => {
          if (alive && d) setData(d);
        })
        .catch(() => null);
    void load();
    window.addEventListener(DESIGN_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(DESIGN_CHANGED, load);
    };
  }, [pathname]);

  if (!slot || !data) return null;
  const folderIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 6h6l2 2h10v11H3z" />
    </svg>
  );
  const designIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 4h16v16H4z M4 15l5-5 4 4 3-3 4 4" />
    </svg>
  );
  return createPortal(
    <nav className="docs-branch dz-branch" aria-label={t('label')} data-testid="design-branch">
      {data.folders.length > 0 && (
        <ul className="docs-tree" role="list" aria-label={t('folders')}>
          {data.folders.map((f) => {
            const active = pathname === '/app/design' && folderParam === f.id;
            return (
              <li key={f.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={`/app/design?folder=${encodeURIComponent(f.id)}`} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                  <span className="docs-tree-icon" aria-hidden="true">
                    {folderIcon}
                  </span>
                  <span className="docs-tree-title">{f.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="dz-branch-h">{t('recent')}</p>
      {data.designs.length === 0 ? (
        <p className="docs-sidebar-empty">{t('empty')}</p>
      ) : (
        <ul className="docs-tree" role="list" aria-label={t('recent')}>
          {data.designs.map((d) => {
            const active = pathname === `/app/design/${d.id}`;
            return (
              <li key={d.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={`/app/design/${d.id}`} className="docs-tree-link" aria-current={active ? 'page' : undefined} data-testid="design-branch-item">
                  <span className="docs-tree-icon" aria-hidden="true">
                    {designIcon}
                  </span>
                  <span className="docs-tree-title">{d.name}</span>
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
