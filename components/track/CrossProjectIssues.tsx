'use client';

import { useMemo, useRef, useState } from 'react';
import type { TrackIssueWithStatus, TrackProjectMeta } from '@/lib/track-data';
import { DUE_BUCKETS, groupByDue, parseQuickTitle, type DueBucket } from '@/lib/track-tasks';
import IssuesTable, { type OptionalColumn } from './IssuesTable';
import QuickIssueModal from './QuickIssueModal';
import { QuickAdd, TrackToast, useToday } from './InlineEditors';
import { useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

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
}: CrossProjectIssuesProps) {
  const today = useToday();
  const [modalOpen, setModalOpen] = useState(false);
  const projectMap = useMemo<ProjectMap>(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const store = useIssueStore(initialIssues, projectMap, {
    saveError: ui.inline.saveError,
    createError: ui.inline.createError,
    noDoneStatus: ui.inline.noDoneStatus,
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
      const res = await fetch(`/api/track/issues?page=${next}&pageSize=${pagination.pageSize}`).catch(() => null);
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

  useCreateShortcut(() => setModalOpen(true), projects.length > 0 && !modalOpen);

  const projectOptions = useMemo(() => projects.map((p) => ({ id: p.id, name: p.name })), [projects]);

  const create = (projectId: string, draft: IssueDraft) => {
    void store.create(projectId, mine ? { assigneeId: mine.userId, ...draft } : draft);
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

  const hideColumns: OptionalColumn[] = mine ? ['assignee', 'cycle', 'labels', 'created'] : ['cycle', 'created', 'labels'];

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
          action={{ label: empty.noProjectsCta, href: '/app/track/projects?newProject=1' }}
        />
      ) : null}

      {projects.length === 0 ? null : mine && groups ? (
        <div className="track-mytasks">
          {projects.length > 0 && (
            <div className="track-mytasks-add">
              <QuickAdd labels={ui.quick} onCreate={quickCreate} projects={projectOptions} />
            </div>
          )}
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
              />
            </section>
          ))}
        </div>
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
