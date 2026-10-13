'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { TrackProjectRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import type { FilterState } from './IssueFilters';
import type { ViewType } from './ViewSwitcher';
import type { TrackIssueView, ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import ViewSwitcher from './ViewSwitcher';
import IssueFilters from './IssueFilters';
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
import { useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import { parseQuickTitle } from '@/lib/track-tasks';
import type { TrackUiLabels } from './ui-labels';
import { BulkBar, useIssueSelection, type BulkPatch } from './BulkEdit';
import { useWorkspaceLabels } from './LabelPicker';
import TriagePanel from './TriagePanel';

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

const SORTS = ['newest', 'oldest', 'priority', 'identifier'] as const;
type SortValue = (typeof SORTS)[number];

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [views, setViews] = useState<TrackIssueView[]>([]);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issuesPage, setIssuesPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewType>(() => (searchParams.get('view') as ViewType) ?? 'list');
  const [filters, setFilters] = useState<FilterState>(() => paramsToFilters(searchParams));
  const [sort, setSort] = useState<SortValue>(() => (searchParams.get('sort') as SortValue) ?? 'newest');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState<'issues' | 'triage'>(() => (searchParams.get('tab') === 'triage' ? 'triage' : 'issues'));
  const [triageIssues, setTriageIssues] = useState<TrackIssueWithStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceLabels] = useWorkspaceLabels();
  const today = useToday();

  const projectMap = useMemo<ProjectMap>(
    () =>
      project
        ? { [project.id]: { id: project.id, name: project.name, icon: project.icon, statuses, members } }
        : {},
    [project, statuses, members],
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

  const fetchIssues = useCallback(
    async (page: number, append: boolean) => {
      const sp = filtersToParams(filters, sort);
      sp.set('pageSize', String(ISSUES_PAGE_SIZE));
      sp.set('page', String(page));
      const data = await api<{ rows: TrackIssueWithStatus[]; total: number }>(
        `/api/track/projects/${projectId}/issues?${sp.toString()}`,
      );
      setIssues((prev) => (append ? [...prev, ...data.rows] : data.rows));
      setIssuesTotal(data.total);
      setIssuesPage(page);
    },
    [projectId, filters, sort, setIssues],
  );

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      await fetchIssues(issuesPage + 1, true);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
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
            initialParams.current.get('statusId') ||
            initialParams.current.get('priority') ||
            initialParams.current.get('q'));
        if (!hasUrlState) {
          const def = v.find((x) => x.is_default);
          if (def) {
            setView(def.view_type);
            setFilters((def.filters as unknown) as FilterState);
            setSort(def.sort);
            setActiveViewId(def.id);
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [projectId, setIssues]);

  useEffect(() => {
    if (loading) return;
    fetchIssues(1, false);
  }, [filters, sort, fetchIssues, loading]);

  const loadTriage = useCallback(async () => {
    const data = await api<{ rows: TrackIssueWithStatus[] }>(`/api/track/projects/${projectId}/triage`).catch(() => null);
    if (data) setTriageIssues(data.rows);
  }, [projectId]);

  useEffect(() => {
    void loadTriage();
  }, [loadTriage]);

  const toggleTriage = async (enabled: boolean) => {
    setProject((prev) => (prev ? { ...prev, triage_enabled: enabled ? 1 : 0 } : prev));
    const updated = await api<TrackProjectRow>(`/api/track/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triageEnabled: enabled }),
    }).catch(() => null);
    if (updated) setProject(updated);
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
    }
    await fetchIssues(1, false);
  };

  const reloadCycles = useCallback(async () => {
    const rows = await api<{ rows: CycleWithProgress[] }>(`/api/track/projects/${projectId}/cycles`)
      .then((r) => r.rows)
      .catch(() => null);
    if (rows) setCycles(rows);
  }, [projectId]);

  // El progreso de los cycles depende del status/cycle de los issues: lo
  // refrescamos (con debounce) cuando cambian.
  const progressSignature = useMemo(
    () => issues.map((i) => `${i.id}:${i.status_id}:${i.cycle_id}`).join('|'),
    [issues],
  );
  const firstSignature = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (firstSignature.current) {
      firstSignature.current = false;
      return;
    }
    const timer = window.setTimeout(() => void reloadCycles(), 600);
    return () => window.clearTimeout(timer);
  }, [progressSignature, loading, reloadCycles]);

  useEffect(() => {
    const sp = filtersToParams(filters, sort);
    sp.set('view', view);
    if (tab === 'triage') sp.set('tab', 'triage');
    const qs = sp.toString();
    router.replace(`/app/track/projects/${projectId}?${qs}`, { scroll: false });
  }, [filters, sort, view, tab, projectId, locale, router]);

  const handleViewChange = (v: ViewType) => {
    setView(v);
    setActiveViewId(undefined);
  };

  const handleSaveView = async (name: string) => {
    const payload = {
      name,
      viewType: view,
      filters: (filters as unknown) as Record<string, unknown>,
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
    setView(selected.view_type);
    setFilters((selected.filters as unknown) as FilterState);
    setSort(selected.sort);
    setActiveViewId(selected.id);
  };

  const handleSetDefault = async (id: string) => {
    const updated = await api<TrackIssueView>(`/api/track/views/${id}/default`, { method: 'POST' });
    setViews((prev) =>
      prev
        .map((v) => ({ ...v, is_default: v.id === id }))
        .sort((a, b) => (a.is_default === b.is_default ? 0 : a.is_default ? -1 : 1)),
    );
    setActiveViewId(updated.id);
  };

  const handleRename = async (id: string, name: string) => {
    const updated = await api<TrackIssueView>(`/api/track/views/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setViews((prev) => prev.map((v) => (v.id === id ? updated : v)));
  };

  const handleDelete = async (id: string) => {
    await api(`/api/track/views/${id}`, { method: 'DELETE' });
    setViews((prev) => prev.filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId(undefined);
  };

  const handleStatusChange = (issueId: string, statusId: string) => {
    void store.update(issueId, { statusId });
  };

  const createIssue = (draft: IssueDraft) => {
    void store.create(projectId, draft).then((created) => {
      if (created) setIssuesTotal((n) => n + 1);
    });
  };

  const quickCreate = (raw: string, extra: Partial<IssueDraft> = {}) => {
    const parsed = parseQuickTitle(raw, today);
    if (!parsed.title) return;
    createIssue({ ...extra, title: parsed.title, priority: parsed.priority, dueDate: parsed.dueDate ?? extra.dueDate });
  };

  useCreateShortcut(() => setModalOpen(true), !loading && !modalOpen && !saveDialogOpen);

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

  if (loading || !project) {
    return (
      <div className="app-page track-page">
        <p className="muted">{labels.loading}</p>
      </div>
    );
  }

  return (
    <div className="app-page track-page">
      <div className="track-page-header">
        <div>
          <h1>
            <span style={{ marginRight: 10 }}>{project.icon || '◆'}</span>
            {project.name}
          </h1>
          {project.description ? <p>{project.description}</p> : null}
        </div>
        <div className="track-form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            data-testid="track-project-settings"
          >
            {labels.settings}
          </button>
          <button
            type="button"
            className="btn btn-solid"
            onClick={() => setModalOpen(true)}
            title={labels.ui.modal.shortcutHint}
            aria-keyshortcuts="C"
          >
            {labels.newIssue}
            <kbd className="track-kbd" aria-hidden>
              C
            </kbd>
          </button>
        </div>
      </div>

      {settingsOpen && (
        <section className="panel track-settings-panel" aria-label={labels.settings}>
          <label className="track-triage-toggle">
            <input
              type="checkbox"
              checked={Boolean(project.triage_enabled)}
              onChange={(e) => void toggleTriage(e.target.checked)}
              data-testid="track-triage-toggle"
            />
            <span>
              <strong>{t('triage.enable')}</strong>
              <span className="muted">{t('triage.enableHelp')}</span>
            </span>
          </label>
          <p className="section-label">{labels.workflowStatuses}</p>
          <StatusesSettings
            projectId={projectId}
            statuses={statuses}
            onChange={(next, opts) => {
              setStatuses(next);
              if (opts?.reloadIssues) void fetchIssues(1, false);
            }}
          />
        </section>
      )}

      {(project.triage_enabled || triageIssues.length > 0) && (
        <div className="track-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'issues'}
            className={`track-tab${tab === 'issues' ? ' is-active' : ''}`}
            onClick={() => setTab('issues')}
          >
            {labels.issues}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'triage'}
            className={`track-tab${tab === 'triage' ? ' is-active' : ''}`}
            onClick={() => setTab('triage')}
            data-testid="track-triage-tab"
          >
            {t('triage.tab')}
            {triageIssues.length > 0 && <span className="track-tab-count mono">{triageIssues.length}</span>}
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
      ) : (
      <>
      <div className="track-toolbar track-toolbar-wrap">
        <div className="track-toolbar-left">
          <ViewSwitcher active={view} onChange={handleViewChange} labels={labels.viewSwitcher} />
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
        </div>
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
        labels={labels.filters}
      />

      <div className="track-view" style={{ marginTop: 16 }}>
        {view === 'list' && (
          <IssuesTable
            issues={issues}
            locale={locale}
            labels={{
              ...labels.table,
              empty: labels.noIssues,
              noAssignee: labels.noAssignee,
            }}
            editing={{ ...editing, projects: projectMap }}
            quickAdd={{ onCreate: (title) => quickCreate(title) }}
            hideColumns={cycles.length > 0 ? [] : ['cycle']}
            selection={{ ...selection, label: t('bulk.select'), allLabel: t('bulk.selectAll') }}
          />
        )}
        {view === 'board' && (
          <IssuesBoard
            issues={issues}
            statuses={statuses}
            locale={locale}
            onStatusChange={handleStatusChange}
            labels={{ noAssignee: labels.noAssignee, empty: labels.board.empty }}
            editing={{ ...editing, members }}
            onQuickCreate={(title, statusId) => quickCreate(title, { statusId })}
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
          <p className="muted mono track-pagination-count" role="status">
            {labels.showing
              .replace('{shown}', String(issues.length))
              .replace('{total}', String(issuesTotal))}
          </p>
          {issues.length < issuesTotal && (
            <button
              type="button"
              className="btn btn-small"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? labels.loading : labels.loadMore}
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

      <CyclesPanel
        projectId={projectId}
        cycles={cycles}
        today={today}
        onChanged={async () => {
          await Promise.all([reloadCycles(), fetchIssues(1, false)]);
        }}
      />

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
        }}
      />
    </div>
  );
}
