'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import type { TrackProjectRow } from '@/lib/schema/types';
import Icon from '@/components/app/icons';
import PrivateMark from './PrivateMark';
import { useShellBranch } from '@/components/app/useShellBranch';
import TrackIcon, { type TrackIconName } from './TrackIcon';
import { isTeamPath, teamPath } from '@/lib/track-routes';

type ProjectItem = Pick<TrackProjectRow, 'id' | 'name' | 'slug' | 'icon' | 'status' | 'visibility'>;
type FavoriteView = { id: string; name: string; project_id: string; project_name?: string };

/** Evento que avisan las vistas al marcar/desmarcar favoritas o renombrarlas. */
export const TRACK_VIEWS_CHANGED = 'zs:track-views-changed';

const EXPANDED_KEY = 'zs:track-branch-open';

/**
 * Sidebar de Track como el de Linear: vistas favoritas arriba y "Your teams"
 * con cada team desplegable en Issues, Cycles, Projects y Views. Se recarga
 * al navegar y cuando una vista cambia (favorita, renombrada, borrada).
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
  // Teams abiertos o cerrados a mano (el del team actual arranca abierto).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY);
      if (raw) setExpanded(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // Sin storage: todos cerrados salvo el actual.
    }
  }, []);
  const toggle = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = { ...prev, [id]: open };
      try {
        window.localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      } catch {
        // Solo comodidad.
      }
      return next;
    });

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
                    href={`${teamPath(v.project_id)}?savedView=${v.id}`}
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
        <ul className="docs-tree" role="list" data-testid="track-branch-teams">
          {projects.map((p) => {
            const href = teamPath(p);
            const here = isTeamPath(pathname, p);
            const team = searchParams.get('team');
            const open = expanded[p.id] ?? here;
            const children: Array<{ key: string; href: string; active: boolean; icon: TrackIconName }> = [
              { key: 'issues', href, active: here && !currentView && searchParams.get('views') !== '1', icon: 'tasks' },
              { key: 'cycles', href: `/app/track/cycles?team=${encodeURIComponent(p.id)}`, active: pathname.startsWith('/app/track/cycles') && team === p.id, icon: 'cycle' },
              { key: 'projects', href: `/app/track/projects?team=${encodeURIComponent(p.id)}`, active: pathname === '/app/track/projects' && team === p.id, icon: 'plans' },
              { key: 'views', href: `${href}?views=1`, active: here && searchParams.get('views') === '1', icon: 'views' },
            ];
            return (
              <li key={p.id} className="track-branch-team">
                <div className={`docs-tree-row${here && !open ? ' active' : ''}`}>
                  <button
                    type="button"
                    className={`docs-tree-chevron${open ? ' open' : ''}`}
                    onClick={() => toggle(p.id, !open)}
                    aria-label={`${open ? t('collapse') : t('expand')}: ${p.name}`}
                    aria-expanded={open}
                    data-testid="track-branch-team-toggle"
                  >
                    <Icon name="chevronRight" size={12} />
                  </button>
                  <Link
                    href={href}
                    className="docs-tree-link"
                    aria-current={here && !open ? 'page' : undefined}
                    onClick={() => toggle(p.id, true)}
                  >
                    <span className="docs-tree-icon" aria-hidden="true">
                      {p.icon ? p.icon : <Icon name="lists" size={14} />}
                    </span>
                    <span className="docs-tree-title">{p.name}</span>
                    {p.visibility === 'private' ? <PrivateMark label={t('private')} /> : null}
                  </Link>
                </div>
                {open && (
                  <ul className="docs-tree track-branch-children" role="list">
                    {children.map((c) => (
                      <li key={c.key} className={`docs-tree-row track-branch-child${c.active ? ' active' : ''}`}>
                        <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                        <Link href={c.href} className="docs-tree-link" aria-current={c.active ? 'page' : undefined} data-testid={`track-branch-${c.key}`}>
                          <span className="docs-tree-icon" aria-hidden="true">
                            <TrackIcon name={c.icon} size={13} />
                          </span>
                          <span className="docs-tree-title">{t(c.key)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </nav>,
    slot,
  );
}
