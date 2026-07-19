'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import type { TrackCycleRow, TrackProjectRow, TrackStatusRow } from '@/lib/db';
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

interface ProjectPageClientProps {
  locale: string;
  projectId: string;
  userId: string;
  labels: PageLabels;
}

export interface PageLabels {
  newIssue: string;
  issues: string;
  cycles: string;
  noIssues: string;
  noAssignee: string;
  loading: string;
  viewSwitcher: {
    list: string;
    board: string;
    calendar: string;
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
  priorities: Array<{ value: string; label: string }>;
}

const SORTS = ['newest', 'oldest', 'priority', 'identifier'] as const;
type SortValue = (typeof SORTS)[number];

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

export default function ProjectPageClient({ locale, projectId, userId, labels }: ProjectPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [project, setProject] = useState<TrackProjectRow | null>(null);
  const [statuses, setStatuses] = useState<TrackStatusRow[]>([]);
  const [cycles, setCycles] = useState<TrackCycleRow[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [views, setViews] = useState<TrackIssueView[]>([]);
  const [issues, setIssues] = useState<TrackIssueWithStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewType>(() => (searchParams.get('view') as ViewType) ?? 'list');
  const [filters, setFilters] = useState<FilterState>(() => paramsToFilters(searchParams));
  const [sort, setSort] = useState<SortValue>(() => (searchParams.get('sort') as SortValue) ?? 'newest');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | undefined>();

  const issueLabels = useMemo(() => {
    const map = new Map<string, IssueLabel>();
    issues.forEach((i) => parseLabels(i.labels).forEach((l) => map.set(l.id, l)));
    return Array.from(map.values());
  }, [issues]);

  const fetchIssues = useCallback(async () => {
    const sp = filtersToParams(filters, sort);
    sp.set('pageSize', '200');
    const data = await api<{ rows: TrackIssueWithStatus[]; total: number }>(
      `/api/track/projects/${projectId}/issues?${sp.toString()}`,
    );
    setIssues(data.rows);
  }, [projectId, filters, sort]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const [p, s, c, m, v, i] = await Promise.all([
          api<TrackProjectRow>(`/api/track/projects/${projectId}`),
          api<{ rows: TrackStatusRow[] }>(`/api/track/projects/${projectId}/statuses`).then((r) => r.rows),
          api<{ rows: TrackCycleRow[] }>(`/api/track/projects/${projectId}/cycles`).then((r) => r.rows),
          api<{ rows: ProjectMember[] }>(`/api/track/projects/${projectId}/members`).then((r) => r.rows),
          api<{ rows: TrackIssueView[] }>(`/api/track/projects/${projectId}/views`).then((r) => r.rows),
          api<{ rows: TrackIssueWithStatus[]; total: number }>(
            `/api/track/projects/${projectId}/issues?pageSize=200`,
          ).then((r) => r.rows),
        ]);
        if (!mounted) return;
        setProject(p);
        setStatuses(s);
        setCycles(c);
        setMembers(m);
        setViews(v);
        setIssues(i);

        // Apply default view if present and no URL state
        const hasUrlState =
          searchParams.toString().length > 0 &&
          (searchParams.get('view') ||
            searchParams.get('sort') ||
            searchParams.get('statusId') ||
            searchParams.get('priority') ||
            searchParams.get('q'));
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
  }, [projectId, searchParams]);

  useEffect(() => {
    if (loading) return;
    fetchIssues();
  }, [filters, sort, fetchIssues, loading]);

  useEffect(() => {
    const sp = filtersToParams(filters, sort);
    sp.set('view', view);
    const qs = sp.toString();
    router.replace(`/${locale}/app/track/projects/${projectId}?${qs}`, { scroll: false });
  }, [filters, sort, view, projectId, locale, router]);

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

  const handleStatusChange = async (issueId: string, statusId: string) => {
    await api(`/api/track/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusId }),
    });
    setIssues((prev) =>
      prev.map((i) => {
        if (i.id !== issueId) return i;
        const status = statuses.find((s) => s.id === statusId);
        return {
          ...i,
          status_id: statusId,
          status_name: status?.name ?? null,
          status_color: status?.color ?? null,
          status_category: status?.category ?? null,
        };
      }),
    );
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
          <Link href={`/${locale}/app/track/projects/${projectId}/issues/new`} className="btn btn-solid">
            {labels.newIssue}
          </Link>
        </div>
      </div>

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
          />
        )}
        {view === 'board' && (
          <IssuesBoard
            issues={issues}
            statuses={statuses}
            locale={locale}
            onStatusChange={handleStatusChange}
            labels={{ noAssignee: labels.noAssignee, empty: labels.board.empty }}
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
      </div>

      {cycles.length > 0 && (
        <section className="panel" style={{ marginTop: 32 }}>
          <p className="section-label">{labels.cycles}</p>
          <ul className="recent-list">
            {cycles.map((c) => (
              <li key={c.id}>
                <div className="recent-row">
                  <span className="recent-name">{c.name}</span>
                  <span className="mono recent-date">
                    {c.start_at.slice(0, 10)} → {c.end_at.slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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
