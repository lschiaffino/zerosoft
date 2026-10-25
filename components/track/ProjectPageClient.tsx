'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { TrackIssueTemplateRow, TrackProjectRow, TrackRecurringIssueRow, TrackStatusRow } from '@/lib/db';
import type { TrackMilestoneWithProgress } from '@/lib/track-milestones';
import { upcomingMilestone } from '@/lib/track-milestone-utils';
import type { IssueLabel } from '@/lib/track-schema';
import type { FilterState } from './IssueFilters';
import type { ViewType } from './ViewSwitcher';
import type { TrackIssueView, ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import ViewSwitcher from './ViewSwitcher';
import IssueFilters, { activeFilterCount } from './IssueFilters';
import SavedViewsMenu from './SavedViewsMenu';
import SaveViewDialog from './SaveViewDialog';
import IssuesTable from './IssuesTable';
import IssuesBoard from './IssuesBoard';
import IssuesCalendar from './IssuesCalendar';
import IssuesGantt from './IssuesGantt';
import QuickIssueModal from './QuickIssueModal';
import CyclesPanel, { type CycleWithProgress } from './CyclesPanel';
import StatusesSettings from './StatusesSettings';
import { TrackToast, useToday } from './InlineEditors';
import { TRACK_NEW_ISSUE_EVENT, useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import { activeCycle, formatDay, parseQuickTitle } from '@/lib/track-tasks';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ProjectSettingsDrawer from './ProjectSettingsDrawer';
import AutoCyclesSettings from './AutoCyclesSettings';
import MilestonesPanel from './MilestonesPanel';
import TemplatesPanel from './TemplatesPanel';
import RecurringPanel from './RecurringPanel';
import TrackIcon from './TrackIcon';
import type { TrackUiLabels } from './ui-labels';
import { BulkBar, useIssueSelection, type BulkPatch } from './BulkEdit';
import { useWorkspaceLabels } from './LabelPicker';
import TriageSettingsPanel from './triage/TriageSettingsPanel';
import ProjectUpdateDraftButton from './triage/ProjectUpdateDraftButton';
import TriagePanel from './TriagePanel';
import IssueDisplayOptions from './IssueDisplayOptions';
import GroupedIssuesTable from './GroupedIssuesTable';
import { parseIssueGroup, parseIssueSort, type BoardGroupBy, type IssueGroupBy, type IssueSort } from '@/lib/track-views';

interface ProjectPageClientProps {
  locale: string;
  projectId: string;
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

function filtersToParams(filters: FilterState, sort: SortValue): URLSearchParams {
  const sp = new URLSearchParams();
  filters.statusId.forEach((v) => sp.append('statusId', v));
  filters.priority.forEach((v) => sp.append('priority', v));
  filters.assigneeId.forEach((v) => sp.append('assigneeId', v));
  filters.cycleId.forEach((v) => sp.append('cycleId', v));
  filters.labelIds.forEach((v) => sp.append('labelIds', v));
  if (filters.q) sp.set('q', filters.q);
  if (filters.dueAfter) sp.set('dueAfter', filters.dueAfter);
  if (filters.dueBefore) sp.set('dueBefore', filters.dueBefore);
  if (sort !== 'newest') sp.set('sort', sort);
  return sp;
}

function readStringArray(sp: URLSearchParams, key: string): string[] {
  const raw = sp.getAll(key);
  return raw
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

function paramsToFilters(sp: URLSearchParams): FilterState {
  return {
    statusId: readStringArray(sp, 'statusId'),
    priority: readStringArray(sp, 'priority'),
    assigneeId: readStringArray(sp, 'assigneeId'),
    cycleId: readStringArray(sp, 'cycleId'),
    labelIds: readStringArray(sp, 'labelIds'),
    q: sp.get('q') ?? '',
    dueAfter: sp.get('dueAfter') ?? '',
    dueBefore: sp.get('dueBefore') ?? '',
  };
}

/** Filtros de una vista guardada, separando el agrupado que viaja adentro. */
function splitViewFilters(raw: Record<string, unknown>): { filters: FilterState; group: string } {
  const { groupBy, ...rest } = raw ?? {};
  return { filters: rest as unknown as FilterState, group: typeof groupBy === 'string' ? groupBy : '' };
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`api error ${res.status}`);
  return (await res.json()) as T;
}

export default function ProjectPageClient({ locale, projectId, userId, isAdmin = false, labels }: ProjectPageClientProps) {
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
  const [views, setViews] = useState<TrackIssueView[]>([]);
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
  const store = useIssueStore([], projectMap, {
    saveError: labels.ui.inline.saveError,
    createError: labels.ui.inline.createError,
    noDoneStatus: labels.ui.inline.noDoneStatus,
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
      const sp = filtersToParams(filters, sort);
      sp.set('pageSize', String(ISSUES_PAGE_SIZE));
      sp.set('page', String(page));
      const data = await api<{ rows: TrackIssueWithStatus[]; total: number }>(
        `/api/track/projects/${projectId}/issues?${sp.toString()}`,
      );
      if (seq !== issuesRequest.current) return;
      setIssues((prev) => (append ? [...prev, ...data.rows] : data.rows));
      setIssuesTotal(data.total);
      setIssuesPage(page);
    },
    [projectId, filters, sort, setIssues],
  );

  // Vuelve a pedir las páginas ya cargadas (1..issuesPage) sin volver a la
  // primera: después de una edición masiva no se pierde el lugar ni la
  // selección de los issues de más abajo.
  const reloadLoadedPages = useCallback(async () => {
    const seq = ++issuesRequest.current;
    const sp = filtersToParams(filters, sort);
    sp.set('pageSize', String(ISSUES_PAGE_SIZE));
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
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    setIssues(rows);
    setIssuesTotal(pages[pages.length - 1].total);
  }, [projectId, filters, sort, issuesPage, setIssues]);

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
          api<{ rows: TrackIssueView[] }>(`/api/track/projects/${projectId}/views`).then((r) => r.rows),
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
        setIssues(i.rows);
        setIssuesTotal(i.total);
        setIssuesPage(1);

        // Apply default view if present and no URL state
        const hasUrlState =
          initialParams.current.toString().length > 0 &&
          (initialParams.current.get('view') ||
            initialParams.current.get('sort') ||
            initialParams.current.get('group') ||
            initialParams.current.get('statusId') ||
            initialParams.current.get('priority') ||
            initialParams.current.get('q'));
        if (!hasUrlState) {
          const def = v.find((x) => x.is_default);
          if (def) {
            const saved = splitViewFilters(def.filters);
            setView(def.view_type);
            setFilters(saved.filters);
            setGroup(saved.group);
            setSort(parseIssueSort(def.sort));
            setActiveViewId(def.id);
          }
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
  }, [filters, sort, fetchIssues, loading, loadError, t]);

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

  const runBulk = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/track/issues/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, issueIds: Array.from(selection.selected) }),
    }).catch(() => null);
    if (!res?.ok) {
      setNotice(t('bulk.error'));
      return;
    }
    const data = (await res.json()) as { updated: string[]; skipped: unknown[] };
    setNotice(data.skipped.length ? t('bulk.skipped', { count: data.skipped.length }) : null);
    if (body.action === 'delete') {
      selection.clear();
      setIssuesTotal((n) => Math.max(0, n - data.updated.length));
      await fetchIssues(1, false);
      return;
    }
    await reloadLoadedPages().catch(() => setNotice(t('errors.generic')));
  };

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

  useEffect(() => {
    const sp = filtersToParams(filters, sort);
    sp.set('view', view);
    if (group) sp.set('group', group);
    if (tab === 'triage') sp.set('tab', 'triage');
    const qs = sp.toString();
    router.replace(`/app/track/projects/${projectId}?${qs}`, { scroll: false });
  }, [filters, sort, group, view, tab, projectId, locale, router]);

  const handleViewChange = (v: ViewType) => {
    setView(v);
    setActiveViewId(undefined);
  };

  const handleSaveView = async (name: string) => {
    const payload = {
      name,
      viewType: view,
      // El agrupado viaja dentro de filters (la tabla de vistas no tiene columna propia).
      filters: { ...filters, ...(group ? { groupBy: group } : {}) } as unknown as Record<string, unknown>,
      sort,
    };
    const created = await api<TrackIssueView>(`/api/track/projects/${projectId}/views`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setViews((prev) => [...prev, created].sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1)));
    setSaveDialogOpen(false);
    setActiveViewId(created.id);
  };

  const handleSelectView = (selected: TrackIssueView) => {
    const saved = splitViewFilters(selected.filters);
    setView(selected.view_type);
    setFilters(saved.filters);
    setGroup(saved.group);
    setSort(parseIssueSort(selected.sort));
    setActiveViewId(selected.id);
  };

  const viewAction = (fn: () => Promise<unknown>) => {
    fn().catch(() => setNotice(t('errors.generic')));
  };

  const handleSetDefault = (id: string) =>
    viewAction(async () => {
      const updated = await api<TrackIssueView>(`/api/track/views/${id}/default`, { method: 'POST' });
      setViews((prev) =>
        prev
          .map((v) => ({ ...v, is_default: v.id === id }))
          .sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1)),
      );
      setActiveViewId(updated.id);
    });

  const handleRename = (id: string, name: string) =>
    viewAction(async () => {
      const updated = await api<TrackIssueView>(`/api/track/views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setViews((prev) => prev.map((v) => (v.id === id ? updated : v)));
    });

  const handleDelete = (id: string) =>
    viewAction(async () => {
      await api(`/api/track/views/${id}`, { method: 'DELETE' });
      setViews((prev) => prev.filter((v) => v.id !== id));
      if (activeViewId === id) setActiveViewId(undefined);
    });

  const handleMove = (issueId: string, patch: Parameters<typeof store.update>[1]) => {
    void store.update(issueId, patch);
  };

  const createIssue = (draft: IssueDraft) => {
    void store.create(projectId, draft, sort).then((created) => {
      if (created) setIssuesTotal((n) => n + 1);
    });
  };

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

  useCreateShortcut(() => setModalOpen(true), !loading && !loadError && !modalOpen && !saveDialogOpen && !settingsOpen);

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
      setModalOpen(true);
    }
    const onEvent = (e: Event) => {
      e.preventDefault();
      if (loading) pendingCreate.current = true;
      else if (!loadError) setModalOpen(true);
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
          secondary={<Link href="/app/track/projects">{t('projects.backToList')}</Link>}
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
      onSelect={handleSelectView}
      onSetDefault={handleSetDefault}
      onRename={handleRename}
      onDelete={handleDelete}
      labels={{
        title: labels.savedViews.title,
        empty: labels.savedViews.empty,
        default: labels.savedViews.default,
        rename: labels.savedViews.rename,
        delete: labels.savedViews.delete,
      }}
    />
  );

  const listGroup = parseIssueGroup(group || 'none', LIST_GROUPS);
  const boardGroup = parseIssueGroup(group || 'status', PROJECT_BOARD_GROUPS) as BoardGroupBy;

  const current = activeCycle(cycles, today);
  const nextMilestone = upcomingMilestone(milestones, today);
  const filtersActive = activeFilterCount(filters) > 0 || Boolean(filters.q);
  const projectEmpty = issuesTotal === 0 && issues.length === 0 && !filtersActive;
  const showTriageTab = Boolean(project.triage_enabled) || triageIssues.length > 0;

  return (
    <div className="app-page track-page" data-track-project-id={project.id}>
      <PageHeader
        back={{ href: '/app/track/projects', label: t('projects.title') }}
        title={
          <>
            {project.icon ? <span className="track-project-icon">{project.icon}</span> : null}
            {project.name}
          </>
        }
        description={
          project.description || current || nextMilestone ? (
            <>
              {project.description}
              {current && (
                <span className="track-cycle-meta" data-testid="track-active-cycle">
                  {t('project.activeCycleMeta', {
                    name: current.name,
                    done: current.done ?? 0,
                    total: current.total ?? 0,
                    end: formatDay(current.end_at.slice(0, 10), locale, today),
                  })}
                </span>
              )}
              {nextMilestone && (
                <span className="track-cycle-meta" data-testid="track-next-milestone">
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
            </>
          ) : undefined
        }
        actions={
          <>
            <ProjectUpdateDraftButton projectId={projectId} />
            <button
              type="button"
              className="btn"
              onClick={() => setSettingsOpen(true)}
              aria-haspopup="dialog"
              data-testid="track-project-settings"
            >
              <TrackIcon name="settings" />
              {labels.settings}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModalOpen(true)}
              title={labels.ui.modal.shortcutHint}
              aria-keyshortcuts="C"
            >
              {labels.newIssue}
              <kbd className="kbd track-kbd" aria-hidden>
                C
              </kbd>
            </button>
          </>
        }
      />

      {showTriageTab && (
        <div className="ui-tabs track-project-tabs" role="tablist" aria-label={project.name}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'issues'}
            className="ui-tab"
            onClick={() => setTab('issues')}
          >
            {labels.issues}
            <span className="ui-tab-count">{issuesTotal}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'triage'}
            className="ui-tab"
            onClick={() => setTab('triage')}
            data-testid="track-triage-tab"
          >
            {t('triage.tab')}
            {triageIssues.length > 0 && <span className="ui-tab-count">{triageIssues.length}</span>}
          </button>
        </div>
      )}

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
            <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)} data-testid="track-empty-new-issue">
              {labels.newIssue}
            </button>
          }
          secondary={t('project.emptyShortcut')}
        />
      ) : (
        <>
          <div className="track-toolbar">
            <ViewSwitcher
              active={view}
              onChange={handleViewChange}
              labels={{ ...labels.viewSwitcher, group: t('views.group') }}
            />
            <span className="track-toolbar-end">
              {(view === 'list' || view === 'board') && (
                <IssueDisplayOptions
                  group={view === 'board' ? boardGroup : listGroup}
                  groups={view === 'board' ? PROJECT_BOARD_GROUPS : LIST_GROUPS}
                  sort={sort}
                  onGroupChange={(g) => {
                    setGroup(g === 'none' ? '' : g);
                    setActiveViewId(undefined);
                  }}
                  onSortChange={(s) => {
                    setSort(s);
                    setActiveViewId(undefined);
                  }}
                  labels={labels.ui.display}
                />
              )}
              {savedViewsMenu}
            </span>
          </div>

          <IssueFilters
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setActiveViewId(undefined);
            }}
            onSaveView={() => setSaveDialogOpen(true)}
            statuses={statuses}
            priorities={labels.priorities}
            members={members}
            cycles={cycles}
            issueLabels={issueLabels}
            labels={{ ...labels.filters, filter: t('filters.button'), done: t('filters.done') }}
            savedViews={savedViewsMenu}
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
                hideColumns={cycles.length > 0 && filters.cycleId.length === 0 ? [] : ['cycle']}
                selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
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
                hideColumns={cycles.length > 0 && filters.cycleId.length === 0 ? [] : ['cycle']}
                selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
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
        onCreate={(_pid, draft) => createIssue(draft)}
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
        }}
      />
    </div>
  );
}
