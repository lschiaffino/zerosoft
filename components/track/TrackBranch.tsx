'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import type { TrackProjectRow } from '@/lib/schema/types';
import Icon from '@/components/app/icons';
import { useShellBranch } from '@/components/app/useShellBranch';
import TrackIcon from './TrackIcon';

type ProjectItem = Pick<TrackProjectRow, 'id' | 'name' | 'icon' | 'status'>;
type FavoriteView = { id: string; name: string; project_id: string; project_name?: string };

/** Evento que avisan las vistas al marcar/desmarcar favoritas o renombrarlas. */
export const TRACK_VIEWS_CHANGED = 'zs:track-views-changed';

/**
 * Sidebar de Track: vistas favoritas arriba (como las de Linear) y los
 * proyectos activos bajo "Proyectos". Se recarga al navegar y cuando una
 * vista cambia (favorita, renombrada, borrada).
 */
export default function TrackBranch() {
  const t = useTranslations('track.branch');
  const tv = useTranslations('track.ux.views');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slot = useShellBranch();
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  const [favorites, setFavorites] = useState<FavoriteView[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(TRACK_VIEWS_CHANGED, onChange);
    return () => window.removeEventListener(TRACK_VIEWS_CHANGED, onChange);
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/track/projects?pageSize=100')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: ProjectItem[] }>) : null))
      .then((d) => {
        if (alive && d) setProjects(d.rows.filter((p) => p.status === 'active'));
      })
      .catch(() => null);
    fetch('/api/track/views/favorites')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: FavoriteView[] }>) : null))
      .then((d) => {
        if (alive && d) setFavorites(d.rows);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [pathname, tick]);

  if (!slot || !projects) return null;
  const currentView = searchParams.get('savedView');
  return createPortal(
    <nav className="docs-branch track-branch" aria-label={t('label')}>
      {favorites.length > 0 && (
        <>
          <p className="track-branch-section">{tv('favorites')}</p>
          <ul className="docs-tree" role="list" data-testid="track-branch-favorites">
            {favorites.map((v) => {
              const active = currentView === v.id;
              return (
                <li key={v.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                  <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                  <Link
                    href={`/app/track/projects/${v.project_id}?savedView=${v.id}`}
                    className="docs-tree-link"
                    aria-current={active ? 'page' : undefined}
                    title={v.project_name ? `${v.project_name} · ${v.name}` : v.name}
                  >
                    <span className="docs-tree-icon" aria-hidden="true">
                      <TrackIcon name="star" size={13} />
                    </span>
                    <span className="docs-tree-title">{v.name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {projects.length === 0 ? (
        <p className="docs-sidebar-empty">{t('empty')}</p>
      ) : (
        <ul className="docs-tree" role="list">
          {projects.map((p) => {
            const href = `/app/track/projects/${p.id}`;
            const active = !currentView && (pathname === href || pathname.startsWith(`${href}/`));
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
