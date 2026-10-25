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
import { StatusDot } from './glyphs';
import { isTeamPath, teamPath } from '@/lib/track-routes';
import { setTopbarLabel } from '@/components/app/AppTopbar';

type ProjectItem = Pick<TrackProjectRow, 'id' | 'name' | 'slug' | 'icon' | 'status' | 'visibility' | 'triage_enabled'> & { triage_count?: number };
type FavoriteView = { id: string; name: string; project_id: string; project_name?: string };
type FavoriteIssue = { id: string; identifier: string; title: string; status_color: string | null; status_category: string | null };

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
  const [favoriteIssues, setFavoriteIssues] = useState<FavoriteIssue[]>([]);
  const [tick, setTick] = useState(0);
  // En la página de un issue se marca su team (el issue deja su team en data-track-project-id).
  const [contextTeam, setContextTeam] = useState<string | null>(null);
  const [contextIssue, setContextIssue] = useState<string | null>(null);
  useEffect(() => {
    if (!pathname.startsWith('/app/track/issue')) {
      setContextTeam(null);
      setContextIssue(null);
      return;
    }
    let tries = 0;
    let timer = 0;
    const look = () => {
      const el = document.querySelector<HTMLElement>('.track-detail[data-track-project-id]');
      const id = el?.dataset.trackProjectId ?? null;
      setContextIssue(el?.dataset.trackIssueId ?? null);
      if (id) setContextTeam(id);
      else if (++tries < 30) timer = window.setTimeout(look, 150);
    };
    look();
    return () => window.clearTimeout(timer);
  }, [pathname]);
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
    fetch('/api/track/issues/favorites')
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: FavoriteIssue[] }>) : null))
      .then((d) => {
        if (alive && d) setFavoriteIssues(d.rows);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [pathname, tick]);

  // El topbar dice el nombre del team (no "Teams" ni "Issues") en su página y en sus issues.
  const currentTeam = projects?.find((p) => isTeamPath(pathname, p) || contextTeam === p.id) ?? null;
  const currentTeamName = currentTeam?.name ?? null;
  useEffect(() => {
    if (currentTeamName) setTopbarLabel(pathname, currentTeamName);
  }, [pathname, currentTeamName]);

  if (!slot || !projects) return null;
  const currentView = searchParams.get('savedView');
  return createPortal(
    <nav className="docs-branch track-branch" aria-label={t('label')}>
      {(favorites.length > 0 || favoriteIssues.length > 0) && (
        <>
          <p className="track-branch-section">{tv('favorites')}</p>
          <ul className="docs-tree" role="list" data-testid="track-branch-favorites">
            {favoriteIssues.map((i) => {
              const active = contextIssue === i.id;
              return (
                <li key={i.id} className={`docs-tree-row${active ? ' active' : ''}`}>
                  <span className="docs-tree-chevron-spacer" aria-hidden="true" />
                  <Link
                    href={`/app/track/issues/${i.id}`}
                    className="docs-tree-link"
                    aria-current={active ? 'page' : undefined}
                    title={`${i.identifier} ${i.title}`}
                    data-testid="track-branch-favorite-issue"
                  >
                    <span className="docs-tree-icon" aria-hidden="true">
                      <StatusDot color={i.status_color} category={i.status_category} />
                    </span>
                    <span className="docs-tree-title">{i.title || i.identifier}</span>
                  </Link>
                </li>
              );
            })}
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
            const onTeamPage = isTeamPath(pathname, p);
            const here = onTeamPage || contextTeam === p.id;
            const team = searchParams.get('team');
            const open = expanded[p.id] ?? (here || ((team === p.id || team?.toLowerCase() === p.slug.toLowerCase()) && (pathname.startsWith('/app/track/cycles') || pathname === '/app/track/projects')));
            const tab = searchParams.get('tab');
            const triageCount = p.triage_count ?? 0;
            const children: Array<{ key: string; href: string; active: boolean; icon: TrackIconName; count?: number }> = [
              { key: 'issues', href, active: here && !currentView && searchParams.get('views') !== '1' && !(onTeamPage && tab === 'triage'), icon: 'tasks' },
              ...(p.triage_enabled || triageCount > 0
                ? [{ key: 'triage', href: `${href}?tab=triage`, active: onTeamPage && tab === 'triage', icon: 'inbox' as TrackIconName, count: triageCount }]
                : []),
              {
                key: 'cycles',
                // URL con la clave del team (como Linear); ?team=<id> sigue andando.
                href: `/app/track/cycles?team=${encodeURIComponent(p.slug.toUpperCase())}`,
                active: pathname.startsWith('/app/track/cycles') && (team === p.id || team?.toLowerCase() === p.slug.toLowerCase()),
                icon: 'cycle',
              },
              { key: 'projects', href: `/app/track/projects?team=${encodeURIComponent(p.id)}`, active: pathname === '/app/track/projects' && team === p.id, icon: 'plans' },
              { key: 'views', href: `${href}?views=1`, active: onTeamPage && searchParams.get('views') === '1', icon: 'views' },
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
                    // El team abierto queda marcado (la fila de Issues se resalta abajo).
                    // El team abierto queda marcado (y abajo, su Issues o Triage).
                    aria-current={here && !currentView ? 'page' : undefined}
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
                        <Link
                          href={c.href}
                          className="docs-tree-link"
                          aria-current={c.active ? 'page' : undefined}
                          data-testid={`track-branch-${c.key}`}
                        >
                          <span className="docs-tree-icon" aria-hidden="true">
                            <TrackIcon name={c.icon} size={13} />
                          </span>
                          <span className="docs-tree-title">{t(c.key)}</span>
                          {c.count ? <span className="track-branch-count data">{c.count}</span> : null}
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
