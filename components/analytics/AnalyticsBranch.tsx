'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useShellBranch } from '@/components/app/useShellBranch';
import { ANALYTICS_CHANGED } from './client';

/**
 * Tableros del proyecto en el sidebar (como los tableros fijados de PostHog),
 * colgando de "Tableros". Se recarga al navegar y cuando algo cambia; el
 * abierto queda marcado.
 */
export default function AnalyticsBranch({ projectId }: { projectId: string | null }) {
  const t = useTranslations('analytics.dashboards');
  const pathname = usePathname();
  const slot = useShellBranch();
  const [items, setItems] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    if (!projectId) {
      setItems([]);
      return;
    }
    let alive = true;
    const load = () =>
      fetch(`/api/analytics/dashboards?project=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ dashboards: Array<{ id: string; name: string }> }>) : null))
        .then((d) => {
          if (alive && d) setItems(d.dashboards);
        })
        .catch(() => null);
    void load();
    window.addEventListener(ANALYTICS_CHANGED, load);
    return () => {
      alive = false;
      window.removeEventListener(ANALYTICS_CHANGED, load);
    };
  }, [projectId, pathname]);

  if (!slot || !items) return null;
  return createPortal(
    <nav className="docs-branch" aria-label={t('title')}>
      {items.length === 0 ? (
        <p className="docs-sidebar-empty">{t('branchEmpty')}</p>
      ) : (
        <ul className="docs-tree" role="list">
          {items.map((d) => {
            const active = pathname === `/app/analytics/dashboards/${d.id}`;
            return (
              <li key={d.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={`/app/analytics/dashboards/${d.id}`} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                  <span className="docs-tree-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 20V10M10 20V4M16 20v-7" />
                    </svg>
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
