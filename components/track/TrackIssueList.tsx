'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import dynamic from 'next/dynamic';
import type { TrackCycleRow, TrackIssueTemplateRow, TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus, TrackProjectMeta } from '@/lib/track-data';
import type { TrackSavedView } from '@/lib/track-ux';
import { EMPTY_FILTERS, normalizeFilter } from '@/lib/track-filter';
import { formatDay, inversePatch, parseQuickTitle, type IssuePatch } from '@/lib/track-tasks';
import {
  BOARD_GROUPS,
  ISSUE_SORTS,
  STATUS_NAME_KEY,
  TEAM_SCOPES,
  scopeStatusIds,
  type BoardGroupBy,
  type GroupPreset,
  type IssueGroupBy,
  type TeamScope,
} from '@/lib/track-views';
import {
  canonicalStatuses,
  countsByStatusName,
  expandStatusFilter,
  filterCompleted,
  listQuery,
  readListPrefs,
  remapToCanonical,
  stateFromParams,
  stateToParams,
  statusForTeam,
  viewPayload,
  viewSignature,
  viewToState,
  writeListPrefs,
  type ListLayout,
  type ListPrefs,
  type ListScope,
  type ViewState,
} from '@/lib/track-issue-list';
import EmptyState from '@/components/ui/EmptyState';
import IssueFilters from './IssueFilters';
import IssueDisplayOptions, { type CompletedWindow, type DisplayProp } from './IssueDisplayOptions';
import IssuesTable, { type OptionalColumn } from './IssuesTable';
import GroupedIssuesTable from './GroupedIssuesTable';
import SavedViewsMenu from './SavedViewsMenu';
import TrackIcon from './TrackIcon';
import { BulkBar, useIssueSelection } from './BulkEdit';
import { TrackToast, useToday } from './InlineEditors';
import { useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import { labelsForTeam, useWorkspaceLabels } from './LabelPicker';
import { rowTargetId, useTrackCommands } from './trackCommands';
import { pushNotice, pushUndo, scheduleDelete } from './trackUndo';
import { TRACK_ISSUES_CHANGED } from './TrackBranch';
import { useTrackLive } from './useTrackLive';
import { useIssuePages } from './useIssuePages';
import { useListViews, type ListViewsSource } from './useListViews';
import { buildTrackUiLabels } from './ui-labels';
import type { QuickIssueDefaults } from './QuickIssueModal';

const IssuesBoard = dynamic(() => import('./IssuesBoard'));
const IssuesCalendar = dynamic(() => import('./IssuesCalendar'));
const IssuesGantt = dynamic(() => import('./IssuesGantt'));
const QuickIssueModal = dynamic(() => import('./QuickIssueModal'));
const SaveViewDialog = dynamic(() => import('./SaveViewDialog'));

const ALL_PROPS: DisplayProp[] = ['id', 'priority', 'status', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'];
const SUBGROUP_SEP = '\u0001';
const DEFAULT_LAYOUTS: readonly ListLayout[] = ['list', 'board'];

/** Lo que la lista de un team suma a la lista común (Linear: la vista de un team). */
export interface TrackListTeam {
  projectId: string;
  /** URL de la página del team (/app/track/team/WEB): la vista se refleja en la URL. */
  href: string;
  cycles: Array<{ id: string; name: string; start_at: string; end_at: string }>;
  milestones: Array<{ id: string; name: string }>;
  templates: TrackIssueTemplateRow[];
  /** Vistas del team (las mías y las de equipo), del server. */
  views: TrackSavedView[];
  estimateScale?: string;
}

export interface TrackIssueListProps {
  /** De dónde salen los issues: project (planId), Mis issues (mine) o un team (projectId); vacío = todo el workspace. */
  scope: ListScope;
  /** Clave de la vista para recordar filtros y display por persona (localStorage) y sus vistas guardadas. */
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
  /** Cantidad de issues (contadores de pestañas). */
  onCount?: (n: number) => void;
  testId?: string;
  /** Diseños que ofrece Display (por defecto lista y tablero). */
  layouts?: readonly ListLayout[];
  /** Borrar en masa y con ⌘⌫ (owner/admin). */
  canDelete?: boolean;
  /** Vista de un team: pestañas All / Active / Backlog, vistas del team, calendario, cronograma y la URL. */
  team?: TrackListTeam;
  /** Vistas guardadas personales (listas que no son de un team). */
  personalViews?: boolean;
  /** Algo que reemplaza la lista (p. ej. Triage del team), con las pestañas a la vista. */
  override?: ReactNode;
  /** Pestañas al final de las del team (Triage). */
  tabsEnd?: ReactNode;
  /** Se eligió una pestaña de la lista (sale de lo que muestre `override`). */
  onListTab?: () => void;
  /** Params propios de la página que se mantienen en la URL (tab=triage). */
  extraParams?: Record<string, string>;
  /** Cambios de otros (en vivo): la página recarga lo suyo. */
  onLiveChange?: () => void;
  /** C abre el composer (no con un panel encima). */
  createEnabled?: boolean;
}

/**
 * Lista de issues compartida (como las de Linear), la misma en un team, un
 * project, My issues e Issues: Filter (F) y Display en la misma fila que las
 * pestañas; lista, tablero, calendario o cronograma; agrupar y sub-agrupar
 * con el total real de cada grupo (del server) y "Load more" sin tope;
 * ordenar (Manual para arrastrar); completados; vistas guardadas; selección
 * múltiple (X, Shift o ⌘ clic, en la lista y el tablero) con la barra de
 * abajo; atajos de una tecla y ⌘K; deshacer; cambios en vivo.
 *
 * Las filas, cards y grupos llevan los data-* de TrackIssueDnd (arrastrar a
 * grupos, columnas y al sidebar, reordenar con orden Manual) y la lista se
 * recarga con TRACK_ISSUES_CHANGED.
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
  layouts = DEFAULT_LAYOUTS,
  canDelete = false,
  team,
  personalViews = true,
  override,
  tabsEnd,
  onListTab,
  extraParams,
  onLiveChange,
  createEnabled = true,
}: TrackIssueListProps) {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux');
  const tc = useTranslations('track.ux.cmd');
  const tt = useTranslations('track.ux.team');
  const tl = useTranslations('track.list');
  const tn = useTranslations('trackList');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialParams = useRef(searchParams);
  const today = useToday();
  const ui = useMemo(() => buildTrackUiLabels((k) => t(k)), [t]);
  const [notice, setNotice] = useState<string | null>(null);

  // ---------- Preferencias (filtros y display) y vista guardada activa ----------

  const fallback: ListPrefs = useMemo(
    () => ({
      filters: EMPTY_FILTERS,
      group: defaults.group,
      subGroup: defaults.subGroup ?? 'none',
      sort: defaults.sort ?? 'manual',
      layout: defaults.layout ?? 'list',
      showSub: defaults.showSub ?? true,
      completed: defaults.completed ?? 'all',
      emptyGroups: defaults.emptyGroups ?? false,
      props: defaults.props ?? ['id', 'priority', 'labels', 'cycle', 'due', 'assignee', 'project'],
    }),
    [defaults.group, defaults.subGroup, defaults.sort, defaults.layout, defaults.showSub, defaults.completed, defaults.emptyGroups, defaults.props],
  );
  const [prefs, setPrefsState] = useState<ListPrefs>(fallback);
  const [prefsReady, setPrefsReady] = useState(false);
  const [teamScope, setTeamScope] = useState<TeamScope>('all');
  const [activeViewId, setActiveViewId] = useState<string | undefined>();
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

  const viewsSource: ListViewsSource | null = team ? { kind: 'team', projectId: team.projectId } : personalViews ? { kind: 'personal', key: viewKey } : null;
  const lv = useListViews(viewsSource, userId, team?.views, {
    saved: tx('views.saved'),
    sharedOn: tx('views.sharedOn'),
    sharedOff: tx('views.sharedOff'),
  });

  const stateOf = (p: ListPrefs): ViewState => ({
    layout: p.layout,
    filters: p.filters,
    group: p.group,
    subGroup: p.subGroup ?? 'none',
    sort: p.sort,
    showSub: p.showSub,
    completed: p.completed,
  });
  const applyView = useCallback(
    (base: ListPrefs, view: TrackSavedView): ListPrefs => {
      const s = viewToState(view, groups, fallback.group);
      return { ...base, ...s, layout: layouts.includes(s.layout) ? s.layout : 'list' };
    },
    [groups, fallback.group, layouts],
  );

  // Al abrir: ?savedView= (link compartido o favorita) › estado en la URL (team) › vista por defecto (team) › lo recordado.
  useEffect(() => {
    if (prefsReady) return;
    const sp = initialParams.current;
    const linked = sp.get('savedView');
    if ((linked || team) && !lv.ready) return;
    let next = readListPrefs(viewKey, fallback, groups);
    if (!layouts.includes(next.layout)) next = { ...next, layout: 'list' };
    let nextScope: TeamScope = 'all';
    let active: string | undefined;
    const linkedView = linked ? lv.views.find((v) => v.id === linked) : undefined;
    const fromUrl = team ? stateFromParams(sp, groups) : null;
    if (linkedView) {
      next = applyView(next, linkedView);
      active = linkedView.id;
    } else if (fromUrl) {
      const { scope: s, ...rest } = fromUrl;
      next = { ...next, ...rest };
      if (rest.layout && !layouts.includes(rest.layout)) next.layout = 'list';
      nextScope = s ?? 'all';
    } else if (team) {
      const def = lv.views.find((v) => v.is_default);
      if (def) {
        next = applyView(next, def);
        active = def.id;
      }
    }
    setPrefsState(next);
    setTeamScope(nextScope);
    setActiveViewId(active);
    setPrefsReady(true);
  }, [prefsReady, lv.ready, lv.views, viewKey, fallback, groups, layouts, team, applyView]);

  const activeView = lv.views.find((v) => v.id === activeViewId);
  const viewDirty = activeView ? viewSignature(stateOf(prefs)) !== viewSignature(stateOf(applyView(prefs, activeView))) : false;

  const selectView = (view: TrackSavedView) => {
    onListTab?.();
    setTeamScope('all');
    setPrefs(applyView(prefs, view));
    setActiveViewId(view.id);
  };

  // Una vista abierta desde el sidebar (favoritas) con la página ya cargada.
  const linkedView = searchParams.get('savedView');
  useEffect(() => {
    if (!prefsReady || !linkedView || linkedView === activeViewId) return;
    const found = lv.views.find((v) => v.id === linkedView);
    if (found) selectView(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedView, lv.views, prefsReady]);

  // ---------- Teams, miembros y labels ----------

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

  const [labelsList] = useWorkspaceLabels(Boolean(team));
  const projectMap = useMemo<ProjectMap>(
    () =>
      Object.fromEntries(
        (projects ?? []).map((p) => [
          p.id,
          {
            ...p,
            labels: labelsList,
            ...(team && p.id === team.projectId ? { cycles: team.cycles, milestones: team.milestones, templates: team.templates } : {}),
          },
        ]),
      ),
    [projects, labelsList, team],
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
  const allStatuses = useMemo(() => (projects ?? []).flatMap((p) => p.statuses), [projects]);

  // ---------- Agrupado y consulta ----------

  const listGroup: IssueGroupBy = groups.includes(prefs.group) ? prefs.group : groups[0];
  const boardGroups = groups.filter((g) => (BOARD_GROUPS as readonly string[]).includes(g)) as BoardGroupBy[];
  const boardGroup: BoardGroupBy = (boardGroups as readonly string[]).includes(listGroup) ? (listGroup as BoardGroupBy) : 'status';
  const subGroup: IssueGroupBy =
    prefs.layout === 'list' && listGroup !== 'none' && prefs.subGroup && prefs.subGroup !== listGroup && groups.includes(prefs.subGroup) ? prefs.subGroup : 'none';
  const countGroup: IssueGroupBy = prefs.layout === 'list' ? listGroup : prefs.layout === 'board' ? boardGroup : 'none';

  const teamStatuses = team ? (projectMap[team.projectId]?.statuses ?? []) : [];
  const scopeIds = team ? scopeStatusIds(teamStatuses, teamScope, true) : null;
  const scopeKey = scopeIds?.join(',') ?? '';
  const query = useMemo(
    () =>
      listQuery(scope, { ...prefs.filters, rules: expandStatusFilter(prefs.filters.rules, allStatuses) }, prefs.sort, today, {
        statusIds: scopeKey ? scopeKey.split(',') : null,
        topLevel: !prefs.showSub,
        groupBy: countGroup,
        subGroupBy: subGroup,
        completed: prefs.completed,
      }),
    [scope, prefs.filters, prefs.sort, prefs.showSub, prefs.completed, allStatuses, today, scopeKey, countGroup, subGroup],
  );
  const issuesRef = useRef(store.issues);
  issuesRef.current = store.issues;
  const pages = useIssuePages(query, setIssues, { enabled: prefsReady && projects !== null, loaded: () => issuesRef.current.length });
  const { reload } = pages;

  // Cambios de otros (en vivo) y de esta pestaña (arrastres, ⌘K, composer global).
  const liveRef = useRef(onLiveChange);
  liveRef.current = onLiveChange;
  useTrackLive(
    scope.projectId ? { projectId: scope.projectId } : { workspace: true },
    () => {
      void reload();
      liveRef.current?.();
    },
    { enabled: prefsReady },
  );
  useEffect(() => {
    const onChanged = () => void reload();
    window.addEventListener(TRACK_ISSUES_CHANGED, onChanged);
    return () => window.removeEventListener(TRACK_ISSUES_CHANGED, onChanged);
  }, [reload]);

  const visible = useMemo(() => filterCompleted(store.issues, prefs.completed, today), [store.issues, prefs.completed, today]);
  const shownTotal = pages.hasMore ? pages.total : visible.length;
  useEffect(() => {
    onCount?.(shownTotal);
  }, [shownTotal, onCount]);

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
    if (team) return team.cycles as unknown as TrackCycleRow[];
    const seen = new Map<string, TrackCycleRow>();
    for (const i of store.issues) if (i.cycle_id && i.cycle_name) seen.set(i.cycle_id, { id: i.cycle_id, name: i.cycle_name } as TrackCycleRow);
    return [...seen.values()];
  }, [store.issues, team]);
  const plans = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const i of store.issues) if (i.plan_id && i.plan_name) seen.set(i.plan_id, { id: i.plan_id, name: i.plan_name });
    return [...seen.values()];
  }, [store.issues]);
  const projectNames = useMemo(() => Object.fromEntries((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  const cmdLabels = useMemo(() => (team ? labelsForTeam(labelsList, team.projectId) : labelsList), [labelsList, team]);
  const filterMilestones = milestones ?? team?.milestones;

  // Totales del server con las claves de los grupos (status de varios teams: por nombre).
  const byName = !singleTeam;
  const keyFor = useCallback(
    (field: IssueGroupBy, raw: string) => {
      if (field !== 'status' || !byName) return raw;
      const name = allStatuses.find((s) => s.id === raw)?.name;
      return name !== undefined ? `${STATUS_NAME_KEY}${name.toLowerCase()}` : raw;
    },
    [byName, allStatuses],
  );
  const groupCounts = useMemo(() => {
    const raw = pages.counts.groupCounts;
    if (!pages.hasMore || !raw) return undefined;
    if (countGroup === 'status' && byName) return countsByStatusName(raw, allStatuses, STATUS_NAME_KEY);
    return raw;
  }, [pages.hasMore, pages.counts.groupCounts, countGroup, byName, allStatuses]);
  const subCounts = useMemo(() => {
    const raw = pages.counts.subGroupCounts;
    if (!pages.hasMore || !raw || subGroup === 'none') return undefined;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(raw)) {
      const [g, s] = k.split(SUBGROUP_SEP);
      const key = `${keyFor(listGroup, g)}${SUBGROUP_SEP}${keyFor(subGroup, s ?? '')}`;
      out[key] = (out[key] ?? 0) + n;
    }
    return out;
  }, [pages.hasMore, pages.counts.subGroupCounts, subGroup, listGroup, keyFor]);

  // ---------- Selección, borrar y edición masiva ----------

  const orderedIds = useMemo(() => visible.map((i) => i.id), [visible]);
  const selection = useIssueSelection(orderedIds);

  // Borrar con ventana para deshacer (barra, ⌘K o ⌘⌫): salen de la lista al
  // instante y el DELETE se manda cuando vence el toast.
  const deleteIssues = (ids: string[]) => {
    if (ids.length === 0) return;
    const snapshot = store.issues;
    const gone = new Set(ids);
    setIssues((list) => list.filter((i) => !gone.has(i.id)));
    pages.adjustTotal(-ids.length);
    selection.clear();
    const first = snapshot.find((i) => i.id === ids[0]);
    scheduleDelete({
      ids,
      label: ids.length === 1 ? tx('undo.deleted', { id: first?.identifier ?? '' }) : tx('undo.deletedMany', { count: ids.length }),
      commit: async (keepalive) => {
        const res = await fetch('/api/track/issues/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', issueIds: ids }),
          keepalive,
        }).catch(() => null);
        if (!res?.ok) setNotice(t('bulk.error'));
      },
      restore: () => {
        setIssues(snapshot);
        pages.adjustTotal(ids.length);
      },
    });
  };

  // ---------- Alta ----------

  // En el team de la vista (o el primero del project), con el alcance de la vista.
  const defaultTeam = (createTeamIds ?? []).find((id) => projectMap[id]) ?? scope.projectId ?? (projects ?? [])[0]?.id ?? '';
  const quickTeams = useMemo(() => {
    const ids = createTeamIds?.length ? createTeamIds : scope.projectId ? [scope.projectId] : (projects ?? []).map((p) => p.id);
    return (projects ?? []).filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name }));
  }, [createTeamIds, scope.projectId, projects]);
  const create = (projectId: string, draft: IssueDraft) =>
    store.create(projectId, { planId: createDefaults?.planId, assigneeId: createDefaults?.assigneeId, ...draft }, prefs.sort).then((created) => {
      if (created) pages.adjustTotal(1);
      return created;
    });
  const fromPreset = (preset: GroupPreset, projectId: string): Partial<IssueDraft> => {
    const { statusName, ...rest } = preset;
    const out: Partial<IssueDraft> = { ...rest };
    if (statusName) {
      const category = allStatuses.find((s) => s.name.toLowerCase() === statusName.toLowerCase())?.category;
      out.statusId = statusForTeam(projectMap[projectId]?.statuses ?? [], statusName, category) ?? undefined;
    }
    return out;
  };
  const quickCreate = (raw: string, preset: GroupPreset, projectId: string) => {
    const parsed = parseQuickTitle(raw, today);
    const teamId = projectId || defaultTeam;
    if (!parsed.title || !teamId) return;
    const extra = fromPreset(preset, teamId);
    void create(teamId, { ...extra, title: parsed.title, priority: parsed.priority ?? extra.priority, dueDate: parsed.dueDate });
  };

  const [composer, setComposer] = useState<QuickIssueDefaults | null>(null);
  const openComposer = (preset: GroupPreset = {}, more: Partial<QuickIssueDefaults> = {}) => {
    const teamId = more.projectId ?? defaultTeam;
    const extra = fromPreset(preset, teamId);
    setComposer({
      projectId: teamId || undefined,
      statusId: extra.statusId ?? undefined,
      priority: extra.priority,
      assigneeId: extra.assigneeId ?? createDefaults?.assigneeId,
      planId: extra.planId ?? createDefaults?.planId,
      planName: createDefaults?.planName,
      planMilestoneId: extra.planMilestoneId ?? null,
      ...more,
    });
  };
  useCreateShortcut(() => openComposer(), Boolean(projects?.length) && !composer && createEnabled && !override);

  const editing = {
    projects: projectMap,
    onUpdate: (issueId: string, patch: IssuePatch) => void store.update(issueId, patch),
    onToggleDone: (issue: TrackIssueWithStatus) => void store.toggleDone(issue),
    ui,
    today,
  };

  // ---------- ⌘K y atajos de una tecla (selección › fila activa › bajo el mouse) ----------

  useTrackCommands({
    enabled: prefsReady && !override,
    lookup: (id) => store.issues.find((i) => i.id === id),
    getTargets: () => {
      if (selection.selected.size > 0) return store.issues.filter((i) => selection.selected.has(i.id));
      const id = rowTargetId();
      const row = id ? store.issues.find((i) => i.id === id) : null;
      return row ? [row] : [];
    },
    data: {
      statuses: allStatuses,
      members,
      labels: cmdLabels,
      cycles: team ? team.cycles : [],
      milestones: team ? team.milestones : [],
      priorities: ui.priorities,
      meId: userId,
      today,
      estimateScale: team?.estimateScale,
    },
    handlers: {
      apply: (targets, patch) => void store.updateMany(targets.map((i) => i.id), patch),
      // ⌘⇧O sobre una fila: el composer con el padre, encima de la lista (sin navegar), como Linear.
      createSubIssue: (parent) =>
        openComposer({}, { projectId: parent.project_id, parentId: parent.id, parentLabel: parent.identifier, priority: parent.priority }),
      remove: canDelete ? (targets) => deleteIssues(targets.map((i) => i.id)) : undefined,
      open: (issue) => router.push(`/app/track/issues/${issue.id}`),
      // Mover de team y archivar sacan los issues de esta lista (como en Linear).
      moveToTeam: (targets, teamId) =>
        void (async () => {
          let last: { identifier: string } | null = null;
          for (const target of targets) {
            const res = await fetch(`/api/track/issues/${target.id}/move`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teamId }),
            }).catch(() => null);
            if (res?.ok) last = (await res.json()) as { identifier: string };
          }
          selection.clear();
          await reload();
          if (last) pushNotice(tx('side.moved', { team: last.identifier.replace(/-\d+$/, ''), id: last.identifier }));
          else setNotice(tx('side.moveError'));
        })(),
      archive: (targets) =>
        void (async () => {
          const ids = targets.map((i) => i.id);
          const res = await fetch('/api/track/archive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ issueIds: ids, archive: true }),
          }).catch(() => null);
          if (!res?.ok) {
            setNotice(t('errors.generic'));
            return;
          }
          selection.clear();
          await reload();
          pushUndo(tx('side.archivedNotice', { id: targets.length === 1 ? targets[0].identifier : String(targets.length) }), async () => {
            await fetch('/api/track/archive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ issueIds: ids }),
            }).catch(() => null);
            await reload();
          });
        })(),
    },
    t: (k, v) => tc(k, v),
    formatDay: (iso) => formatDay(iso, locale, today),
  });

  // ⌘B alterna lista y tablero, como en Linear.
  useEffect(() => {
    if (!layouts.includes('board')) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      setPrefsState((cur) => {
        const next = { ...cur, layout: (cur.layout === 'board' ? 'list' : 'board') as ListLayout };
        writeListPrefs(viewKey, next);
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layouts, viewKey]);

  // ---------- URL del team ----------

  const extraKey = JSON.stringify(extraParams ?? {});
  useEffect(() => {
    if (!team || !prefsReady) return;
    const sp = stateToParams({ ...stateOf(prefs), scope: teamScope }, { group: fallback.group, sort: fallback.sort });
    // El link de la vista solo mientras no se cambió nada (si no, mandan los filtros).
    if (activeViewId && !viewDirty) sp.set('savedView', activeViewId);
    for (const [k, v] of Object.entries(JSON.parse(extraKey) as Record<string, string>)) sp.set(k, v);
    const qs = sp.toString();
    if (window.location.search.replace(/^\?/, '') === qs) return;
    router.replace(`${team.href}?${qs}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.href, prefsReady, prefs, teamScope, activeViewId, viewDirty, extraKey]);

  // ---------- Vistas guardadas ----------

  const [saveOpen, setSaveOpen] = useState(false);
  const viewAction = (fn: () => Promise<unknown>) => {
    fn().catch(() => setNotice(t('errors.generic')));
  };
  const viewHref = team?.href ?? (typeof window === 'undefined' ? '' : window.location.pathname.replace(/^\/(en|es|pt)(?=\/)/, ''));
  const savedViewsMenu = viewsSource ? (
    <SavedViewsMenu
      views={lv.views}
      activeViewId={activeViewId}
      userId={userId}
      dirty={viewDirty}
      personal={!team}
      onSelect={selectView}
      onSetDefault={(id) =>
        viewAction(async () => {
          await lv.setDefault(id);
          setActiveViewId(id);
        })
      }
      onRename={(id, name) => viewAction(() => lv.rename(id, name))}
      onDelete={(id) =>
        viewAction(async () => {
          await lv.remove(id);
          if (activeViewId === id) setActiveViewId(undefined);
        })
      }
      onToggleShared={(id, shared) => viewAction(() => lv.setShared(id, shared))}
      onToggleFavorite={(id, favorite) => viewAction(() => lv.setFavorite(id, favorite))}
      onUpdate={(id) => viewAction(() => lv.update(id, viewPayload(stateOf(prefs))))}
      onCopyLink={(id) => {
        const url = new URL(`${viewHref}?savedView=${id}`, window.location.origin).toString();
        void navigator.clipboard?.writeText(url).catch(() => undefined);
        pushNotice(tx('views.linkCopied'));
      }}
      defaultOpen={initialParams.current.get('views') === '1'}
      labels={{
        title: t('savedViews.title'),
        empty: t('savedViews.empty'),
        default: t('savedViews.default'),
        rename: t('savedViews.rename'),
        delete: t('savedViews.delete'),
      }}
    />
  ) : null;

  // ---------- Tablero, calendario y cronograma ----------

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
  const availableProps = team ? ALL_PROPS.filter((p) => p !== 'project' && p !== 'status') : ALL_PROPS;
  const hidden: OptionalColumn[] = (['id', 'priority', 'labels', 'cycle', 'due', 'assignee', 'project', 'created'] as const).filter(
    (p) => !prefs.props.includes(p),
  );
  if (singleTeam && !hidden.includes('project')) hidden.push('project');
  // Un team sin cycles no muestra la columna (salvo que se filtre por cycle).
  if (team && team.cycles.length === 0 && !prefs.filters.rules.some((r) => r.field === 'cycle') && !hidden.includes('cycle')) hidden.push('cycle');

  // Tablero con varios teams: una columna por nombre de status (el status de cada team se mapea al primero con ese nombre).
  const board = useMemo(() => {
    if (singleTeam) return { issues: visible, statuses: singleTeam.statuses };
    const statuses = canonicalStatuses(scopeProjects.flatMap((p) => p.statuses));
    return { issues: remapToCanonical(visible, statuses), statuses };
  }, [singleTeam, visible, scopeProjects]);
  const boardCounts = useMemo(() => {
    const raw = pages.counts.groupCounts;
    if (!pages.hasMore || !raw) return undefined;
    if (boardGroup !== 'status' || singleTeam) return raw;
    const named = countsByStatusName(raw, allStatuses, STATUS_NAME_KEY);
    return Object.fromEntries(board.statuses.map((s) => [s.id, named[`${STATUS_NAME_KEY}${s.name.toLowerCase()}`] ?? 0]));
  }, [pages.hasMore, pages.counts.groupCounts, boardGroup, singleTeam, allStatuses, board.statuses]);
  /** Soltar en una columna de status de varios teams: el status con ese nombre en el team de cada issue. */
  const boardPatchFor = (issue: TrackIssueWithStatus, patch: IssuePatch): IssuePatch | null => {
    if (!patch.statusId) return patch;
    const target = allStatuses.find((s) => s.id === patch.statusId);
    const own = statusForTeam(projectMap[issue.project_id]?.statuses ?? [], target?.name ?? '', target?.category);
    return own ? { ...patch, statusId: own } : null;
  };
  const onBoardMoveMany = (ids: string[], patch: IssuePatch) => {
    const ok = ids.filter((id) => {
      const issue = store.issues.find((i) => i.id === id);
      return issue && boardPatchFor(issue, patch);
    });
    if (ok.length) void store.updateMany(ok, (issue) => boardPatchFor(issue, patch) ?? {});
  };

  const handleDatesChange = async (issueId: string, startDate: string, dueDate: string) => {
    const before = store.issues.find((i) => i.id === issueId);
    // Optimista: la barra se queda donde se soltó.
    setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, start_date: startDate, due_date: dueDate } : i)));
    const res = await fetch(`/api/track/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, dueDate }),
    }).catch(() => null);
    if (!res?.ok) {
      if (before) setIssues((prev) => prev.map((i) => (i.id === issueId ? before : i)));
      throw new Error('dates');
    }
    if (before) {
      const inverse = inversePatch(before, { startDate, dueDate });
      pushUndo(tx('undo.updatedOne', { id: before.identifier }), async () => {
        await fetch(`/api/track/issues/${issueId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inverse) }).catch(() => null);
        await reload();
      }, undefined, { silent: true });
    }
  };

  const filtersActive = prefs.filters.rules.length > 0 || Boolean(prefs.filters.q) || teamScope !== 'all' || prefs.completed !== 'all';
  const display = (
    <IssueDisplayOptions
      layout={{ value: prefs.layout, options: layouts, onChange: (v) => setPrefs({ layout: layouts.includes(v as ListLayout) ? (v as ListLayout) : 'list' }) }}
      group={prefs.layout === 'board' ? boardGroup : listGroup}
      groups={prefs.layout === 'board' ? boardGroups : groups}
      subGroup={
        prefs.layout === 'list' && listGroup !== 'none'
          ? {
              value: subGroup,
              options: ['none', ...groups.filter((g) => g !== 'none' && g !== listGroup)] as IssueGroupBy[],
              onChange: (g) => setPrefs({ subGroup: g }),
              label: tn('subGrouping'),
            }
          : undefined
      }
      sort={prefs.sort}
      onGroupChange={(g) => setPrefs({ group: g, ...(g === prefs.subGroup ? { subGroup: 'none' as IssueGroupBy } : {}) })}
      onSortChange={(s) => setPrefs({ sort: (ISSUE_SORTS as readonly string[]).includes(s) ? s : 'manual' })}
      labels={ui.display}
      subIssues={{ show: prefs.showSub, onChange: (v) => setPrefs({ showSub: v }), label: tx('sub.show') }}
      completedWindow={{ value: prefs.completed, onChange: (v: CompletedWindow) => setPrefs({ completed: v }) }}
      emptyGroups={prefs.layout === 'list' ? { show: prefs.emptyGroups, onChange: (v) => setPrefs({ emptyGroups: v }) } : undefined}
      properties={prefs.layout === 'list' || prefs.layout === 'board' ? { visible: prefs.props, available: availableProps, onChange: (p) => setPrefs({ props: p }) } : undefined}
      onReset={() => {
        setPrefs({ ...fallback, filters: prefs.filters, layout: prefs.layout });
      }}
    />
  );

  const loadMore = { onLoad: () => void pages.loadMore(), label: t('project.loadMore'), busy: pages.loadingMore };

  const body = () => {
    if (pages.state === 'loading' || projects === null || !prefsReady) {
      return (
        <div className="track-list-loading" aria-busy="true" aria-label={t('common.loading')}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      );
    }
    if (pages.state === 'error') {
      return (
        <EmptyState
          quiet
          title={tl('loadError')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => void pages.load()}>
              {tl('retry')}
            </button>
          }
        />
      );
    }
    if (visible.length === 0 && !filtersActive && !prefs.emptyGroups && prefs.layout !== 'calendar' && prefs.layout !== 'gantt') {
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
    if (prefs.layout === 'calendar') {
      return (
        <IssuesCalendar
          issues={visible}
          locale={locale}
          labels={{
            prev: t('calendar.prev'),
            next: t('calendar.next'),
            today: t('calendar.today'),
            unscheduled: t('calendar.unscheduled'),
            noAssignee: t('issues.noAssignee'),
          }}
        />
      );
    }
    if (prefs.layout === 'gantt') {
      return (
        <IssuesGantt
          issues={visible}
          statuses={statusOptions as TrackStatusRow[]}
          locale={locale}
          onDatesChange={handleDatesChange}
          labels={{
            prev: t('gantt.prev'),
            next: t('gantt.next'),
            today: t('gantt.today'),
            unscheduled: t('gantt.unscheduled'),
            noAssignee: t('issues.noAssignee'),
            updateError: t('gantt.updateError'),
          }}
        />
      );
    }
    if (prefs.layout === 'board') {
      return (
        <IssuesBoard
          issues={board.issues}
          statuses={board.statuses}
          locale={locale}
          onMove={(id, patch) => onBoardMoveMany([id], patch)}
          onMoveMany={onBoardMoveMany}
          groupBy={boardGroup}
          projectNames={projectNames}
          milestones={milestones}
          statusByName={!singleTeam}
          selection={{ ...selection, label: t('bulk.select') }}
          counts={boardCounts}
          onLoadMore={() => void pages.loadMore()}
          labels={{
            noAssignee: t('issues.noAssignee'),
            empty: empty.title,
            noCycle: ui.display.noCycle,
            noLabel: ui.display.noLabel,
            noMilestone: tl('noMilestone'),
            noProject: tl('noProject'),
            loadMore: t('project.loadMore'),
          }}
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
          selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
          quickAdd={quickTeams.length ? { onCreate: (text, pid) => quickCreate(text, {}, pid), projects: quickTeams.length > 1 ? quickTeams : undefined, defaultProjectId: defaultTeam } : undefined}
        />
      );
    }
    return (
      <GroupedIssuesTable
        issues={visible}
        groupBy={listGroup as Exclude<IssueGroupBy, 'none'>}
        subGroupBy={subGroup}
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
        quickAddProjects={quickTeams.length > 1 ? quickTeams : undefined}
        onQuickCreate={(text, preset, pid) => quickCreate(text, preset, pid)}
        onAddInGroup={(preset) => openComposer(preset)}
        selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
        counts={groupCounts}
        subCounts={subCounts}
        loadMore={loadMore}
      />
    );
  };

  // Scroll infinito: al acercarse al final de la lista se trae la página siguiente.
  const sentinel = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(pages.loadMore);
  loadMoreRef.current = pages.loadMore;
  const infinite = pages.hasMore && !override && (prefs.layout === 'list' || prefs.layout === 'calendar' || prefs.layout === 'gantt');
  useEffect(() => {
    const el = sentinel.current;
    if (!infinite || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMoreRef.current();
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [infinite, store.issues.length]);

  const teamTabs = team ? (
    <div className="track-team-tabs track-list-pagetabs" role="tablist" aria-label={tt('tabs')}>
      {TEAM_SCOPES.map((sc) => {
        const on = !override && !activeViewId && teamScope === sc;
        return (
          <button
            key={sc}
            type="button"
            role="tab"
            aria-selected={on}
            className={`track-team-tab${on ? ' is-on' : ''}`}
            onClick={() => {
              onListTab?.();
              setActiveViewId(undefined);
              setTeamScope(sc);
            }}
            data-testid={`track-scope-${sc}`}
          >
            {tt(sc)}
            {on && pages.state === 'ok' && <span className="track-team-tab-count">{pages.total}</span>}
          </button>
        );
      })}
      {lv.views
        .filter((v) => v.favorite || v.id === activeViewId)
        .map((v) => {
          const on = !override && v.id === activeViewId;
          return (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`track-team-tab${on ? ' is-on' : ''}`}
              onClick={() => selectView(v)}
              data-testid="track-team-view-tab"
            >
              <TrackIcon name="views" size={12} />
              {v.name}
              {on && viewDirty && <span className="track-view-dirty" title={tx('views.unsaved')} aria-label={tx('views.unsaved')} />}
            </button>
          );
        })}
      {tabsEnd}
    </div>
  ) : null;

  return (
    <div className="track-issue-list" data-testid={testId}>
      <div className={`track-list-head${team ? ' is-team' : ''}`}>
        {(tabs || teamTabs) && (
          <div className="track-list-tabs">
            {tabs}
            {teamTabs}
          </div>
        )}
        {!override && (
          <div className="track-list-tools">
            <IssueFilters
              filters={prefs.filters}
              onChange={(f) => setPrefs({ filters: normalizeFilter(f) })}
              onSaveView={() => setSaveOpen(true)}
              viewClean={Boolean(activeView) && !viewDirty}
              updateView={
                activeView && viewDirty && activeView.user_id === userId
                  ? {
                      onUpdate: () => viewAction(() => lv.update(activeView.id, viewPayload(stateOf(prefs)))),
                      updateLabel: tx('views.updateView'),
                      saveAsNewLabel: tx('views.saveAsNew'),
                    }
                  : undefined
              }
              statuses={statusOptions as TrackStatusRow[]}
              priorities={ui.priorities}
              members={members}
              cycles={cycles}
              milestones={filterMilestones}
              teams={scope.projectId ? [] : (projects ?? []).map((p) => ({ id: p.id, name: p.name }))}
              plans={scope.planId ? [] : plans}
              issueLabels={cmdLabels}
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
              trailing={
                <>
                  {savedViewsMenu}
                  {display}
                </>
              }
            />
          </div>
        )}
      </div>
      {override ?? (
        <>
          <div className="track-view" data-track-sort={prefs.sort} data-testid={`${testId}-view`}>
            {body()}
          </div>
          {pages.state === 'ok' && pages.hasMore && (
            <div className="track-pagination track-list-more" ref={sentinel}>
              <p className="track-pagination-count" role="status">
                {t('project.showing', { shown: store.issues.length, total: pages.total })}
              </p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void pages.loadMore()}
                aria-busy={pages.loadingMore || undefined}
                disabled={pages.loadingMore}
                data-testid="track-list-load-more"
              >
                {t('project.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
      {!override && (prefs.layout === 'list' || prefs.layout === 'board') && (
        <BulkBar
          count={selection.selected.size}
          statuses={allStatuses}
          members={members}
          cycles={team ? team.cycles : []}
          labels={cmdLabels}
          priorities={ui.priorities}
          canDelete={canDelete}
          onApply={async () => undefined}
          onDelete={async () => deleteIssues([...selection.selected])}
          onClear={selection.clear}
        />
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
      <SaveViewDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSave={async (name, shared) => {
          const created = await lv.create(name, shared, viewPayload(stateOf(prefs)));
          setSaveOpen(false);
          setActiveViewId(created.id);
        }}
        viewType={prefs.layout}
        filters={prefs.filters}
        labels={{
          title: t('savedViews.saveAs'),
          name: t('savedViews.name'),
          namePlaceholder: t('savedViews.namePlaceholder'),
          save: t('common.save'),
          cancel: t('common.cancel'),
          error: t('errors.generic'),
          ...(team ? { shared: tx('views.shareOnSave'), sharedHelp: tx('views.shareHelp') } : {}),
        }}
      />
      <TrackToast message={store.error} onDismiss={store.clearError} dismissLabel={ui.inline.dismiss} />
      <TrackToast message={store.error ? null : notice} onDismiss={() => setNotice(null)} dismissLabel={ui.inline.dismiss} />
    </div>
  );
}
