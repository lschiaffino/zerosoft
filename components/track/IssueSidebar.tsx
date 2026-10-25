'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import type { IssuePatch } from '@/lib/track-tasks';
import LabelPicker from './LabelPicker';
import { AssigneeMenu, DueDateMenu, OptionList, Popover, PriorityMenu, StatusMenu } from './InlineEditors';
import TrackIcon, { type TrackIconName } from './TrackIcon';
import type { TrackUiLabels } from './ui-labels';
import { ESTIMATE_OPTIONS } from './trackCommands';

interface IssueSidebarProps {
  issue: TrackIssueWithStatus;
  projectId: string;
  projectName: string;
  statuses: TrackStatusRow[];
  cycles: TrackCycleRow[];
  milestones: Array<{ id: string; name: string }>;
  members: ProjectMember[];
  locale: string;
  ui: TrackUiLabels;
  today: string;
  labels: {
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    estimate: string;
    dueDate: string;
    labels: string;
    noAssignee: string;
    none: string;
    title: string;
  };
  onPatch: (patch: IssuePatch) => void;
  /** Labels por id o por nombre (se crean al vuelo). */
  onLabels: (next: Array<{ id: string } | { name: string }>) => void;
}

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function Row({
  label,
  icon,
  shortcut,
  children,
  testId,
  top = false,
}: {
  label: string;
  icon: TrackIconName;
  shortcut?: string;
  children: ReactNode;
  testId?: string;
  top?: boolean;
}) {
  return (
    <div className={`track-side-row${top ? ' is-top' : ''}`} data-testid={testId} title={shortcut ? `${label} · ${shortcut}` : undefined}>
      <span className="track-side-label">
        <TrackIcon name={icon} size={12} />
        <span className="track-property-label">{label}</span>
      </span>
      <span className="track-side-value">{children}</span>
    </div>
  );
}

/**
 * Panel derecho del issue al estilo Linear: una fila por propiedad, con
 * ícono, valor y el mismo selector que el atajo (S, P, A, L, ⇧E, ⇧D, ⇧C).
 * Los cambios son optimistas y se deshacen con ⌘Z (los maneja la página).
 */
export default function IssueSidebar({
  issue,
  projectId,
  projectName,
  statuses,
  cycles,
  milestones,
  members,
  locale,
  ui,
  today,
  labels,
  onPatch,
  onLabels,
}: IssueSidebarProps) {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux.side');
  const issueLabels = parseLabels(issue.labels);
  const estimate = issue.estimate;

  return (
    <div className="track-side" aria-label={labels.title} role="group">
      <Row label={labels.status} icon="check" shortcut="S" testId="track-side-status">
        <StatusMenu
          statusId={issue.status_id}
          statusName={issue.status_name}
          statusColor={issue.status_color}
          statusCategory={issue.status_category}
          statuses={statuses}
          label={labels.status}
          onChange={(statusId) => onPatch({ statusId })}
        />
      </Row>
      <Row label={labels.priority} icon="flag" shortcut="P" testId="track-side-priority">
        <PriorityMenu
          priority={issue.priority}
          priorities={ui.priorities}
          label={labels.priority}
          onChange={(priority) => onPatch({ priority })}
        />
      </Row>
      <Row label={labels.assignee} icon="user" shortcut="A" testId="track-side-assignee">
        <AssigneeMenu
          assigneeId={issue.assignee_id}
          assigneeName={issue.assignee_name}
          assigneeEmail={issue.assignee_email}
          members={members}
          label={labels.assignee}
          noAssignee={labels.noAssignee}
          onChange={(assigneeId) => onPatch({ assigneeId })}
        />
      </Row>
      <Row label={labels.labels} icon="tag" shortcut="L" testId="track-side-labels" top>
        <LabelPicker value={issueLabels} onChange={onLabels} />
      </Row>
      <Row label={tx('project')} icon="settings" testId="track-side-project">
        <Link href={`/app/track/projects/${projectId}`} className="track-side-link">
          {projectName}
        </Link>
      </Row>
      {cycles.length > 0 && (
        <Row label={labels.cycle} icon="cycle" shortcut="⇧C" testId="track-side-cycle">
          <Popover
            ariaLabel={`${labels.cycle}: ${issue.cycle_name ?? labels.none}`}
            width={220}
            trigger={<span className={`track-inline-text${issue.cycle_id ? '' : ' is-dim'}`}>{issue.cycle_name ?? labels.none}</span>}
          >
            {(close) => (
              <OptionList
                value={issue.cycle_id ?? ''}
                options={[{ value: '', label: labels.none }, ...cycles.map((c) => ({ value: c.id, label: c.name }))]}
                onSelect={(v) => {
                  close();
                  if ((v || null) !== issue.cycle_id) onPatch({ cycleId: v || null });
                }}
              />
            )}
          </Popover>
        </Row>
      )}
      {milestones.length > 0 && (
        <Row label={t('milestones.property')} icon="flag" testId="track-prop-milestone">
          <Popover
            ariaLabel={`${t('milestones.property')}: ${issue.milestone_name ?? labels.none}`}
            width={220}
            trigger={<span className={`track-inline-text${issue.milestone_id ? '' : ' is-dim'}`}>{issue.milestone_name ?? labels.none}</span>}
          >
            {(close) => (
              <OptionList
                value={issue.milestone_id ?? ''}
                options={[{ value: '', label: labels.none }, ...milestones.map((m) => ({ value: m.id, label: m.name }))]}
                onSelect={(v) => {
                  close();
                  if ((v || null) !== (issue.milestone_id ?? null)) onPatch({ milestoneId: v || null });
                }}
              />
            )}
          </Popover>
        </Row>
      )}
      <Row label={labels.estimate} icon="estimate" shortcut="⇧E" testId="track-side-estimate">
        <Popover
          ariaLabel={`${labels.estimate}: ${estimate ?? labels.none}`}
          width={180}
          trigger={
            <span className={`track-inline-text${estimate == null ? ' is-dim' : ''}`}>
              {estimate == null ? labels.none : tx('points', { count: estimate })}
            </span>
          }
        >
          {(close) => (
            <OptionList
              value={estimate == null ? '' : String(estimate)}
              options={[
                { value: '', label: labels.none },
                ...ESTIMATE_OPTIONS.map((n) => ({ value: String(n), label: tx('points', { count: n }) })),
              ]}
              onSelect={(v) => {
                close();
                const next = v === '' ? null : Number(v);
                if (next !== estimate) onPatch({ estimate: next });
              }}
            />
          )}
        </Popover>
      </Row>
      <Row label={t('issues.startDate')} icon="calendar" testId="track-property-start">
        <DueDateMenu
          dueDate={issue.start_date}
          locale={locale}
          today={today}
          labels={ui.inline}
          label={t('issues.startDate')}
          plain
          onChange={(startDate) => onPatch({ startDate })}
        />
      </Row>
      <Row label={labels.dueDate} icon="calendar" shortcut="⇧D" testId="track-property-due">
        <DueDateMenu
          dueDate={issue.due_date}
          locale={locale}
          today={today}
          labels={ui.inline}
          onChange={(dueDate) => onPatch({ dueDate })}
        />
      </Row>
    </div>
  );
}
