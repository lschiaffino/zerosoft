'use client';

import { useMemo, useState } from 'react';
import type { TrackIssueWithStatus, TrackProjectMeta } from '@/lib/track-data';
import { DUE_BUCKETS, groupByDue, parseQuickTitle, type DueBucket } from '@/lib/track-tasks';
import IssuesTable, { type OptionalColumn } from './IssuesTable';
import QuickIssueModal from './QuickIssueModal';
import { QuickAdd, TrackToast, useToday } from './InlineEditors';
import { useCreateShortcut, useIssueStore, type IssueDraft, type ProjectMap } from './useIssueStore';
import type { TrackUiLabels } from './ui-labels';

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
  /** "My tasks": agrupa por vencimiento y asigna lo nuevo a este usuario. */
  mine?: {
    userId: string;
    groups: Record<DueBucket, string>;
    empty: string;
  };
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
  mine,
}: CrossProjectIssuesProps) {
  const today = useToday();
  const [modalOpen, setModalOpen] = useState(false);
  const projectMap = useMemo<ProjectMap>(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const store = useIssueStore(initialIssues, projectMap, {
    saveError: ui.inline.saveError,
    createError: ui.inline.createError,
    noDoneStatus: ui.inline.noDoneStatus,
  });

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
      <div className="track-page-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="btn btn-solid"
          onClick={() => setModalOpen(true)}
          disabled={projects.length === 0}
          title={ui.modal.shortcutHint}
          aria-keyshortcuts="C"
        >
          {newIssueLabel}
          <kbd className="track-kbd" aria-hidden>
            C
          </kbd>
        </button>
      </div>

      {mine && groups ? (
        <div className="track-mytasks">
          {projects.length > 0 && (
            <div className="track-mytasks-add">
              <QuickAdd labels={ui.quick} onCreate={quickCreate} projects={projectOptions} />
            </div>
          )}
          {store.issues.length === 0 && (
            <div className="track-empty">
              <p className="track-empty-zeros mono" aria-hidden>
                0 0 0
              </p>
              <p>{mine.empty}</p>
            </div>
          )}
          {DUE_BUCKETS.filter((b) => groups[b].length > 0).map((bucket) => (
            <section key={bucket} className={`track-mytasks-group is-${bucket}`} aria-labelledby={`grp-${bucket}`}>
              <h2 id={`grp-${bucket}`} className="track-mytasks-title">
                {mine.groups[bucket]}
                <span className="track-mytasks-count mono">{groups[bucket].length}</span>
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
    </>
  );
}
