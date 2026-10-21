'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import type { TrackProjectRow } from '@/lib/schema/types';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';

type ProjectItem = Pick<TrackProjectRow, 'id' | 'name' | 'icon' | 'status'>;

/**
 * Proyectos activos de Track en el sidebar, bajo "Proyectos", como los de
 * Linear (y las pizarras de Board). Se recarga al navegar: crear un
 * proyecto lleva a su página.
 */
export default function TrackBranch() {
  const t = useTranslations('track.branch');
  const pathname = usePathname();
  const slot = useShellBranch();
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/track/projects?pageSize=100')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: ProjectItem[] }>) : null))
      .then((d) => {
        if (alive && d) setProjects(d.rows.filter((p) => p.status === 'active'));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [pathname]);

  if (!slot || !projects) return null;
  return createPortal(
    <nav className="docs-branch track-branch" aria-label={t('label')}>
      {projects.length === 0 ? (
        <p className="docs-sidebar-empty">{t('empty')}</p>
      ) : (
        <ul className="docs-tree" role="list">
          {projects.map((p) => {
            const href = `/app/track/projects/${p.id}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={p.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                <Link href={href} className="docs-tree-link" aria-current={active ? 'page' : undefined}>
                  <span className="docs-tree-icon" aria-hidden="true">
                    {p.icon ? p.icon : <Icon name="lists" size={14} />}
                  </span>
                  <span className="docs-tree-title">{p.name}</span>
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
