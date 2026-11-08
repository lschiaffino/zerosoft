'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Link } from '@/i18n/navigation';
import type { TrackIssueTemplateRow, TrackProjectRow, TrackRecurringIssueRow, TrackStatusRow } from '@/lib/db';
import type { ProjectMember, TrackIssueWithStatus, TrackProjectMeta } from '@/lib/track-data';
import type { TrackMilestoneWithProgress } from '@/lib/track-milestones';
import type { TrackSavedView } from '@/lib/track-ux';
import { upcomingMilestone } from '@/lib/track-milestone-utils';
import { activeCycle, formatDay } from '@/lib/track-tasks';
import { TEAMS_PATH, teamPath } from '@/lib/track-routes';
import type { IssueGroupBy } from '@/lib/track-views';
import type { ListLayout } from '@/lib/track-issue-list';
import TrackIssueList, { type TrackListTeam } from './TrackIssueList';
import TrackIcon from './TrackIcon';
import { TrackToast, useToday } from './InlineEditors';
import { openTrackNewIssue } from './useIssueStore';
import { TRACK_ISSUES_CHANGED } from './trackEvents';
import type { CycleWithProgress } from './CyclesPanel';
import { buildTrackUiLabels } from './ui-labels';

// Paneles que no se ven al entrar (ajustes, triage): cada uno en su chunk.
const StatusesSettings = dynamic(() => import('./StatusesSettings'));
const ProjectSettingsDrawer = dynamic(() => import('./ProjectSettingsDrawer'));
const AutoCyclesSettings = dynamic(() => import('./AutoCyclesSettings'));
const MilestonesPanel = dynamic(() => import('./MilestonesPanel'));
const TemplatesPanel = dynamic(() => import('./TemplatesPanel'));
const RecurringPanel = dynamic(() => import('./RecurringPanel'));
const TriagePanel = dynamic(() => import('./TriagePanel'));
const TriageSettingsPanel = dynamic(() => import('./triage/TriageSettingsPanel'));
const CyclesPanel = dynamic(() => import('./CyclesPanel'));

interface ProjectPageClientProps {
  project: TrackProjectRow;
  /** Clave del team (WEB): la URL de la página (/app/track/team/WEB). */
  teamKey: string;
  userId: string;
  /** Owner/admin del workspace: puede borrar en masa. */
  isAdmin?: boolean;
  initialStatuses: TrackStatusRow[];
  initialMembers: ProjectMember[];
  initialViews: TrackSavedView[];
  /** Lo demás del team, cargado en el servidor (un solo viaje): cycles, milestones, plantillas, repeticiones y triage. */
  initialCycles?: CycleWithProgress[];
  initialMilestones?: TrackMilestoneWithProgress[];
  initialTemplates?: TrackIssueTemplateRow[];
  initialRecurring?: TrackRecurringIssueRow[];
  initialTriage?: TrackIssueWithStatus[];
}

/** Agrupados de la lista de un team (por team no tiene sentido acá), como Linear. */
const TEAM_GROUPS: readonly IssueGroupBy[] = ['none', 'status', 'assignee', 'priority', 'plan', 'cycle', 'label'];
const TEAM_LAYOUTS: readonly ListLayout[] = ['list', 'board', 'calendar', 'gantt'];
// Como Linear: agrupada por estado, los más nuevos arriba.
const TEAM_DEFAULTS = { group: 'status' as const, sort: 'newest' as const, props: ['id', 'priority', 'labels', 'cycle', 'due', 'assignee'] as Array<'id' | 'priority' | 'labels' | 'cycle' | 'due' | 'assignee'> };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`api error ${res.status}`);
  return (await res.json()) as T;
}

const changed = () => window.dispatchEvent(new CustomEvent(TRACK_ISSUES_CHANGED));

/**
 * Página de un team, como Linear: encabezado con el cycle activo y el
 * próximo milestone, y la lista de issues compartida (TrackIssueList) con
 * las pestañas All / Active / Backlog, las vistas del team y Triage. Los
 * ajustes del team (cycles, milestones, plantillas, status, triage) van en
 * un panel lateral.
 */
export default function ProjectPageClient({
  project: initialProject,
  teamKey,
  userId,
  isAdmin = false,
  initialStatuses,
  initialMembers,
  initialViews,
  initialCycles,
  initialMilestones,
  initialTemplates,
  initialRecurring,
  initialTriage,
}: ProjectPageClientProps) {
  const t = useTranslations('track');
  const tt = useTranslations('track.ux.team');
  const locale = useLocale();
  const today = useToday();
  const searchParams = useSearchParams();
  const ui = useMemo(() => buildTrackUiLabels((k) => t(k)), [t]);
  const projectId = initialProject.id;
  const href = teamPath(teamKey);

  const [project, setProject] = useState<TrackProjectRow>(initialProject);
  const [statuses, setStatuses] = useState<TrackStatusRow[]>(initialStatuses);
  const [members] = useState<ProjectMember[]>(initialMembers);
  const [cycles, setCycles] = useState<CycleWithProgress[]>(initialCycles ?? []);
  const [milestones, setMilestones] = useState<TrackMilestoneWithProgress[]>(initialMilestones ?? []);
  const [templates, setTemplates] = useState<TrackIssueTemplateRow[]>(initialTemplates ?? []);
  const [recurring, setRecurring] = useState<TrackRecurringIssueRow[]>(initialRecurring ?? []);
  const [triageIssues, setTriageIssues] = useState<TrackIssueWithStatus[]>(initialTriage ?? []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<'issues' | 'triage'>(() => (searchParams.get('tab') === 'triage' ? 'triage' : 'issues'));

  const reloadCycles = useCallback(async () => {
    const rows = await api<{ rows: CycleWithProgress[] }>(`/api/track/projects/${projectId}/cycles`).then((r) => r.rows).catch(() => null);
    if (rows) setCycles(rows);
  }, [projectId]);
  const reloadMilestones = useCallback(async () => {
    const rows = await api<{ rows: TrackMilestoneWithProgress[] }>(`/api/track/projects/${projectId}/milestones`).then((r) => r.rows).catch(() => null);
    if (rows) setMilestones(rows);
  }, [projectId]);
  const reloadTemplates = useCallback(async () => {
    const rows = await api<{ rows: TrackIssueTemplateRow[] }>(`/api/track/projects/${projectId}/templates`).then((r) => r.rows).catch(() => null);
    if (rows) setTemplates(rows);
  }, [projectId]);
  const reloadRecurring = useCallback(async () => {
    const rows = await api<{ rows: TrackRecurringIssueRow[] }>(`/api/track/projects/${projectId}/recurring`).then((r) => r.rows).catch(() => null);
    if (rows) setRecurring(rows);
  }, [projectId]);
  const loadTriage = useCallback(async () => {
    const data = await api<{ rows: TrackIssueWithStatus[] }>(`/api/track/projects/${projectId}/triage`).catch(() => null);
    if (data) setTriageIssues(data.rows);
  }, [projectId]);

  // Lo que no vino del servidor se pide al montar (no bloquea la lista); con todo precargado, ningún pedido.
  const preloaded = useRef({ c: !!initialCycles, m: !!initialMilestones, t: !!initialTemplates, r: !!initialRecurring, tr: !!initialTriage });
  useEffect(() => {
    const p = preloaded.current;
    if (!p.c) void reloadCycles();
    if (!p.m) void reloadMilestones();
    if (!p.t) void reloadTemplates();
    if (!p.r) void reloadRecurring();
    if (!p.tr) void loadTriage();
  }, [reloadCycles, reloadMilestones, reloadTemplates, reloadRecurring, loadTriage]);

  // El progreso de cycles y milestones depende de los issues: se refresca (con espera) cuando cambian.
  const progressTimer = useRef(0);
  const refreshProgress = useCallback(() => {
    window.clearTimeout(progressTimer.current);
    progressTimer.current = window.setTimeout(() => {
      void reloadCycles();
      void reloadMilestones();
    }, 600);
  }, [reloadCycles, reloadMilestones]);
  useEffect(() => {
    window.addEventListener(TRACK_ISSUES_CHANGED, refreshProgress);
    return () => {
      window.removeEventListener(TRACK_ISSUES_CHANGED, refreshProgress);
      window.clearTimeout(progressTimer.current);
    };
  }, [refreshProgress]);

  const toggleTriage = async (enabled: boolean) => {
    setNotice(null);
    setProject((prev) => ({ ...prev, triage_enabled: enabled ? 1 : 0 }));
    const updated = await api<TrackProjectRow>(`/api/track/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triageEnabled: enabled }),
    }).catch(() => null);
    if (updated) {
      setProject(updated);
      return;
    }
    // Falló: se vuelve al valor anterior y se avisa.
    setProject((prev) => ({ ...prev, triage_enabled: enabled ? 0 : 1 }));
    setNotice(t('triage.toggleError'));
  };

  const initialProjects = useMemo<TrackProjectMeta[]>(
    () => [{ id: project.id, name: project.name, icon: project.icon, statuses, members }],
    [project.id, project.name, project.icon, statuses, members],
  );
  const team = useMemo<TrackListTeam>(
    () => ({
      projectId,
      href,
      cycles,
      milestones: milestones.map((m) => ({ id: m.id, name: m.name })),
      templates,
      views: initialViews,
      estimateScale: (project as TrackProjectRow & { estimate_scale?: string }).estimate_scale,
    }),
    [projectId, href, cycles, milestones, templates, initialViews, project],
  );
  const extraParams = useMemo(() => (tab === 'triage' ? { tab: 'triage' } : undefined), [tab]);

  const current = activeCycle(cycles, today);
  const nextMilestone = upcomingMilestone(milestones, today);
  const showTriageTab = Boolean(project.triage_enabled) || triageIssues.length > 0;

  return (
    <div className="app-page track-page" data-track-project-id={project.id}>
      <header className="track-team-head">
        <nav className="track-team-crumbs" aria-label={tt('teams')}>
          <Link href={TEAMS_PATH} className="track-team-crumb">
            {tt('teams')}
          </Link>
          <span aria-hidden className="track-team-crumb-sep">
            ›
          </span>
          <h1 className="track-team-name">
            {project.icon ? <span className="track-project-icon">{project.icon}</span> : null}
            {project.name}
          </h1>
          {current && (
            <span className="track-team-meta" data-testid="track-active-cycle">
              <TrackIcon name="cycle" size={11} />
              {t('project.activeCycleMeta', {
                name: current.name,
                done: current.done ?? 0,
                total: current.total ?? 0,
                end: formatDay(current.end_at.slice(0, 10), locale, today),
              })}
            </span>
          )}
          {nextMilestone && (
            <span className="track-team-meta" data-testid="track-next-milestone">
              <TrackIcon name="flag" size={11} />
              {nextMilestone.target_date
                ? t('milestones.headerMeta', {
                    name: nextMilestone.name,
                    done: nextMilestone.done,
                    total: nextMilestone.total,
                    date: formatDay(nextMilestone.target_date, locale, today),
                  })
                : t('milestones.headerMetaNoDate', { name: nextMilestone.name, done: nextMilestone.done, total: nextMilestone.total })}
            </span>
          )}
        </nav>
        <div className="track-team-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
            aria-label={t('project.settings')}
            title={t('project.settings')}
            data-testid="track-project-settings"
          >
            <TrackIcon name="settings" />
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openTrackNewIssue()} title={ui.modal.shortcutHint} aria-keyshortcuts="C">
            {t('project.newIssue')}
            <kbd className="kbd track-kbd" aria-hidden>
              C
            </kbd>
          </button>
        </div>
      </header>

      <TrackIssueList
        scope={{ projectId }}
        viewKey={`team:${projectId}`}
        userId={userId}
        groups={TEAM_GROUPS}
        defaults={TEAM_DEFAULTS}
        layouts={TEAM_LAYOUTS}
        initialProjects={initialProjects}
        team={team}
        canDelete={isAdmin}
        createEnabled={!settingsOpen}
        empty={{ title: t('project.emptyTitle'), body: t('project.emptyBody') }}
        testId="track-team-issues"
        onListTab={() => setTab('issues')}
        extraParams={extraParams}
        onLiveChange={() => {
          void loadTriage();
          refreshProgress();
        }}
        tabsEnd={
          showTriageTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'triage'}
              className={`track-team-tab${tab === 'triage' ? ' is-on' : ''}`}
              onClick={() => setTab('triage')}
              data-testid="track-triage-tab"
            >
              {t('triage.tab')}
              {triageIssues.length > 0 && <span className="track-team-tab-count">{triageIssues.length}</span>}
            </button>
          ) : undefined
        }
        override={
          tab === 'triage' ? (
            <TriagePanel
              projectId={projectId}
              issues={triageIssues}
              statuses={statuses}
              locale={locale}
              onResolved={() => {
                void loadTriage();
                changed();
              }}
            />
          ) : undefined
        }
      />

      {settingsOpen && (
        <ProjectSettingsDrawer
          projectName={project.name}
          projectId={projectId}
          isAdmin={isAdmin}
          onClose={() => setSettingsOpen(false)}
          panels={{
            cycles: (
              <>
                <AutoCyclesSettings
                  project={project}
                  isAdmin={isAdmin}
                  onSaved={async (updated) => {
                    setProject(updated);
                    await reloadCycles();
                  }}
                />
                <CyclesPanel
                  projectId={projectId}
                  cycles={cycles}
                  today={today}
                  onChanged={async () => {
                    await reloadCycles();
                    changed();
                  }}
                />
              </>
            ),
            milestones: (
              <MilestonesPanel
                projectId={projectId}
                milestones={milestones}
                today={today}
                canDelete={isAdmin}
                onChanged={async () => {
                  await reloadMilestones();
                  changed();
                }}
              />
            ),
            templates: <TemplatesPanel projectId={projectId} templates={templates} statuses={statuses} members={members} onChanged={reloadTemplates} />,
            recurring: <RecurringPanel projectId={projectId} rules={recurring} statuses={statuses} members={members} today={today} onChanged={reloadRecurring} />,
            statuses: (
              <StatusesSettings
                projectId={projectId}
                statuses={statuses}
                canDelete={isAdmin}
                onChange={(next, opts) => {
                  setStatuses(next);
                  if (opts?.reloadIssues) changed();
                }}
              />
            ),
            triage: (
              <div className="track-triage-settings">
                <label className="ui-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={Boolean(project.triage_enabled)}
                    disabled={!isAdmin}
                    onChange={(e) => void toggleTriage(e.target.checked)}
                    aria-describedby="track-triage-help"
                    data-testid="track-triage-toggle"
                  />
                  {t('triage.enable')}
                </label>
                <p className="ui-help" id="track-triage-help">
                  {t('triage.enableHelp')}
                </p>
                {!isAdmin && <p className="ui-help">{t('triage.adminOnly')}</p>}
                <TriageSettingsPanel projectId={projectId} isAdmin={isAdmin} members={members} statuses={statuses} />
              </div>
            ),
          }}
        />
      )}

      <TrackToast message={notice} onDismiss={() => setNotice(null)} dismissLabel={ui.inline.dismiss} />
    </div>
  );
}
