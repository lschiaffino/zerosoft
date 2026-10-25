'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { TrackIssueWithStatus, TrackProjectMeta } from '@/lib/track-data';
import { DUE_BUCKETS, formatDay, groupByDue, parseQuickTitle, type DueBucket } from '@/lib/track-tasks';
import { rowTargetId, useTrackCommands } from './trackCommands';
import { pendingDeleteIds } from './trackUndo';
import { useTrackLive } from './useTrackLive';
import { useWorkspaceLabels } from './LabelPicker';
import IssuesTable, { type OptionalColumn } from './IssuesTable';
import { TrackToast, useToday } from './InlineEditors';
import { useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import IssueDisplayOptions from './IssueDisplayOptions';
import GroupedIssuesTable from './GroupedIssuesTable';
import { ISSUE_GROUPS, parseIssueGroup, type IssueGroupBy, type IssueSort } from '@/lib/track-views';
import dynamic from 'next/dynamic';

// El alta rápida (con el editor visual) se baja al abrirla.
const QuickIssueModal = dynamic(() => import('./QuickIssueModal'));

interface TableLabels {
  identifier: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  cycle: string;
  created: string;
  dueDate: string;
  labels: string;
  noAssignee: string;
  empty: string;
  hasSubtasks: string;
  project: string;
}

interface CrossProjectIssuesProps {
  /** Usuario actual ("Asignarme" con I). */
  userId?: string;
  initialIssues: TrackIssueWithStatus[];
  projects: TrackProjectMeta[];
  locale: string;
  labels: TableLabels;
  ui: TrackUiLabels;
  newIssueLabel: string;
  title: string;
  subtitle?: string;
  /** Página Issues: total del servidor y "cargar más" contra /api/track/issues. */
  pagination?: {
    total: number;
    pageSize: number;
    /** `showing` es la plantilla ICU cruda con {shown} y {total}. */
    labels: { loading: string; loadMore: string; showing: string };
  };
  /** Página Issues: agrupar y ordenar, guardado en la URL (?group=&sort=). */
  display?: { sort: IssueSort; group: IssueGroupBy };
  /** "My tasks": agrupa por vencimiento y asigna lo nuevo a este usuario. */
  mine?: {
    userId: string;
    groups: Record<DueBucket, string>;
    empty: string;
    emptyBody: string;
  };
  /** Vacío cuando todavía no hay proyectos. */
  empty: { noProjectsTitle: string; noProjectsBody: string; noProjectsCta: string };
}

/**
 * Lista editable de issues de varios proyectos (página Issues y My tasks):
 * checkbox, edición inline, quick-add con selector de proyecto y modal con "C".
 */
export default function CrossProjectIssues({
  userId,
  initialIssues,
  projects,
  locale,
  labels,
  ui,
  newIssueLabel,
  title,
  subtitle,
  pagination,
  mine,
  empty,
  display,
}: CrossProjectIssuesProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sort, setSort] = useState<IssueSort>(display?.sort ?? 'newest');
  const [group, setGroup] = useState<IssueGroupBy>(display?.group ?? 'none');
  const today = useToday();
  const [modalOpen, setModalOpen] = useState(false);
  const projectMap = useMemo<ProjectMap>(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const tx = useTranslations('track.ux');
  const tc = useTranslations('track.ux.cmd');
  const updatedLabel = useCallback(
    (what: string, count: number) => (count === 1 ? tx('undo.updatedOne', { id: what }) : tx('undo.updatedMany', { count })),
    [tx],
  );
  const store = useIssueStore(initialIssues, projectMap, {
    saveError: ui.inline.saveError,
    createError: ui.inline.createError,
    noDoneStatus: ui.inline.noDoneStatus,
    updated: updatedLabel,
  });
  const [workspaceLabels] = useWorkspaceLabels();

  // Cambios de otros: el servidor vuelve a renderizar la lista y se toma acá.
  const { setIssues } = store;
  useEffect(() => {
    const hidden = pendingDeleteIds();
    setIssues(initialIssues.filter((i) => !hidden.has(i.id)));
  }, [initialIssues, setIssues]);
  useTrackLive({ workspace: true }, () => router.refresh(), { syncOnStart: true });

  const allStatuses = useMemo(() => projects.flatMap((p) => p.statuses), [projects]);
  const allMembers = useMemo(() => {
    const seen = new Map<string, TrackProjectMeta['members'][number]>();
    projects.forEach((p) => p.members.forEach((m) => seen.set(m.id, m)));
    return Array.from(seen.values());
  }, [projects]);
  useTrackCommands({
    lookup: (id) => store.issues.find((i) => i.id === id),
    getTargets: () => {
      const id = rowTargetId();
      const row = id ? store.issues.find((i) => i.id === id) : null;
      return row ? [row] : [];
    },
    data: {
      statuses: allStatuses,
      members: allMembers,
      labels: workspaceLabels,
      cycles: [],
      milestones: [],
      priorities: ui.priorities,
      meId: userId ?? '',
      today,
    },
    handlers: {
      apply: (targets, patch) => void store.updateMany(targets.map((i) => i.id), patch),
      createSubIssue: (parent) => router.push(`/app/track/issues/${parent.id}?sub=1`),
      open: (issue) => router.push(`/app/track/issues/${issue.id}`),
    },
    t: (k, v) => tc(k, v),
    formatDay: (iso) => formatDay(iso, locale, today),
  });

  const [total, setTotal] = useState(pagination?.total ?? 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadedPage = useRef(1);

  const loadMore = async () => {
    if (!pagination || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = loadedPage.current + 1;
      const res = await fetch(`/api/track/issues?page=${next}&pageSize=${pagination.pageSize}&sort=${sort}`).catch(
        () => null,
      );
      if (!res?.ok) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      const data = (await res.json()) as { rows: TrackIssueWithStatus[]; total: number };
      loadedPage.current = next;
      setTotal(data.total);
      // Lo creado acá corre los offsets: no repetir filas que ya están.
      store.setIssues((list) => {
        const seen = new Set(list.map((i) => i.id));
        return [...list, ...data.rows.filter((i) => !seen.has(i.id))];
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // Cambiar el orden vuelve a la primera página (el orden lo resuelve el servidor).
  const sortRequest = useRef(0);
  const changeSort = async (next: IssueSort) => {
    if (!pagination) return;
    setSort(next);
    const seq = ++sortRequest.current;
    const res = await fetch(`/api/track/issues?page=1&pageSize=${pagination.pageSize}&sort=${next}`).catch(() => null);
    if (seq !== sortRequest.current) return;
    if (!res?.ok) {
      setLoadError(true);
      return;
    }
    const data = (await res.json()) as { rows: TrackIssueWithStatus[]; total: number };
    loadedPage.current = 1;
    setTotal(data.total);
    store.setIssues(data.rows);
  };

  // La URL guarda el agrupado y el orden: recargar o compartir el link mantiene la vista.
  const syncUrl = (nextGroup: IssueGroupBy, nextSort: IssueSort) => {
    const sp = new URLSearchParams();
    if (nextGroup !== 'none') sp.set('group', nextGroup);
    if (nextSort !== 'newest') sp.set('sort', nextSort);
    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const projectNames = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects]);

  useCreateShortcut(() => setModalOpen(true), projects.length > 0 && !modalOpen);

  const projectOptions = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name })), [projects]);

  const listGroup = parseIssueGroup(group, ISSUE_GROUPS);

  const create = (projectId: string, draft: IssueDraft) => {
    void store.create(projectId, mine ? { assigneeId: mine.userId, ...draft } : draft, sort);
  };

  const quickCreate = (raw: string, projectId: string) => {
    const parsed = parseQuickTitle(raw, today);
    if (!parsed.title) return;
    create(projectId, { title: parsed.title, priority: parsed.priority, dueDate: parsed.dueDate });
  };

  const editing = {
    projects: projectMap,
    onUpdate: (issueId: string, patch: Parameters<typeof store.update>[1]) => void store.update(issueId, patch),
    onToggleDone: (issue: TrackIssueWithStatus) => void store.toggleDone(issue),
    ui,
    today,
  };

  const hideColumns: OptionalColumn[] = mine ? ['assignee', 'cycle'] : ['cycle'];

  const groups = useMemo(() => (mine ? groupByDue(store.issues, today) : null), [mine, store.issues, today]);

  return (
    <>
      <PageHeader
        title={title}
        description={subtitle}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
            disabled={projects.length === 0}
            title={ui.modal.shortcutHint}
            aria-keyshortcuts="C"
          >
            {newIssueLabel}
            <kbd className="kbd track-kbd" aria-hidden>
              C
            </kbd>
          </button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          title={empty.noProjectsTitle}
          body={empty.noProjectsBody}
          action={{ label: empty.noProjectsCta, href: '/app/track/teams?newProject=1' }}
        />
      ) : null}

      {projects.length === 0 ? null : mine && groups ? (
        <div className="track-mytasks">
          {store.issues.length === 0 && <EmptyState quiet title={mine.empty} body={mine.emptyBody} />}
          {DUE_BUCKETS.filter((b) => groups[b].length > 0).map((bucket) => (
            <section key={bucket} className={`track-mytasks-group is-${bucket}`} aria-labelledby={`grp-${bucket}`}>
              <h2 id={`grp-${bucket}`} className="track-mytasks-title">
                {mine.groups[bucket]}
                <span className="track-mytasks-count">{groups[bucket].length}</span>
              </h2>
              <IssuesTable
                issues={groups[bucket]}
                locale={locale}
                labels={labels}
                editing={editing}
                hideColumns={hideColumns}
                showHeader={false}
                fixedLayout
              />
            </section>
          ))}
        </div>
      ) : (
        <>
          {display && (
            <div className="track-toolbar">
              <IssueDisplayOptions
                group={listGroup}
                groups={ISSUE_GROUPS}
                sort={sort}
                onGroupChange={(g) => {
                  setGroup(g);
                  syncUrl(g, sort);
                }}
                onSortChange={(s) => {
                  syncUrl(listGroup, s);
                  void changeSort(s);
                }}
                labels={ui.display}
              />
            </div>
          )}
          {listGroup !== 'none' ? (
            <GroupedIssuesTable
              issues={store.issues}
              groupBy={listGroup}
              projectNames={projectNames}
              statusByName
              locale={locale}
              labels={labels}
              groupLabels={ui.display}
              priorities={ui.priorities}
              editing={editing}
              hideColumns={hideColumns}
              quickAddProjects={projectOptions}
              quickAddGroups={['priority', 'project']}
              onQuickCreate={(text, preset, projectId) => {
                const parsed = parseQuickTitle(text, today);
                if (!parsed.title || !projectId) return;
                create(projectId, {
                  ...preset,
                  title: parsed.title,
                  priority: parsed.priority ?? preset.priority,
                  dueDate: parsed.dueDate,
                });
              }}
            />
          ) : (
            <IssuesTable
              issues={store.issues}
              locale={locale}
              labels={labels}
              editing={editing}
              hideColumns={hideColumns}
              quickAdd={projects.length > 0 ? { onCreate: quickCreate, projects: projectOptions } : undefined}
            />
          )}
        </>
      )}

      {!mine && pagination && total > 0 && (
        <div className="track-pagination">
          <p className="track-pagination-count" role="status">
            {pagination.labels.showing
              .replace('{shown}', String(store.issues.length))
              .replace('{total}', String(Math.max(total, store.issues.length)))}
          </p>
          {loadedPage.current * pagination.pageSize < total && (
            <button type="button" className="btn btn-sm" onClick={() => void loadMore()} aria-busy={loadingMore || undefined}>
              {pagination.labels.loadMore}
            </button>
          )}
        </div>
      )}

      <QuickIssueModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projects={projects}
        defaults={mine ? { assigneeId: mine.userId } : undefined}
        onCreate={create}
        labels={ui}
        today={today}
      />
      <TrackToast message={store.error} onDismiss={store.clearError} dismissLabel={ui.inline.dismiss} />
      <TrackToast
        message={store.error || !loadError ? null : ui.inline.loadError}
        onDismiss={() => setLoadError(false)}
        dismissLabel={ui.inline.dismiss}
      />
    </>
  );
}
