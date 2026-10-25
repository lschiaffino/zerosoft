'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { TrackIssueTemplateRow, TrackProjectRow, TrackRecurringIssueRow, TrackStatusRow } from '@/lib/db';
import type { TrackMilestoneWithProgress } from '@/lib/track-milestones';
import { upcomingMilestone } from '@/lib/track-milestone-utils';
import type { IssueLabel } from '@/lib/track-schema';
import type { ViewType } from './ViewSwitcher';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import type { TrackSavedView } from '@/lib/track-ux';
import { encodeFilter, normalizeFilter, type FilterState } from '@/lib/track-filter';
import { formatDay as formatDayLabel, inversePatch, type IssuePatch } from '@/lib/track-tasks';
import { rowTargetId, useTrackCommands } from './trackCommands';
import { pendingDeleteIds, pushNotice, pushUndo, scheduleDelete } from './trackUndo';
import { useTrackLive } from './useTrackLive';
import IssueFilters, { activeFilterCount } from './IssueFilters';
import SavedViewsMenu from './SavedViewsMenu';
import IssuesTable from './IssuesTable';
import type { CycleWithProgress } from './CyclesPanel';
import { TrackToast, useToday } from './InlineEditors';
import { TRACK_NEW_ISSUE_EVENT, useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import { activeCycle, formatDay, parseQuickTitle } from '@/lib/track-tasks';
import EmptyState from '@/components/ui/EmptyState';
import TrackIcon from './TrackIcon';
import type { TrackUiLabels } from './ui-labels';
import { BulkBar, useIssueSelection, type BulkPatch } from './BulkEdit';
import { useWorkspaceLabels } from './LabelPicker';
import IssueDisplayOptions, { readDisplayProps, writeDisplayProps, type DisplayProp } from './IssueDisplayOptions';
import GroupedIssuesTable from './GroupedIssuesTable';
import {
  parseIssueGroup,
  parseIssueSort,
  scopeStatusIds,
  TEAM_SCOPES as SCOPES,
  type BoardGroupBy,
  type GroupPreset,
  type IssueGroupBy,
  type IssueSort,
  type TeamScope,
} from '@/lib/track-views';
import type { QuickIssueDefaults } from './QuickIssueModal';
import type { OptionalColumn } from './IssuesTable';
import { TEAMS_PATH, teamPath } from '@/lib/track-routes';
import dynamic from 'next/dynamic';
// Vistas y paneles que no se ven al entrar (tablero, calendario, Gantt, ajustes,
// alta rápida): cada uno en su chunk, se bajan al abrirlos.
const IssuesBoard = dynamic(() => import('./IssuesBoard'));
const IssuesCalendar = dynamic(() => import('./IssuesCalendar'));
const IssuesGantt = dynamic(() => import('./IssuesGantt'));
const QuickIssueModal = dynamic(() => import('./QuickIssueModal'));
const StatusesSettings = dynamic(() => import('./StatusesSettings'));
const ProjectSettingsDrawer = dynamic(() => import('./ProjectSettingsDrawer'));
const AutoCyclesSettings = dynamic(() => import('./AutoCyclesSettings'));
const MilestonesPanel = dynamic(() => import('./MilestonesPanel'));
const TemplatesPanel = dynamic(() => import('./TemplatesPanel'));
const RecurringPanel = dynamic(() => import('./RecurringPanel'));
const TriagePanel = dynamic(() => import('./TriagePanel'));
const SaveViewDialog = dynamic(() => import('./SaveViewDialog'));
const TriageSettingsPanel = dynamic(() => import('./triage/TriageSettingsPanel'));
const CyclesPanel = dynamic(() => import('./CyclesPanel'));


interface ProjectPageClientProps {
  locale: string;
  projectId: string;
  /** Clave del team (WEB): la URL de la página (/app/track/team/WEB). */
  teamKey?: string;
  userId: string;
  /** Owner/admin del workspace: puede borrar en masa. */
  isAdmin?: boolean;
  labels: PageLabels;
}

export interface PageLabels {
  newIssue: string;
  issues: string;
  cycles: string;
  noIssues: string;
  noAssignee: string;
  loading: string;
  loadMore: string;
  /** Raw ICU template with {shown} and {total} placeholders. */
  showing: string;
  viewSwitcher: {
    list: string;
    board: string;
    calendar: string;
    gantt: string;
  };
  filters: {
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    labels: string;
    dueDate: string;
    search: string;
    clear: string;
    saveView: string;
  };
  savedViews: {
    title: string;
    empty: string;
    default: string;
    rename: string;
    delete: string;
    saveDialogTitle: string;
    saveDialogName: string;
    saveDialogPlaceholder: string;
    save: string;
    cancel: string;
  };
  table: {
    identifier: string;
    title: string;
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    created: string;
    dueDate: string;
    labels: string;
    hasSubtasks: string;
  };
  board: {
    empty: string;
  };
  calendar: {
    prev: string;
    next: string;
    today: string;
    unscheduled: string;
  };
  gantt: {
    prev: string;
    next: string;
    today: string;
    unscheduled: string;
    updateError: string;
  };
  priorities: Array<{ value: string; label: string }>;
  ui: TrackUiLabels;
  settings: string;
  workflowStatuses: string;
}

type SortValue = IssueSort;

/** Agrupados de la lista y del tablero de un proyecto (por proyecto no tiene sentido acá). */
const LIST_GROUPS: IssueGroupBy[] = ['none', 'status', 'assignee', 'priority', 'cycle', 'label'];
const PROJECT_BOARD_GROUPS: BoardGroupBy[] = ['status', 'assignee', 'priority', 'cycle', 'label'];
const LAYOUTS: ViewType[] = ['list', 'board', 'calendar', 'gantt'];
/** Propiedades de fila que se pueden mostrar u ocultar en un team. */
const TEAM_PROPS: DisplayProp[] = ['id', 'priority', 'labels', 'cycle', 'due', 'assignee', 'created'];
const TEAM_DEFAULT_PROPS: DisplayProp[] = ['id', 'priority', 'labels', 'cycle', 'due', 'assignee'];
const PROPS_KEY = 'track:display-props';


// Matches the server-side cap in lib/track-data.ts (listIssues clamps pageSize to 100).
const ISSUES_PAGE_SIZE = 100;

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Filtros → URL (y API): `filter` con las reglas, `q` y el orden. */
function filtersToParams(filters: FilterState, sort: SortValue, statusIds?: string[] | null): URLSearchParams {
  const sp = new URLSearchParams();
  if (statusIds) sp.set('statusId', statusIds.join(','));
  const encoded = encodeFilter(filters);
  if (encoded) sp.set('filter', encoded);
  if (filters.q) sp.set('q', filters.q);
  if (sort !== 'newest') sp.set('sort', sort);
  return sp;
}

/** URL → filtros. Entiende los params viejos (statusId=…&priority=…) de links guardados. */
function paramsToFilters(sp: URLSearchParams): FilterState {
  const legacy: Record<string, unknown> = {};
  for (const key of ['statusId', 'priority', 'assigneeId', 'cycleId', 'labelIds']) {
    const values = sp.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    if (values.length) legacy[key] = values;
  }
  legacy.dueAfter = sp.get('dueAfter') ?? '';
  legacy.dueBefore = sp.get('dueBefore') ?? '';
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(sp.get('filter') ?? '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const n = normalizeFilter({ ...legacy, ...parsed });
  return { ...n, q: sp.get('q') ?? '' };
}

/** Filtros de una vista guardada, separando el agrupado y "sub-issues" que viajan adentro. */
function splitViewFilters(raw: Record<string, unknown>): { filters: FilterState; group: string; showSub: boolean } {
  const { groupBy, subIssues, ...rest } = raw ?? {};
  return {
    filters: normalizeFilter(rest),
    group: typeof groupBy === 'string' ? groupBy : '',
    showSub: subIssues !== 'hide',
  };
}

/** Estado comparable de la vista (para marcar cambios sin guardar). */
function viewKey(v: { view: string; filters: FilterState; group: string; sort: string; showSub: boolean }): string {
  return JSON.stringify([v.view, v.filters.match, v.filters.rules, v.filters.q, v.group, v.sort, v.showSub]);
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`api error ${res.status}`);
  return (await res.json()) as T;
}

export default function ProjectPageClient({ locale, projectId, teamKey, userId, isAdmin = false, labels }: ProjectPageClientProps) {
  const t = useTranslations('track');
  const router = useRouter();
  const searchParams = useSearchParams();
  // La URL se sincroniza con router.replace en cada cambio de vista/filtros;
  // la carga inicial solo mira los params con los que se abrió la página
  // (si dependiera de searchParams recargaría todo, pisando ediciones).
  const initialParams = useRef(searchParams);

  const [project, setProject] = useState<TrackProjectRow | null>(null);
  const [statuses, setStatuses] = useState<TrackStatusRow[]>([]);
  const [cycles, setCycles] = useState<CycleWithProgress[]>([]);
  const [milestones, setMilestones] = useState<TrackMilestoneWithProgress[]>([]);
  const [templates, setTemplates] = useState<TrackIssueTemplateRow[]>([]);
  const [recurring, setRecurring] = useState<TrackRecurringIssueRow[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [views, setViews] = useState<TrackSavedView[]>([]);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issuesPage, setIssuesPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [view, setView] = useState<ViewType>(() => (searchParams.get('view') as ViewType) ?? 'list');
  const [filters, setFilters] = useState<FilterState>(() => paramsToFilters(searchParams));
  const [sort, setSort] = useState<SortValue>(() => parseIssueSort(searchParams.get('sort')));
  // Un solo param `group` en la URL; cada vista lo interpreta con sus opciones
  // (la lista arranca sin agrupar, el tablero por status).
  const [group, setGroup] = useState<string>(() => searchParams.get('group') ?? '');
  const [scope, setScope] = useState<TeamScope>(() => {
    const v = searchParams.get('scope') as TeamScope | null;
    return v && SCOPES.includes(v) ? v : 'all';
  });
  const [showCompleted, setShowCompleted] = useState(() => searchParams.get('done') !== 'hide');
  const [displayProps, setDisplayProps] = useState<DisplayProp[]>(TEAM_DEFAULT_PROPS);
  useEffect(() => setDisplayProps(readDisplayProps(PROPS_KEY, TEAM_DEFAULT_PROPS)), []);
  const changeDisplayProps = (next: DisplayProp[]) => {
    setDisplayProps(next);
    writeDisplayProps(PROPS_KEY, next);
  };
  const [modalDefaults, setModalDefaults] = useState<QuickIssueDefaults | undefined>();
  // "Mostrar sub-issues" (Display options): por defecto sí, debajo de su padre.
  const [showSub, setShowSub] = useState(() => searchParams.get('sub') !== 'hide');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<'issues' | 'triage'>(() => (searchParams.get('tab') === 'triage' ? 'triage' : 'issues'));
  const [triageIssues, setTriageIssues] = useState<TrackIssueWithStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceLabels] = useWorkspaceLabels(true);
  const today = useToday();

  const projectMap = useMemo<ProjectMap>(
    () =>
      project
        ? {
            [project.id]: {
              id: project.id,
              name: project.name,
              icon: project.icon,
              statuses,
              members,
              cycles,
              milestones,
              templates,
            },
          }
        : {},
    [project, statuses, members, cycles, milestones, templates],
  );
  const tx = useTranslations('track.ux');
  const tc = useTranslations('track.ux.cmd');
  const tt = useTranslations('track.ux.team');
  const openComposer = (defaults?: QuickIssueDefaults) => {
    setModalDefaults(defaults);
    setModalOpen(true);
  };
  const updatedLabel = useCallback(
    (what: string, count: number) => (count === 1 ? tx('undo.updatedOne', { id: what }) : tx('undo.updatedMany', { count })),
    [tx],
  );
  const store = useIssueStore([], projectMap, {
    saveError: labels.ui.inline.saveError,
    createError: labels.ui.inline.createError,
    noDoneStatus: labels.ui.inline.noDoneStatus,
    updated: updatedLabel,
  });
  const { issues, setIssues } = store;

  // Filtro por label: los labels del workspace (más los que traigan los issues cargados).
  const issueLabels = useMemo(() => {
    const map = new Map<string, IssueLabel>();
    workspaceLabels.forEach((l) => map.set(l.id, { id: l.id, name: l.name, color: l.color }));
    issues.forEach((i) => parseLabels(i.labels).forEach((l) => map.has(l.id) || map.set(l.id, l)));
    return Array.from(map.values());
  }, [issues, workspaceLabels]);

  const issueIds = useMemo(() => issues.map((i) => i.id), [issues]);
  const selection = useIssueSelection(issueIds);

  // Cada carga de la página 1 invalida las anteriores: si una respuesta vieja
  // (p. ej. la búsqueda "l" mientras ya se tipeó "login") llega tarde, se
  // descarta en vez de pisar la lista.
  const issuesRequest = useRef(0);
  const fetchIssues = useCallback(
    async (page: number, append: boolean) => {
      const seq = append ? issuesRequest.current : ++issuesRequest.current;
      const sp = filtersToParams(filters, sort, scopeStatusIds(statuses, scope, showCompleted));
      sp.set('pageSize', String(ISSUES_PAGE_SIZE));
      sp.set('page', String(page));
      sp.set('today', today);
      if (!showSub) sp.set('topLevel', '1');
      const data = await api<{ rows: TrackIssueWithStatus[]; total: number }>(
        `/api/track/projects/${projectId}/issues?${sp.toString()}`,
      );
      if (seq !== issuesRequest.current) return;
      // Los que tienen un borrado pendiente (con "Deshacer" en pantalla) no se muestran.
      const hidden = pendingDeleteIds();
      const rows = data.rows.filter((r) => !hidden.has(r.id));
      setIssues((prev) => (append ? [...prev, ...rows] : rows));
      setIssuesTotal(Math.max(0, data.total - (data.rows.length - rows.length)));
      setIssuesPage(page);
    },
    [projectId, filters, sort, setIssues, today, showSub, statuses, scope, showCompleted],
  );

  // Vuelve a pedir las páginas ya cargadas (1..issuesPage) sin volver a la
  // primera: después de una edición masiva no se pierde el lugar ni la
  // selección de los issues de más abajo.
  const reloadLoadedPages = useCallback(async () => {
    const seq = ++issuesRequest.current;
    const sp = filtersToParams(filters, sort, scopeStatusIds(statuses, scope, showCompleted));
    sp.set('pageSize', String(ISSUES_PAGE_SIZE));
    sp.set('today', today);
    if (!showSub) sp.set('topLevel', '1');
    const hidden = pendingDeleteIds();
    const pages = await Promise.all(
      Array.from({ length: Math.max(1, issuesPage) }, (_, i) => {
        const q = new URLSearchParams(sp);
        q.set('page', String(i + 1));
        return api<{ rows: TrackIssueWithStatus[]; total: number }>(
          `/api/track/projects/${projectId}/issues?${q.toString()}`,
        );
      }),
    );
    if (seq !== issuesRequest.current) return;
    const seen = new Set<string>();
    const rows: TrackIssueWithStatus[] = [];
    for (const page of pages) {
      for (const row of page.rows) {
        if (seen.has(row.id) || hidden.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    setIssues(rows);
    setIssuesTotal(Math.max(0, pages[pages.length - 1].total - hidden.size));
  }, [projectId, filters, sort, issuesPage, setIssues, today, showSub, statuses, scope, showCompleted]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchIssues(issuesPage + 1, true);
    } catch {
      setNotice(t('errors.generic'));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const [p, s, c, m, v, i] = await Promise.all([
          api<TrackProjectRow>(`/api/track/projects/${projectId}`),
          api<{ rows: TrackStatusRow[] }>(`/api/track/projects/${projectId}/statuses`).then((r) => r.rows),
          api<{ rows: CycleWithProgress[] }>(`/api/track/projects/${projectId}/cycles`).then((r) => r.rows),
          api<{ rows: ProjectMember[] }>(`/api/track/projects/${projectId}/members`).then((r) => r.rows),
          api<{ rows: TrackSavedView[] }>(`/api/track/projects/${projectId}/views`).then((r) => r.rows),
          api<{ rows: TrackIssueWithStatus[]; total: number }>(
            `/api/track/projects/${projectId}/issues?pageSize=${ISSUES_PAGE_SIZE}&page=1`,
          ),
        ]);
        if (!mounted) return;
        setProject(p);
        setStatuses(s);
        setCycles(c);
        setMembers(m);
        setViews(v);
        const hidden = pendingDeleteIds();
        setIssues(i.rows.filter((r) => !hidden.has(r.id)));
        setIssuesTotal(i.total);
        setIssuesPage(1);

        // ?savedView=<id> (link compartido) abre esa vista; si no hay estado
        // en la URL, la vista por defecto de la persona.
        const linked = initialParams.current.get('savedView');
        const hasUrlState =
          initialParams.current.toString().length > 0 &&
          (initialParams.current.get('view') ||
            initialParams.current.get('sort') ||
            initialParams.current.get('group') ||
            initialParams.current.get('filter') ||
            initialParams.current.get('statusId') ||
            initialParams.current.get('priority') ||
            initialParams.current.get('q') ||
            initialParams.current.get('scope') ||
            initialParams.current.get('done'));
        const pick = (linked ? v.find((x) => x.id === linked) : undefined) ?? (!hasUrlState ? v.find((x) => x.is_default) : undefined);
        if (pick) {
          const saved = splitViewFilters(pick.filters);
          setView(pick.view_type);
          setFilters(saved.filters);
          setGroup(saved.group);
          setShowSub(saved.showSub);
          setSort(parseIssueSort(pick.sort));
          setActiveViewId(pick.id);
        }
      } catch {
        if (mounted) setLoadError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [projectId, setIssues, reloadKey]);

  // Con debounce: la búsqueda cambia los filtros en cada tecla.
  useEffect(() => {
    if (loading || loadError) return;
    const timer = setTimeout(() => {
      fetchIssues(1, false).catch(() => setNotice(t('errors.generic')));
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, sort, scope, showCompleted, fetchIssues, loading, loadError, t]);

  const loadTriage = useCallback(async () => {
    const data = await api<{ rows: TrackIssueWithStatus[] }>(`/api/track/projects/${projectId}/triage`).catch(() => null);
    if (data) setTriageIssues(data.rows);
  }, [projectId]);

  useEffect(() => {
    void loadTriage();
  }, [loadTriage]);

  const toggleTriage = async (enabled: boolean) => {
    setNotice(null);
    setProject((prev) => (prev ? { ...prev, triage_enabled: enabled ? 1 : 0 } : prev));
    const updated = await api<TrackProjectRow>(`/api/track/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triageEnabled: enabled }),
    }).catch(() => null);
    if (updated) {
      setProject(updated);
      return;
    }
    // Falló: se vuelve al valor anterior y se avisa (si no, el checkbox
    // queda marcado con el triage apagado en el server).
    setProject((prev) => (prev ? { ...prev, triage_enabled: enabled ? 0 : 1 } : prev));
    setNotice(t('triage.toggleError'));
  };

  // Borrar con ventana para deshacer (selección, ⌘K o ⌘⌫): salen de la lista
  // al instante y el DELETE se manda cuando vence el toast.
  const deleteIssues = (ids: string[]) => {
    if (ids.length === 0) return;
    const snapshot = store.issues;
    const gone = new Set(ids);
    setIssues((list) => list.filter((i) => !gone.has(i.id)));
    setIssuesTotal((n) => Math.max(0, n - ids.length));
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
        setIssuesTotal((n) => n + ids.length);
      },
    });
  };

  const runBulk = async (body: Record<string, unknown>) => {
    const ids = Array.from(selection.selected);
    if (body.action === 'delete') {
      deleteIssues(ids);
      return;
    }
    // Para ⌘Z: cómo estaban los issues antes del cambio masivo.
    const before = store.issues.filter((i) => selection.selected.has(i.id));
    const res = await fetch('/api/track/issues/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, issueIds: ids }),
    }).catch(() => null);
    if (!res?.ok) {
      setNotice(t('bulk.error'));
      return;
    }
    const data = (await res.json()) as { updated: string[]; skipped: unknown[] };
    setNotice(data.skipped.length ? t('bulk.skipped', { count: data.skipped.length }) : null);
    const bulk = (body.patch ?? {}) as BulkPatch;
    const asPatch: IssuePatch = {
      ...(bulk.statusId !== undefined ? { statusId: bulk.statusId } : {}),
      ...(bulk.priority !== undefined ? { priority: bulk.priority as IssuePatch['priority'] } : {}),
      ...(bulk.assigneeId !== undefined ? { assigneeId: bulk.assigneeId } : {}),
      ...(bulk.cycleId !== undefined ? { cycleId: bulk.cycleId } : {}),
      ...(bulk.addLabelIds || bulk.removeLabelIds ? { labels: [] } : {}),
    };
    const updatedIds = new Set(data.updated);
    const undo = before.filter((i) => updatedIds.has(i.id)).map((i) => ({ id: i.id, inverse: inversePatch(i, asPatch) }));
    if (undo.length) {
      pushUndo(tx('undo.updatedMany', { count: undo.length }), async () => {
        await Promise.all(
          undo.map((u) =>
            fetch(`/api/track/issues/${u.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(u.inverse),
            }).catch(() => null),
          ),
        );
        await reloadLoadedPagesRef.current().catch(() => undefined);
      }, async () => {
        await fetch('/api/track/issues/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, issueIds: undo.map((u) => u.id) }),
        }).catch(() => null);
        await reloadLoadedPagesRef.current().catch(() => undefined);
      });
    }
    await reloadLoadedPages().catch(() => setNotice(t('errors.generic')));
  };
  const reloadLoadedPagesRef = useRef(reloadLoadedPages);
  reloadLoadedPagesRef.current = reloadLoadedPages;

  // Cambios de otros (issues, board, triage) sin recargar la página.
  useTrackLive({ projectId }, () => {
    void reloadLoadedPagesRef.current().catch(() => undefined);
    void loadTriage();
  }, { enabled: !loading && !loadError });

  // ⌘K y atajos de una tecla sobre la selección, la fila activa o la del mouse.
  useTrackCommands({
    enabled: !loading && !loadError,
    lookup: (id) => store.issues.find((i) => i.id === id),
    getTargets: () => {
      if (selection.selected.size > 0) return store.issues.filter((i) => selection.selected.has(i.id));
      const id = rowTargetId();
      const row = id ? store.issues.find((i) => i.id === id) : null;
      return row ? [row] : [];
    },
    data: {
      statuses,
      members,
      labels: workspaceLabels,
      cycles,
      milestones: milestones.map((m) => ({ id: m.id, name: m.name })),
      priorities: labels.priorities,
      meId: userId,
      today,
    },
    handlers: {
      apply: (targets, patch) => void store.updateMany(targets.map((i) => i.id), patch),
      createSubIssue: (parent) => router.push(`/app/track/issues/${parent.id}?sub=1`),
      remove: isAdmin ? (targets) => deleteIssues(targets.map((i) => i.id)) : undefined,
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
          await reloadLoadedPagesRef.current().catch(() => undefined);
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
          await reloadLoadedPagesRef.current().catch(() => undefined);
          pushUndo(tx('side.archivedNotice', { id: targets.length === 1 ? targets[0].identifier : String(targets.length) }), async () => {
            await fetch('/api/track/archive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ issueIds: ids }),
            }).catch(() => null);
            await reloadLoadedPagesRef.current().catch(() => undefined);
          });
        })(),
    },
    t: (k, v) => tc(k, v),
    formatDay: (iso) => formatDayLabel(iso, locale, today),
  });

  const reloadMilestones = useCallback(async () => {
    const rows = await api<{ rows: TrackMilestoneWithProgress[] }>(`/api/track/projects/${projectId}/milestones`)
      .then((r) => r.rows)
      .catch(() => null);
    if (rows) setMilestones(rows);
  }, [projectId]);
  const reloadTemplates = useCallback(async () => {
    const rows = await api<{ rows: TrackIssueTemplateRow[] }>(`/api/track/projects/${projectId}/templates`)
      .then((r) => r.rows)
      .catch(() => null);
    if (rows) setTemplates(rows);
  }, [projectId]);
  const reloadRecurring = useCallback(async () => {
    const rows = await api<{ rows: TrackRecurringIssueRow[] }>(`/api/track/projects/${projectId}/recurring`)
      .then((r) => r.rows)
      .catch(() => null);
    if (rows) setRecurring(rows);
  }, [projectId]);
  // Milestones, plantillas y repeticiones no bloquean la carga de la página.
  useEffect(() => {
    void reloadMilestones();
    void reloadTemplates();
    void reloadRecurring();
  }, [reloadMilestones, reloadTemplates, reloadRecurring, reloadKey]);

  const reloadCycles = useCallback(async () => {
    const rows = await api<{ rows: CycleWithProgress[] }>(`/api/track/projects/${projectId}/cycles`)
      .then((r) => r.rows)
      .catch(() => null);
    if (rows) setCycles(rows);
  }, [projectId]);

  // El progreso de los cycles depende del status/cycle de los issues: lo
  // refrescamos (con debounce) cuando cambian.
  const progressSignature = useMemo(
    () => issues.map((i) => `${i.id}:${i.status_id}:${i.cycle_id}:${i.milestone_id ?? ''}`).join('|'),
    [issues],
  );
  const firstSignature = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (firstSignature.current) {
      firstSignature.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void reloadCycles();
      void reloadMilestones();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [progressSignature, loading, reloadCycles, reloadMilestones]);

  const activeView = views.find((v) => v.id === activeViewId);
  const viewDirty = activeView
    ? viewKey({ view, filters, group, sort, showSub }) !==
      viewKey({ view: activeView.view_type, sort: activeView.sort, ...splitViewFilters(activeView.filters) })
    : false;

  // La URL del team usa su clave (/app/track/team/WEB) apenas se conoce.
  const teamHref = teamPath(teamKey ?? project ?? projectId);
  useEffect(() => {
    const sp = filtersToParams(filters, sort);
    sp.set('view', view);
    if (group) sp.set('group', group);
    if (scope !== 'all') sp.set('scope', scope);
    if (!showCompleted) sp.set('done', 'hide');
    if (!showSub) sp.set('sub', 'hide');
    // El link de la vista solo mientras no se cambió nada (si no, mandan los filtros).
    if (activeViewId && !viewDirty) sp.set('savedView', activeViewId);
    if (tab === 'triage') sp.set('tab', 'triage');
    const qs = sp.toString();
    router.replace(`${teamHref}?${qs}`, { scroll: false });
  }, [filters, sort, group, view, tab, scope, showCompleted, teamHref, locale, router, showSub, activeViewId, viewDirty]);

  // ⌘B alterna lista y tablero, como en Linear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      setView((v) => (v === 'board' ? 'list' : 'board'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleViewChange = (v: ViewType) => {
    setView(v);
  };

  /** Lo que se guarda de la vista: filtros, agrupado, sub-issues, orden y tipo. */
  const viewPayload = () => ({
    viewType: view,
    // El agrupado y "sub-issues" viajan dentro de filters (la tabla no tiene columnas propias).
    filters: {
      match: filters.match,
      rules: filters.rules,
      q: filters.q,
      ...(group ? { groupBy: group } : {}),
      ...(!showSub ? { subIssues: 'hide' } : {}),
    } as Record<string, unknown>,
    sort,
  });

  const handleSaveView = async (name: string, shared: boolean) => {
    const created = await api<TrackSavedView>(`/api/track/projects/${projectId}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, shared, ...viewPayload() }),
    });
    setViews((prev) => [...prev, created]);
    setSaveDialogOpen(false);
    setActiveViewId(created.id);
  };

  const handleSelectView = (selected: TrackSavedView) => {
    const saved = splitViewFilters(selected.filters);
    setScope('all');
    setView(selected.view_type);
    setFilters(saved.filters);
    setGroup(saved.group);
    setShowSub(saved.showSub);
    setSort(parseIssueSort(selected.sort));
    setActiveViewId(selected.id);
  };


  // Abrir una vista desde el sidebar (favoritas) con la página ya cargada.
  const linkedView = searchParams.get('savedView');
  useEffect(() => {
    if (!linkedView || linkedView === activeViewId) return;
    const found = views.find((v) => v.id === linkedView);
    if (found) handleSelectView(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedView, views]);

  const replaceView = (updated: TrackSavedView) => setViews((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));

  const viewAction = (fn: () => Promise<unknown>) => {
    fn().catch(() => setNotice(t('errors.generic')));
  };

  const handleSetDefault = (id: string) =>
    viewAction(async () => {
      const updated = await api<TrackSavedView>(`/api/track/views/${id}/default`, { method: 'POST' });
      setViews((prev) => prev.map((v) => ({ ...v, is_default: v.user_id === userId && v.id === id })));
      setActiveViewId(updated.id);
    });

  const handleRename = (id: string, name: string) =>
    viewAction(async () => {
      const updated = await api<TrackSavedView>(`/api/track/views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      replaceView(updated);
      window.dispatchEvent(new Event('zs:track-views-changed'));
    });

  const handleToggleShared = (id: string, shared: boolean) =>
    viewAction(async () => {
      replaceView(
        await api<TrackSavedView>(`/api/track/views/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shared }),
        }),
      );
      pushNotice(shared ? tx('views.sharedOn') : tx('views.sharedOff'));
    });

  const handleToggleFavorite = (id: string, favorite: boolean) =>
    viewAction(async () => {
      replaceView(
        await api<TrackSavedView>(`/api/track/views/${id}/favorite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favorite }),
        }),
      );
      // El sidebar muestra las favoritas: que se entere sin recargar.
      window.dispatchEvent(new Event('zs:track-views-changed'));
    });

  const handleUpdateView = (id: string) =>
    viewAction(async () => {
      replaceView(
        await api<TrackSavedView>(`/api/track/views/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viewPayload()),
        }),
      );
      pushNotice(tx('views.saved'));
    });

  const handleCopyViewLink = (id: string) => {
    const url = new URL(`${teamHref}?savedView=${id}`, window.location.origin).toString();
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    pushNotice(tx('views.linkCopied'));
  };

  const handleDelete = (id: string) =>
    viewAction(async () => {
      await api(`/api/track/views/${id}`, { method: 'DELETE' });
      setViews((prev) => prev.filter((v) => v.id !== id));
      if (activeViewId === id) setActiveViewId(undefined);
      window.dispatchEvent(new Event('zs:track-views-changed'));
    });

  const handleMove = (issueId: string, patch: Parameters<typeof store.update>[1]) => {
    void store.update(issueId, patch);
  };

  // Devuelve el issue creado (el composer sube los adjuntos cuando termina).
  const createIssue = (draft: IssueDraft) =>
    store.create(projectId, draft, sort).then((created) => {
      if (created) setIssuesTotal((n) => n + 1);
      return created;
    });

  const quickCreate = (raw: string, extra: Partial<IssueDraft> = {}) => {
    const parsed = parseQuickTitle(raw, today);
    if (!parsed.title) return;
    createIssue({
      ...extra,
      title: parsed.title,
      priority: parsed.priority ?? extra.priority,
      dueDate: parsed.dueDate ?? extra.dueDate,
    });
  };

  useCreateShortcut(() => openComposer(), !loading && !loadError && !modalOpen && !saveDialogOpen && !settingsOpen);

  // "Nuevo issue" pedido mientras la vista carga (⌘K, o el link viejo
  // /issues/new → ?newIssue=1): se recuerda y el modal abre al terminar. El
  // parámetro se lee de la URL inicial: la sincronización de filtros de abajo
  // reescribe la URL al montar y TrackShortcuts puede no llegar a verlo.
  // Ya cargada, el evento abre este mismo modal (y no el de TrackShortcuts):
  // abrirlo dos veces es idempotente, así no aparecen dos modales.
  const pendingCreate = useRef(initialParams.current.get('newIssue') === '1');
  useEffect(() => {
    if (!loading && pendingCreate.current && !loadError) {
      pendingCreate.current = false;
      openComposer();
    }
    const onEvent = (e: Event) => {
      e.preventDefault();
      if (loading) pendingCreate.current = true;
      else if (!loadError) openComposer();
    };
    window.addEventListener(TRACK_NEW_ISSUE_EVENT, onEvent);
    return () => window.removeEventListener(TRACK_NEW_ISSUE_EVENT, onEvent);
  }, [loading, loadError]);

  const editing = {
    onUpdate: (issueId: string, patch: Parameters<typeof store.update>[1]) => void store.update(issueId, patch),
    onToggleDone: (issue: TrackIssueWithStatus) => void store.toggleDone(issue),
    ui: labels.ui,
    today,
  };

  const handleDatesChange = async (issueId: string, startDate: string, dueDate: string) => {
    const snapshot = issues;
    // Optimista: la barra se queda donde el usuario la soltó.
    setIssues((prev) =>
      prev.map((i) => (i.id === issueId ? { ...i, start_date: startDate, due_date: dueDate } : i)),
    );
    try {
      await api(`/api/track/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, dueDate }),
      });
    } catch (err) {
      // Revert y que el Gantt muestre el error.
      setIssues(snapshot);
      throw err;
    }
  };

  if (loadError) {
    return (
      <div className="app-page track-page" data-track-project-id={projectId}>
        <EmptyState
          title={t('project.loadErrorTitle')}
          body={t('project.loadErrorBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setReloadKey((k) => k + 1)}>
              {t('common.retry')}
            </button>
          }
          secondary={<Link href={TEAMS_PATH}>{t('projects.backToList')}</Link>}
        />
      </div>
    );
  }

  if (loading || !project) {
    return (
      <div className="app-page track-page" data-track-project-id={projectId} aria-busy="true">
        <span className="sr-only" role="status">
          {labels.loading}
        </span>
        <div className="track-skeleton-head">
          <span className="ui-skeleton ui-skeleton-title" />
          <span className="ui-skeleton ui-skeleton-text" />
        </div>
        <div className="ui-loading-stack">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="ui-skeleton ui-skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  const savedViewsMenu = (
    <SavedViewsMenu
      views={views}
      activeViewId={activeViewId}
      userId={userId}
      dirty={viewDirty}
      onSelect={handleSelectView}
      onSetDefault={handleSetDefault}
      onRename={handleRename}
      onDelete={handleDelete}
      onToggleShared={handleToggleShared}
      onToggleFavorite={handleToggleFavorite}
      onUpdate={handleUpdateView}
      onCopyLink={handleCopyViewLink}
      defaultOpen={initialParams.current.get('views') === '1'}
      labels={{
        title: labels.savedViews.title,
        empty: labels.savedViews.empty,
        default: labels.savedViews.default,
        rename: labels.savedViews.rename,
        delete: labels.savedViews.delete,
      }}
    />
  );

  // Como Linear, la lista arranca agrupada por estado ("none" explícito la deja plana).
  const listGroup = parseIssueGroup(group || 'status', LIST_GROUPS);
  const boardGroup = parseIssueGroup(group || 'status', PROJECT_BOARD_GROUPS) as BoardGroupBy;

  const current = activeCycle(cycles, today);
  const nextMilestone = upcomingMilestone(milestones, today);
  const filtersActive = activeFilterCount(filters) > 0 || Boolean(filters.q) || scope !== 'all' || !showCompleted;
  // Display properties → columnas ocultas (cycle solo si el team usa cycles).
  const hiddenColumns: OptionalColumn[] = [
    ...TEAM_PROPS.filter((p) => !displayProps.includes(p)).map((p) => p as OptionalColumn),
    ...(cycles.length > 0 && !filters.rules.some((r) => r.field === 'cycle') ? [] : (['cycle'] as OptionalColumn[])),
  ];
  const addInGroup = (preset: GroupPreset) =>
    openComposer({
      statusId: preset.statusId,
      ...(preset.assigneeId !== undefined ? { assigneeId: preset.assigneeId } : {}),
    });
  const projectEmpty = issuesTotal === 0 && issues.length === 0 && !filtersActive;
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
                : t('milestones.headerMetaNoDate', {
                    name: nextMilestone.name,
                    done: nextMilestone.done,
                    total: nextMilestone.total,
                  })}
            </span>
          )}
        </nav>
        <div className="track-team-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
            aria-label={labels.settings}
            title={labels.settings}
            data-testid="track-project-settings"
          >
            <TrackIcon name="settings" />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => openComposer()}
            title={labels.ui.modal.shortcutHint}
            aria-keyshortcuts="C"
          >
            {labels.newIssue}
            <kbd className="kbd track-kbd" aria-hidden>
              C
            </kbd>
          </button>
        </div>
      </header>

      <div className="track-team-tabs" role="tablist" aria-label={tt('tabs')}>
        {SCOPES.map((sc) => {
          const on = tab === 'issues' && !activeViewId && scope === sc;
          return (
            <button
              key={sc}
              type="button"
              role="tab"
              aria-selected={on}
              className={`track-team-tab${on ? ' is-on' : ''}`}
              onClick={() => {
                setTab('issues');
                setActiveViewId(undefined);
                setScope(sc);
              }}
              data-testid={`track-scope-${sc}`}
            >
              {tt(sc)}
              {on && <span className="track-team-tab-count">{issuesTotal}</span>}
            </button>
          );
        })}
        {views
          .filter((v) => v.favorite || v.id === activeViewId)
          .map((v) => {
            const on = tab === 'issues' && v.id === activeViewId;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`track-team-tab${on ? ' is-on' : ''}`}
                onClick={() => {
                  setTab('issues');
                  setScope('all');
                  handleSelectView(v);
                }}
                data-testid="track-team-view-tab"
              >
                <TrackIcon name="views" size={12} />
                {v.name}
                {on && viewDirty && <span className="track-view-dirty" title={tx('views.unsaved')} aria-label={tx('views.unsaved')} />}
              </button>
            );
          })}
        {showTriageTab && (
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
        )}
        <span className="track-team-tabs-end">{savedViewsMenu}</span>
      </div>

      {tab === 'triage' ? (
        <TriagePanel
          projectId={projectId}
          issues={triageIssues}
          statuses={statuses}
          locale={locale}
          onResolved={() => {
            void loadTriage();
            void fetchIssues(1, false);
          }}
        />
      ) : projectEmpty ? (
        <EmptyState
          title={t('project.emptyTitle')}
          body={t('project.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => openComposer()} data-testid="track-empty-new-issue">
              {labels.newIssue}
            </button>
          }
          secondary={t('project.emptyShortcut')}
        />
      ) : (
        <>
          <IssueFilters
            filters={filters}
            onChange={(f) => setFilters(f)}
            onSaveView={() => setSaveDialogOpen(true)}
            updateView={
              activeView && viewDirty && activeView.user_id === userId
                ? { onUpdate: () => void handleUpdateView(activeView.id), updateLabel: tx('views.updateView'), saveAsNewLabel: tx('views.saveAsNew') }
                : undefined
            }
            statuses={statuses}
            priorities={labels.priorities}
            members={members}
            cycles={cycles}
            milestones={milestones.map((m) => ({ id: m.id, name: m.name }))}
            issueLabels={issueLabels}
            labels={{ ...labels.filters, filter: t('filters.button'), done: t('filters.done') }}
            trailing={
              <IssueDisplayOptions
                layout={{ value: view, options: LAYOUTS, onChange: handleViewChange }}
                group={view === 'board' ? boardGroup : listGroup}
                groups={view === 'board' ? PROJECT_BOARD_GROUPS : LIST_GROUPS}
                sort={sort}
                onGroupChange={(g) => setGroup(g)}
                onSortChange={(s) => setSort(s)}
                labels={labels.ui.display}
                subIssues={{ show: showSub, onChange: setShowSub, label: tx('sub.show') }}
                completed={{ show: showCompleted, onChange: setShowCompleted }}
                properties={view === 'list' ? { visible: displayProps, available: TEAM_PROPS, onChange: changeDisplayProps } : undefined}
                onReset={
                  group || sort !== 'newest' || !showSub || !showCompleted || displayProps.join() !== TEAM_DEFAULT_PROPS.join()
                    ? () => {
                        setGroup('');
                        setSort('newest');
                        setShowSub(true);
                        setShowCompleted(true);
                        changeDisplayProps(TEAM_DEFAULT_PROPS);
                      }
                    : undefined
                }
              />
            }
          />

          <div className="track-view">
            {view === 'list' && listGroup !== 'none' && (
              <GroupedIssuesTable
                issues={issues}
                groupBy={listGroup}
                statuses={statuses}
                locale={locale}
                labels={{
                  ...labels.table,
                  empty: filtersActive ? t('project.noMatches') : labels.noIssues,
                  noAssignee: labels.noAssignee,
                }}
                groupLabels={labels.ui.display}
                priorities={labels.priorities}
                editing={{ ...editing, projects: projectMap }}
                onQuickCreate={(title, preset) => quickCreate(title, preset)}
                hideColumns={hiddenColumns}
                selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
                nested={showSub}
                onAddInGroup={(preset) => addInGroup(preset)}
              />
            )}
            {view === 'list' && listGroup === 'none' && (
              <IssuesTable
                issues={issues}
                locale={locale}
                labels={{
                  ...labels.table,
                  empty: filtersActive ? t('project.noMatches') : labels.noIssues,
                  noAssignee: labels.noAssignee,
                }}
                editing={{ ...editing, projects: projectMap }}
                quickAdd={{ onCreate: (title) => quickCreate(title) }}
                hideColumns={hiddenColumns}
                selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
                nested={showSub}
              />
            )}
            {view === 'board' && (
              <IssuesBoard
                issues={issues}
                statuses={statuses}
                locale={locale}
                onMove={handleMove}
                groupBy={boardGroup}
                labels={{
                  noAssignee: labels.noAssignee,
                  empty: labels.board.empty,
                  noCycle: labels.ui.display.noCycle,
                  noLabel: labels.ui.display.noLabel,
                }}
                editing={{ ...editing, members }}
                onQuickCreate={(title, preset) => quickCreate(title, preset)}
                show={displayProps}
              />
            )}
            {view === 'calendar' && (
              <IssuesCalendar
                issues={issues}
                locale={locale}
                labels={{
                  prev: labels.calendar.prev,
                  next: labels.calendar.next,
                  today: labels.calendar.today,
                  unscheduled: labels.calendar.unscheduled,
                  noAssignee: labels.noAssignee,
                }}
              />
            )}
            {view === 'gantt' && (
              <IssuesGantt
                issues={issues}
                statuses={statuses}
                locale={locale}
                onDatesChange={handleDatesChange}
                labels={{
                  prev: labels.gantt.prev,
                  next: labels.gantt.next,
                  today: labels.gantt.today,
                  unscheduled: labels.gantt.unscheduled,
                  noAssignee: labels.noAssignee,
                  updateError: labels.gantt.updateError,
                }}
              />
            )}
          </div>

          {issuesTotal > 0 && (
            <div className="track-pagination">
              <p className="track-pagination-count" role="status">
                {labels.showing.replace('{shown}', String(issues.length)).replace('{total}', String(issuesTotal))}
              </p>
              {issues.length < issuesTotal && (
                <button type="button" className="btn btn-sm" onClick={handleLoadMore} aria-busy={loadingMore || undefined}>
                  {labels.loadMore}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'issues' && view === 'list' && (
        <BulkBar
          count={selection.selected.size}
          statuses={statuses}
          members={members}
          cycles={cycles}
          labels={workspaceLabels}
          priorities={labels.priorities}
          canDelete={isAdmin}
          onApply={(patch: BulkPatch) => runBulk({ action: 'update', patch })}
          onDelete={() => runBulk({ action: 'delete' })}
          onClear={selection.clear}
        />
      )}

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
                    await Promise.all([reloadCycles(), fetchIssues(1, false)]);
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
                  await Promise.all([reloadMilestones(), fetchIssues(1, false)]);
                }}
              />
            ),
            templates: (
              <TemplatesPanel
                projectId={projectId}
                templates={templates}
                statuses={statuses}
                members={members}
                onChanged={reloadTemplates}
              />
            ),
            recurring: (
              <RecurringPanel
                projectId={projectId}
                rules={recurring}
                statuses={statuses}
                members={members}
                today={today}
                onChanged={reloadRecurring}
              />
            ),
            statuses: (
              <StatusesSettings
                projectId={projectId}
                statuses={statuses}
                canDelete={isAdmin}
                onChange={(next, opts) => {
                  setStatuses(next);
                  if (opts?.reloadIssues) void fetchIssues(1, false);
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

      <QuickIssueModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projects={Object.values(projectMap)}
        defaults={modalDefaults}
        onCreate={(_pid, draft) => createIssue(draft)}
        meId={userId}
        labels={labels.ui}
        today={today}
      />

      <TrackToast message={store.error} onDismiss={store.clearError} dismissLabel={labels.ui.inline.dismiss} />
      <TrackToast message={store.error ? null : notice} onDismiss={() => setNotice(null)} dismissLabel={labels.ui.inline.dismiss} />

      <SaveViewDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveView}
        viewType={view}
        filters={filters}
        labels={{
          title: labels.savedViews.saveDialogTitle,
          name: labels.savedViews.saveDialogName,
          namePlaceholder: labels.savedViews.saveDialogPlaceholder,
          save: labels.savedViews.save,
          cancel: labels.savedViews.cancel,
          error: t('errors.generic'),
          shared: tx('views.shareOnSave'),
          sharedHelp: tx('views.shareHelp'),
        }}
      />
    </div>
  );
}
