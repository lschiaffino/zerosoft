'use client';

import { useMemo } from 'react';
import type { TrackStatusRow } from '@/lib/db';
import type { TrackIssueWithStatus } from '@/lib/track-data';
import { groupIssues, groupPreset, type GroupPreset, type IssueGroupBy } from '@/lib/track-views';
import IssuesTable, { type IssuesTableEditing, type OptionalColumn } from './IssuesTable';
import { PriorityIcon, StatusDot } from './InlineEditors';
import EmptyState from '@/components/ui/EmptyState';
import type { IssueSelection } from './BulkEdit';

interface GroupedIssuesTableProps {
  issues: TrackIssueWithStatus[];
  groupBy: Exclude<IssueGroupBy, 'none'>;
  statuses?: TrackStatusRow[];
  /** Nombres de proyecto por id (agrupar por proyecto). */
  projectNames?: Record<string, string>;
  /** Varios proyectos: los status se juntan por nombre. */
  statusByName?: boolean;
  locale: string;
  labels: Parameters<typeof IssuesTable>[0]['labels'];
  groupLabels: { noCycle: string; noLabel: string };
  priorities: Array<{ value: string; label: string }>;
  editing: IssuesTableEditing;
  /** "+ New issue" al pie de cada grupo que se puede asignar, con su valor preseteado. */
  onQuickCreate?: (title: string, preset: GroupPreset, projectId: string) => void;
  /** Proyectos para el quick-add (vista de varios proyectos). */
  quickAddProjects?: Array<{ id: string; name: string }>;
  /**
   * Agrupados con quick-add. Con varios proyectos, persona y cycle dependen
   * del proyecto elegido, así que ahí solo se ofrece en prioridad y proyecto.
   */
  quickAddGroups?: readonly IssueGroupBy[];
  hideColumns?: OptionalColumn[];
  selection?: IssueSelection & { label: string; allLabel: string };
}

/**
 * Lista agrupada: una sección por valor (status, persona, prioridad, cycle,
 * label o proyecto), cada una con su tabla. Dentro de cada grupo se respeta
 * el orden que vino del servidor.
 */
export default function GroupedIssuesTable({
  issues,
  groupBy,
  statuses,
  projectNames,
  statusByName,
  locale,
  labels,
  groupLabels,
  priorities,
  editing,
  onQuickCreate,
  quickAddProjects,
  quickAddGroups,
  hideColumns = [],
  selection,
}: GroupedIssuesTableProps) {
  const groups = useMemo(
    () => groupIssues(issues, groupBy, { statuses, projectNames, statusByName }),
    [issues, groupBy, statuses, projectNames, statusByName],
  );

  if (groups.length === 0) return <EmptyState quiet title={labels.empty} />;

  const title = (key: string, name: string) => {
    if (groupBy === 'priority') return priorities.find((p) => p.value === key)?.label ?? key;
    if (key) return name || editing.projects[key]?.name || key;
    if (groupBy === 'assignee') return labels.noAssignee;
    if (groupBy === 'cycle') return groupLabels.noCycle;
    if (groupBy === 'label') return groupLabels.noLabel;
    return name;
  };

  // La columna del campo agrupado se repetiría en cada fila: se oculta.
  const hidden: OptionalColumn[] = [
    ...hideColumns,
    ...(groupBy === 'assignee' ? (['assignee'] as const) : []),
    ...(groupBy === 'cycle' ? (['cycle'] as const) : []),
    ...(groupBy === 'project' ? (['project'] as const) : []),
  ];

  return (
    <div className="track-mytasks track-groups">
      {groups.map((g) => {
        const id = `track-group-${groupBy}-${g.key || 'none'}`;
        const preset = groupPreset(groupBy, g.key);
        const projectId = groupBy === 'project' ? g.key : undefined;
        const canQuickAdd =
          onQuickCreate && (preset || projectId) && (!quickAddGroups || quickAddGroups.includes(groupBy));
        return (
          <section key={g.key || 'none'} className="track-mytasks-group" aria-labelledby={id}>
            <h2 id={id} className="track-mytasks-title track-group-title">
              {groupBy === 'status' && <StatusDot color={g.color ?? null} category={g.category ?? null} />}
              {groupBy === 'priority' && <PriorityIcon priority={g.key as TrackIssueWithStatus['priority']} />}
              {groupBy === 'label' && g.color && (
                <span className="track-label-tag-dot" style={{ background: g.color }} aria-hidden />
              )}
              {title(g.key, g.name)}
              <span className="track-mytasks-count">{g.issues.length}</span>
            </h2>
            <IssuesTable
              issues={g.issues}
              locale={locale}
              labels={labels}
              editing={editing}
              hideColumns={hidden}
              showHeader={false}
              fixedLayout
              selection={selection}
              quickAdd={
                canQuickAdd
                  ? {
                      onCreate: (text, pid) => onQuickCreate(text, preset ?? {}, pid),
                      projects: projectId ? undefined : quickAddProjects,
                      defaultProjectId: projectId,
                    }
                  : undefined
              }
            />
          </section>
        );
      })}
    </div>
  );
}
