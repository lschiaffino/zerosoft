'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import dynamic from 'next/dynamic';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus, TrackProjectMeta } from '@/lib/track-data';
import { EMPTY_FILTERS, normalizeFilter } from '@/lib/track-filter';
import { formatDay, parseQuickTitle, type IssuePatch } from '@/lib/track-tasks';
import {
  BOARD_GROUPS,
  ISSUE_SORTS,
  type BoardGroupBy,
  type GroupPreset,
  type IssueGroupBy,
  type IssueSort,
} from '@/lib/track-views';
import {
  canonicalStatuses,
  expandStatusFilter,
  filterCompleted,
  listQuery,
  readListPrefs,
  remapToCanonical,
  statusForTeam,
  writeListPrefs,
  type ListPrefs,
  type ListScope,
} from '@/lib/track-issue-list';
import EmptyState from '@/components/ui/EmptyState';
import IssueFilters from './IssueFilters';
import IssueDisplayOptions, { type CompletedWindow, type DisplayProp } from './IssueDisplayOptions';
import IssuesTable, { type OptionalColumn } from './IssuesTable';
import GroupedIssuesTable from './GroupedIssuesTable';
import { TrackToast, useToday } from './InlineEditors';
import { useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import { useWorkspaceLabels } from './LabelPicker';
import { rowTargetId, useTrackCommands } from './trackCommands';
import { TRACK_ISSUES_CHANGED } from './TrackBranch';
import { useTrackLive } from './useTrackLive';
import { buildTrackUiLabels } from './ui-labels';
import type { QuickIssueDefaults } from './QuickIssueModal';
import type { ViewType } from './ViewSwitcher';

const IssuesBoard = dynamic(() => import('./IssuesBoard'));
const QuickIssueModal = dynamic(() => import('./QuickIssueModal'));

const PAGE_SIZE = 100;
/** Tope de issues que se traen para agrupar en el cliente (5 páginas). */
const MAX_PAGES = 5;
const LAYOUTS: ViewType[] = ['list', 'board'];
const ALL_PROPS: DisplayProp[] = ['id', 'priority', 'status', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'];

export interface TrackIssueListProps {
  /** De dónde salen los issues: project (planId), Mis issues (mine) o un team (projectId); vacío = todo el workspace. */
  scope: ListScope;
  /** Clave de la vista para recordar filtros y display por persona (localStorage). */
  viewKey: string;
  userId: string;
  /** Agrupados que ofrece la lista. */
  groups: readonly IssueGroupBy[];
  defaults: Partial<ListPrefs> & { group: IssueGroupBy };
  /** Teams con status y miembros; si falta se piden a la API. */
  initialProjects?: TrackProjectMeta[];
  /** Teams donde se crea por defecto (p. ej. los del project); el primero es el elegido. */
  createTeamIds?: string[];
  /** Valores que lleva todo lo creado acá (project, asignado). */
  createDefaults?: { planId?: string; planName?: string; assigneeId?: string };
  /** Milestones del project: agrupar y filtrar por milestone. */
  milestones?: Array<{ id: string; name: string }>;
  /** Pestañas de la página, a la izquierda de Filter y Display (cabecera compacta de Linear). */
  tabs?: ReactNode;
  empty: { title: string; body?: string };
  /** Cantidad de issues cargados (contadores de pestañas). */
  onCount?: (n: number) => void;
  testId?: string;
}

/**
 * Lista de issues compartida (como las de Linear): Filter (F) y Display en
 * la misma fila que las pestañas, lista o tablero, agrupar por status,
 * persona, prioridad, milestone, project, team, cycle o label, ordenar (con
 * Manual para arrastrar), completados (todos, última semana, ninguno),
 * sub-issues, grupos vacíos y propiedades visibles. Filtros y display se
 * recuerdan por vista y por persona. "+" en cada grupo crea el issue con el
 * valor del grupo y el alcance de la vista (p. ej. el project).
 *
 * Las filas y grupos llevan los data-* de TrackIssueDnd (arrastrar entre
 * grupos y reordenar con orden Manual) y la lista se recarga con
 * TRACK_ISSUES_CHANGED.
 */
export default function TrackIssueList({
  scope,
  viewKey,
  userId,
  groups,
  defaults,
  initialProjects,
  createTeamIds,
  createDefaults,
  milestones,
  tabs,
  empty,
  onCount,
  testId = 'track-issue-list',
}: TrackIssueListProps) {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux');
  const tc = useTranslations('track.ux.cmd');
  const tl = useTranslations('track.list');
  const locale = useLocale();
  const router = useRouter();
  const today = useToday();
  const ui = useMemo(() => buildTrackUiLabels((k) => t(k)), [t]);

  const fallback: ListPrefs = useMemo(
    () => ({
      filters: EMPTY_FILTERS,
      group: defaults.group,
      sort: defaults.sort ?? 'manual',
      layout: defaults.layout ?? 'list',
      showSub: defaults.showSub ?? true,
      completed: defaults.completed ?? 'all',
      emptyGroups: defaults.emptyGroups ?? false,
      props: defaults.props ?? ['id', 'priority', 'labels', 'cycle', 'due', 'assignee', 'project'],
    }),
    [defaults.group, defaults.sort, defaults.layout, defaults.showSub, defaults.completed, defaults.emptyGroups, defaults.props],
  );
  const [prefs, setPrefsState] = useState<ListPrefs>(fallback);
  const [prefsReady, setPrefsReady] = useState(false);
  // Lo guardado se lee en el cliente (el server no ve localStorage).
  useEffect(() => {
    setPrefsState(readListPrefs(viewKey, fallback, groups));
    setPrefsReady(true);
  }, [viewKey, fallback, groups]);
  const setPrefs = useCallback(
    (patch: Partial<ListPrefs>) => {
      setPrefsState((cur) => {
        const next = { ...cur, ...patch };
        writeListPrefs(viewKey, next);
        return next;
      });
    },
    [viewKey],
  );

  const [projects, setProjects] = useState<TrackProjectMeta[] | null>(initialProjects ?? null);
  useEffect(() => {
    if (initialProjects) return setProjects(initialProjects);
    let alive = true;
    void fetch('/api/track/projects?meta=1')
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: TrackProjectMeta[] }) => alive && setProjects(d.rows))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [initialProjects]);

  const [labelsList] = useWorkspaceLabels();
  const projectMap = useMemo<ProjectMap>(
    () => Object.fromEntries((projects ?? []).map((p) => [p.id, { ...p, labels: labelsList }])),
    [projects, labelsList],
  );
  const updatedLabel = useCallback(
    (what: string, count: number) => (count === 1 ? tx('undo.updatedOne', { id: what }) : tx('undo.updatedMany', { count })),
    [tx],
  );
  const store = useIssueStore([], projectMap, {
    saveError: ui.inline.saveError,
    createError: ui.inline.createError,
    noDoneStatus: ui.inline.noDoneStatus,
    updated: updatedLabel,
  });
  const { setIssues } = store;

  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [total, setTotal] = useState(0);
  const allStatuses = useMemo(() => (projects ?? []).flatMap((p) => p.statuses), [projects]);
  const query = useMemo(
    () => listQuery(scope, { ...prefs.filters, rules: expandStatusFilter(prefs.filters.rules, allStatuses) }, prefs.sort, today),
    [scope, prefs.filters, prefs.sort, allStatuses, today],
  );
  const seq = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      const mine = ++seq.current;
      if (!quiet) setState((s) => (s === 'ok' ? s : 'loading'));
      try {
        const rows: TrackIssueWithStatus[] = [];
        let count = 0;
        for (let page = 1; page <= MAX_PAGES; page++) {
          const res = await fetch(`/api/track/issues?${query}&page=${page}&pageSize=${PAGE_SIZE}`);
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as { rows: TrackIssueWithStatus[]; total: number };
          rows.push(...data.rows);
          count = data.total;
          if (rows.length >= data.total || data.rows.length < PAGE_SIZE) break;
        }
        if (mine !== seq.current) return;
        setIssues(rows);
        setTotal(count);
        setState('ok');
      } catch {
        if (mine === seq.current) setState('error');
      }
    },
    [query, setIssues],
  );
  useEffect(() => {
    if (prefsReady) void load();
  }, [load, prefsReady]);
  // Cambios de otros (en vivo) y de esta pestaña (arrastres, ⌘K, composer global).
  useTrackLive({ workspace: true }, () => void load(true));
  useEffect(() => {
    const onChanged = () => void load(true);
    window.addEventListener(TRACK_ISSUES_CHANGED, onChanged);
    return () => window.removeEventListener(TRACK_ISSUES_CHANGED, onChanged);
  }, [load]);

  const visible = useMemo(() => filterCompleted(store.issues, prefs.completed, today), [store.issues, prefs.completed, today]);
  useEffect(() => {
    onCount?.(visible.length);
  }, [visible.length, onCount]);

  // Un solo team en la lista: status por id (grupos vacíos, arrastrar entre status). Varios: por nombre.
  const teamIds = useMemo(() => {
    const ids = new Set(store.issues.map((i) => i.project_id));
    for (const id of createTeamIds ?? []) ids.add(id);
    if (scope.projectId) ids.add(scope.projectId);
    return [...ids];
  }, [store.issues, createTeamIds, scope.projectId]);
  const singleTeam = teamIds.length === 1 ? (projects ?? []).find((p) => p.id === teamIds[0]) : undefined;
  const scopeProjects = useMemo(() => {
    const list = (projects ?? []).filter((p) => teamIds.includes(p.id));
    return list.length ? list : (projects ?? []);
  }, [projects, teamIds]);
  const statusOptions = useMemo(() => (singleTeam ? singleTeam.statuses : canonicalStatuses(scopeProjects.flatMap((p) => p.statuses))), [singleTeam, scopeProjects]);
  const members = useMemo(() => {
    const seen = new Map<string, TrackProjectMeta['members'][number]>();
    (projects ?? []).forEach((p) => p.members.forEach((m) => seen.set(m.id, m)));
    return [...seen.values()];
  }, [projects]);
  const cycles = useMemo(() => {
    const seen = new Map<string, TrackCycleRow>();
    for (const i of store.issues) if (i.cycle_id && i.cycle_name) seen.set(i.cycle_id, { id: i.cycle_id, name: i.cycle_name } as TrackCycleRow);
    return [...seen.values()];
  }, [store.issues]);
  const plans = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const i of store.issues) if (i.plan_id && i.plan_name) seen.set(i.plan_id, { id: i.plan_id, name: i.plan_name });
    return [...seen.values()];
  }, [store.issues]);
  const projectNames = useMemo(() => Object.fromEntries((projects ?? []).map((p) => [p.id, p.name])), [projects]);

  // Alta: en el team de la vista (o el primero del project), con el alcance de la vista.
  const defaultTeam = (createTeamIds ?? []).find((id) => projectMap[id]) ?? scope.projectId ?? (projects ?? [])[0]?.id ?? '';
  const quickTeams = useMemo(() => {
    const ids = createTeamIds?.length ? createTeamIds : scope.projectId ? [scope.projectId] : (projects ?? []).map((p) => p.id);
    return (projects ?? []).filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name }));
  }, [createTeamIds, scope.projectId, projects]);
  const create = (projectId: string, draft: IssueDraft) =>
    store.create(projectId, { planId: createDefaults?.planId, assigneeId: createDefaults?.assigneeId, ...draft }, prefs.sort);
  const fromPreset = (preset: GroupPreset, projectId: string): Partial<IssueDraft> => {
    const { statusName, ...rest } = preset;
    const out: Partial<IssueDraft> = { ...rest };
    if (statusName) out.statusId = statusForTeam(projectMap[projectId]?.statuses ?? [], statusName) ?? undefined;
    return out;
  };
  const quickCreate = (raw: string, preset: GroupPreset, projectId: string) => {
    const parsed = parseQuickTitle(raw, today);
    const team = projectId || defaultTeam;
    if (!parsed.title || !team) return;
    const extra = fromPreset(preset, team);
    void create(team, { ...extra, title: parsed.title, priority: parsed.priority ?? extra.priority, dueDate: parsed.dueDate });
  };

  const [composer, setComposer] = useState<QuickIssueDefaults | null>(null);
  const openComposer = (preset: GroupPreset = {}) => {
    const extra = fromPreset(preset, defaultTeam);
    setComposer({
      projectId: defaultTeam || undefined,
      statusId: extra.statusId ?? undefined,
      priority: extra.priority,
      assigneeId: extra.assigneeId ?? createDefaults?.assigneeId,
      planId: extra.planId ?? createDefaults?.planId,
      planName: createDefaults?.planName,
      planMilestoneId: extra.planMilestoneId ?? null,
    });
  };
  useCreateShortcut(() => openComposer(), Boolean(projects?.length) && !composer);

  const editing = {
    projects: projectMap,
    onUpdate: (issueId: string, patch: IssuePatch) => void store.update(issueId, patch),
    onToggleDone: (issue: TrackIssueWithStatus) => void store.toggleDone(issue),
    ui,
    today,
  };

  useTrackCommands({
    lookup: (id) => store.issues.find((i) => i.id === id),
    getTargets: () => {
      const id = rowTargetId();
      const row = id ? store.issues.find((i) => i.id === id) : null;
      return row ? [row] : [];
    },
    data: {
      statuses: allStatuses,
      members,
      labels: labelsList,
      cycles: [],
      milestones: [],
      priorities: ui.priorities,
      meId: userId,
      today,
    },
    handlers: {
      apply: (targets, patch) => void store.updateMany(targets.map((i) => i.id), patch),
      open: (issue) => router.push(`/app/track/issues/${issue.id}`),
    },
    t: (k, v) => tc(k, v),
    formatDay: (iso) => formatDay(iso, locale, today),
  });

  const tableLabels = {
    identifier: t('issues.identifier'),
    title: t('issues.title'),
    status: t('issues.status'),
    priority: t('issues.priority'),
    assignee: t('issues.assignee'),
    cycle: t('issues.cycle'),
    created: t('issues.created'),
    dueDate: t('issues.dueDate'),
    labels: t('issues.labels'),
    noAssignee: t('issues.noAssignee'),
    empty: prefs.filters.rules.length || prefs.filters.q ? t('project.noMatches') : empty.title,
    hasSubtasks: t('subtasks.hasSubtasks'),
    project: t('quick.project'),
  };
  const hidden: OptionalColumn[] = (['id', 'priority', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'] as const).filter(
    (p) => !prefs.props.includes(p),
  );
  if (singleTeam && !hidden.includes('project')) hidden.push('project');
  const listGroup: IssueGroupBy = groups.includes(prefs.group) ? prefs.group : groups[0];
  const boardGroup: BoardGroupBy = (BOARD_GROUPS as readonly string[]).includes(listGroup) ? (listGroup as BoardGroupBy) : 'status';

  // Tablero con varios teams: una columna por nombre de status (el status de cada team se mapea al primero con ese nombre).
  const board = useMemo(() => {
    if (singleTeam) return { issues: visible, statuses: singleTeam.statuses };
    const statuses = canonicalStatuses(scopeProjects.flatMap((p) => p.statuses));
    return { issues: remapToCanonical(visible, statuses), statuses };
  }, [singleTeam, visible, scopeProjects]);
  const onBoardMove = (issueId: string, patch: IssuePatch) => {
    const issue = store.issues.find((i) => i.id === issueId);
    if (!issue) return;
    if (patch.statusId) {
      const name = allStatuses.find((s) => s.id === patch.statusId)?.name ?? '';
      const own = statusForTeam(projectMap[issue.project_id]?.statuses ?? [], name);
      if (!own) return;
      void store.update(issueId, { ...patch, statusId: own });
      return;
    }
    void store.update(issueId, patch);
  };

  const filtersActive = prefs.filters.rules.length > 0 || Boolean(prefs.filters.q);
  const display = (
    <IssueDisplayOptions
      layout={{ value: prefs.layout, options: LAYOUTS, onChange: (v) => setPrefs({ layout: v === 'board' ? 'board' : 'list' }) }}
      group={prefs.layout === 'board' ? boardGroup : listGroup}
      groups={prefs.layout === 'board' ? groups.filter((g) => (BOARD_GROUPS as readonly string[]).includes(g)) : groups}
      sort={prefs.sort}
      onGroupChange={(g) => setPrefs({ group: g })}
      onSortChange={(s) => setPrefs({ sort: (ISSUE_SORTS as readonly string[]).includes(s) ? s : 'manual' })}
      labels={ui.display}
      subIssues={{ show: prefs.showSub, onChange: (v) => setPrefs({ showSub: v }), label: tx('sub.show') }}
      completedWindow={{ value: prefs.completed, onChange: (v: CompletedWindow) => setPrefs({ completed: v }) }}
      emptyGroups={prefs.layout === 'list' ? { show: prefs.emptyGroups, onChange: (v) => setPrefs({ emptyGroups: v }) } : undefined}
      properties={prefs.layout === 'list' ? { visible: prefs.props, available: ALL_PROPS, onChange: (p) => setPrefs({ props: p }) } : undefined}
      onReset={() => {
        setPrefs({ ...fallback, filters: prefs.filters });
      }}
    />
  );

  const body = () => {
    if (state === 'loading' || projects === null) {
      return (
        <div className="track-list-loading" aria-busy="true" aria-label={t('common.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      );
    }
    if (state === 'error') {
      return (
        <EmptyState
          quiet
          title={tl('loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              {tl('retry')}
            </button>
          }
        />
      );
    }
    if (visible.length === 0 && !filtersActive && !prefs.emptyGroups) {
      return (
        <EmptyState
          quiet
          title={empty.title}
          body={empty.body}
          action={
            projects.length ? (
              <button type="button" className="btn btn-sm" onClick={() => openComposer()} data-testid="track-list-new">
                {t('project.newIssue')}
              </button>
            ) : undefined
          }
        />
      );
    }
    if (prefs.layout === 'board') {
      return (
        <IssuesBoard
          issues={board.issues}
          statuses={board.statuses}
          locale={locale}
          onMove={onBoardMove}
          groupBy={boardGroup}
          projectNames={projectNames}
          labels={{ noAssignee: t('issues.noAssignee'), empty: empty.title, noCycle: ui.display.noCycle, noLabel: ui.display.noLabel }}
          editing={{ ...editing, members }}
          onQuickCreate={(title, preset) => quickCreate(title, preset as GroupPreset, defaultTeam)}
          show={prefs.props}
        />
      );
    }
    if (listGroup === 'none') {
      return (
        <IssuesTable
          issues={visible}
          locale={locale}
          labels={tableLabels}
          editing={editing}
          hideColumns={hidden}
          nested={prefs.showSub}
          quickAdd={quickTeams.length ? { onCreate: (text, pid) => quickCreate(text, {}, pid), projects: quickTeams, defaultProjectId: defaultTeam } : undefined}
        />
      );
    }
    return (
      <GroupedIssuesTable
        issues={visible}
        groupBy={listGroup as Exclude<IssueGroupBy, 'none'>}
        statuses={singleTeam ? (singleTeam.statuses as TrackStatusRow[]) : undefined}
        statusByName={!singleTeam}
        projectNames={projectNames}
        locale={locale}
        labels={tableLabels}
        groupLabels={{ ...ui.display, noMilestone: tl('noMilestone'), noProject: tl('noProject') }}
        priorities={ui.priorities}
        editing={editing}
        hideColumns={hidden}
        nested={prefs.showSub}
        milestones={milestones}
        showEmpty={prefs.emptyGroups}
        quickAddProjects={quickTeams}
        onQuickCreate={(text, preset, pid) => quickCreate(text, preset, pid)}
        onAddInGroup={(preset) => openComposer(preset)}
      />
    );
  };

  return (
    <div className="track-issue-list" data-testid={testId}>
      <div className="track-list-head">
        {tabs && <div className="track-list-tabs">{tabs}</div>}
        <div className="track-list-tools">
          <IssueFilters
            filters={prefs.filters}
            onChange={(f) => setPrefs({ filters: normalizeFilter(f) })}
            onSaveView={() => undefined}
            viewClean
            statuses={statusOptions as TrackStatusRow[]}
            priorities={ui.priorities}
            members={members}
            cycles={cycles}
            milestones={milestones}
            teams={scope.projectId ? [] : (projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
            plans={scope.planId ? [] : plans}
            issueLabels={labelsList}
            labels={{
              status: t('filters.status'),
              priority: t('filters.priority'),
              assignee: t('filters.assignee'),
              cycle: t('filters.cycle'),
              labels: t('filters.labels'),
              dueDate: t('filters.dueDate'),
              search: t('filters.search'),
              clear: t('filters.clear'),
              saveView: t('savedViews.save'),
              filter: t('filters.button'),
              done: t('filters.done'),
            }}
            trailing={display}
          />
        </div>
      </div>
      <div className="track-view" data-track-sort={prefs.sort} data-testid={`${testId}-view`}>
        {body()}
      </div>
      {state === 'ok' && total > store.issues.length && (
        <p className="ui-help track-list-more" role="status">
          {tl('showingFirst', { shown: store.issues.length, total })}
        </p>
      )}
      {composer && projects && (
        <QuickIssueModal
          open
          onClose={() => setComposer(null)}
          projects={scopeProjects.length ? scopeProjects.map((p) => projectMap[p.id] ?? { ...p }) : []}
          defaults={composer}
          onCreate={create}
          meId={userId}
          labels={ui}
          today={today}
        />
      )}
      <TrackToast message={store.error} onDismiss={store.clearError} dismissLabel={ui.inline.dismiss} />
    </div>
  );
}

