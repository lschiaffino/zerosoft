'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import type { IssuePatch } from '@/lib/track-tasks';
import { formatDay } from '@/lib/track-tasks';
import { safeHexColor } from '@/lib/track-color';
import { openCommandMenu } from '@/lib/cmdk-context';
import { PriorityIcon, StatusDot } from './InlineEditors';
import TrackIcon, { type TrackIconName } from './TrackIcon';
import { estimateChoices } from './trackCommands';
import type { TrackUiLabels } from './ui-labels';

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
  onLabels?: (next: Array<{ id: string } | { name: string }>) => void;
  estimateScale?: string;
}

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function initial(name: string | null | undefined): string {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
}

/**
 * Un valor del panel: un chip con ícono y valor (sin nombre del campo, como
 * Linear) que abre el mismo menú que el atajo, anclado debajo del chip.
 */
function Chip({
  page,
  issueId,
  name,
  value,
  shortcut,
  icon,
  empty,
  testId,
  children,
}: {
  page: string;
  issueId: string;
  /** Nombre del campo (para lectores de pantalla y el title). */
  name: string;
  /** Valor actual en texto (lectores de pantalla). */
  value: string;
  shortcut?: string;
  icon: ReactNode;
  empty?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="track-prop" data-testid={testId}>
      <button
        type="button"
        className={`track-prop-chip${empty ? ' is-empty' : ''}`}
        data-cmd-anchor={page}
        aria-label={`${name}: ${value}`}
        title={shortcut ? `${name} · ${shortcut}` : name}
        aria-keyshortcuts={shortcut}
        onClick={(e) => openCommandMenu(page, { anchor: e.currentTarget, targetId: issueId })}
      >
        <span className="track-prop-icon" aria-hidden>
          {icon}
        </span>
        <span className="track-prop-value">{children ?? value}</span>
      </button>
    </div>
  );
}

function Glyph({ name }: { name: TrackIconName }) {
  return <TrackIcon name={name} size={14} />;
}

/**
 * Panel derecho del issue como el de Linear: una columna angosta, una fila
 * por propiedad con ícono y valor (vacíos en gris con "Set …"), y cada valor
 * abre el mismo menú que su atajo (S, P, A, L, ⇧P, ⇧C, ⇧E, ⇧D): filtro
 * tipeado, flechas, Enter y crear en línea. Los cambios los aplica la página
 * (optimistas, con ⌘Z).
 */
export default function IssueSidebar({ issue, cycles, milestones, locale, ui, today, labels, estimateScale }: IssueSidebarProps) {
  const t = useTranslations('track');
  const tx = useTranslations('track.ux.side');
  const tp = useTranslations('track.ux.props');
  const issueLabels = parseLabels(issue.labels);
  const priorityName =
    issue.priority === 'none' ? tp('setPriority') : (ui.priorities.find((p) => p.value === issue.priority)?.label ?? issue.priority);
  const day = (iso: string | null) => (iso ? formatDay(iso.slice(0, 10), locale, today) : null);
  const due = day(issue.due_date);
  const start = day(issue.start_date);
  const overdue = Boolean(issue.due_date && issue.due_date.slice(0, 10) < today && issue.status_category !== 'done' && issue.status_category !== 'cancelled');

  return (
    <div className="track-side" aria-label={labels.title} role="group">
      <Chip
        page="status"
        issueId={issue.id}
        name={labels.status}
        value={issue.status_name ?? labels.none}
        shortcut="S"
        icon={<StatusDot color={issue.status_color} category={issue.status_category} />}
        testId="track-side-status"
      />
      <Chip
        page="priority"
        issueId={issue.id}
        name={labels.priority}
        value={priorityName}
        shortcut="P"
        empty={issue.priority === 'none'}
        icon={<PriorityIcon priority={issue.priority} />}
        testId="track-side-priority"
      />
      <Chip
        page="assignee"
        issueId={issue.id}
        name={labels.assignee}
        value={issue.assignee_id ? (issue.assignee_name || issue.assignee_email || '–') : tp('assign')}
        shortcut="A"
        empty={!issue.assignee_id}
        icon={
          issue.assignee_id ? (
            <span className="track-avatar is-small">{initial(issue.assignee_name || issue.assignee_email)}</span>
          ) : (
            <span className="track-avatar is-small track-avatar-empty" />
          )
        }
        testId="track-side-assignee"
      />

      <div className="track-prop-group" role="group" aria-label={labels.labels} data-testid="track-side-labels">
        {issueLabels.length === 0 ? (
          <Chip page="labels" issueId={issue.id} name={labels.labels} value={tp('addLabel')} shortcut="L" empty icon={<Glyph name="tag" />} />
        ) : (
          <div className="track-prop track-prop-labels">
            {issueLabels.map((l) => (
              <button
                key={l.id}
                type="button"
                className="track-label-chip"
                data-cmd-anchor="labels"
                aria-label={`${labels.labels}: ${l.name}`}
                onClick={(e) => openCommandMenu('labels', { anchor: e.currentTarget, targetId: issue.id })}
              >
                <span className="track-label-dot" style={{ background: safeHexColor(l.color, '#767676') }} aria-hidden />
                {l.name}
              </button>
            ))}
            <button
              type="button"
              className="track-label-chip is-add"
              aria-label={tp('addLabel')}
              title={`${tp('addLabel')} · L`}
              onClick={(e) => openCommandMenu('labels', { anchor: e.currentTarget, targetId: issue.id })}
            >
              <TrackIcon name="plus" size={12} />
            </button>
          </div>
        )}
      </div>

      <Chip
        page="project"
        issueId={issue.id}
        name={tx('plan')}
        value={issue.plan_name ?? tp('addProject')}
        shortcut="⇧P"
        empty={!issue.plan_id}
        icon={<Glyph name="plans" />}
        testId="track-side-plan"
      />
      {cycles.length > 0 && (
        <Chip
          page="cycle"
          issueId={issue.id}
          name={labels.cycle}
          value={issue.cycle_name ?? tp('addCycle')}
          shortcut="⇧C"
          empty={!issue.cycle_id}
          icon={<Glyph name="cycle" />}
          testId="track-side-cycle"
        />
      )}
      {/* Un solo Milestone (como Linear): el del project si el issue tiene project, si no el del team. */}
      {(issue.plan_id || milestones.length > 0) && (
        <Chip
          page="milestone"
          issueId={issue.id}
          name={t('milestones.property')}
          value={(issue.plan_id ? issue.plan_milestone_name : issue.milestone_name) ?? tp('addMilestone')}
          empty={!(issue.plan_id ? issue.plan_milestone_id : issue.milestone_id)}
          icon={<Glyph name="milestone" />}
          testId="track-prop-milestone"
        />
      )}
      {estimateScale !== 'none' && (
        <Chip
          page="estimate"
          issueId={issue.id}
          name={labels.estimate}
          value={
            issue.estimate == null
              ? tp('setEstimate')
              : (estimateChoices(estimateScale).find((o) => o.value === issue.estimate)?.label ?? tx('points', { count: issue.estimate }))
          }
          shortcut="⇧E"
          empty={issue.estimate == null}
          icon={<Glyph name="estimate" />}
          testId="track-side-estimate"
        />
      )}
      <Chip
        page="start"
        issueId={issue.id}
        name={t('issues.startDate')}
        value={start ?? tp('setStart')}
        empty={!start}
        icon={<Glyph name="calendar" />}
        testId="track-property-start"
      />
      <Chip
        page="due"
        issueId={issue.id}
        name={labels.dueDate}
        value={due ?? tp('setDue')}
        shortcut="⇧D"
        empty={!due}
        icon={<Glyph name="calendar" />}
        testId="track-property-due"
      >
        {due ? <span className={overdue ? 'is-overdue' : undefined}>{due}</span> : undefined}
      </Chip>
    </div>
  );
}
