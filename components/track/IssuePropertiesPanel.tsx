'use client';

import { useState } from 'react';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import LabelPicker from './LabelPicker';
import { DueDateMenu } from './InlineEditors';
import type { TrackUiLabels } from './ui-labels';

interface IssuePropertiesPanelProps {
  issue: TrackIssueWithStatus;
  statuses: TrackStatusRow[];
  cycles: TrackCycleRow[];
  members: ProjectMember[];
  locale: string;
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
    estimatePlaceholder: string;
    estimateUnit: string;
  };
  priorities: Array<{ value: string; label: string }>;
  /** Textos del selector de fecha (Hoy, Mañana, Elegir fecha). */
  dateLabels: TrackUiLabels['inline'];
  today: string;
  onChange?: () => void;
  /** Un cambio no se pudo guardar (ya se revirtió en el panel). */
  onError?: () => void;
}

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function patchIssue(issueId: string, body: Record<string, unknown>): Promise<TrackIssueWithStatus> {
  const res = await fetch(`/api/track/issues/${issueId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('update failed');
  return (await res.json()) as TrackIssueWithStatus;
}

export default function IssuePropertiesPanel({
  issue,
  statuses,
  cycles,
  members,
  locale,
  labels,
  priorities,
  dateLabels,
  today,
  onChange,
  onError,
}: IssuePropertiesPanelProps) {
  const [localIssue, setLocalIssue] = useState(issue);

  const issueLabels = parseLabels(localIssue.labels);

  const applyOptimistic = (patch: Record<string, unknown>): Partial<TrackIssueWithStatus> => {
    const out: Partial<TrackIssueWithStatus> = {};
    if ('priority' in patch) out.priority = patch.priority as typeof localIssue.priority;
    if ('dueDate' in patch) out.due_date = (patch.dueDate as string | null) ?? null;
    if ('estimate' in patch) out.estimate = (patch.estimate as number | null) ?? null;
    return out;
  };

  const update = async (patch: Record<string, unknown>, optimistic?: Partial<TrackIssueWithStatus>) => {
    const previous = localIssue;
    setLocalIssue((prev) => ({ ...prev, ...applyOptimistic(patch), ...optimistic }));
    try {
      await patchIssue(localIssue.id, patch);
    } catch {
      // El server lo rechazó (p. ej. status o assignee que ya no existen): volver atrás y avisar.
      setLocalIssue(previous);
      onError?.();
      return;
    }
    onChange?.();
  };

  const setStatus = (statusId: string) => {
    const status = statuses.find((s) => s.id === statusId);
    update(
      { statusId: statusId || null },
      {
        status_id: statusId || null,
        status_name: status?.name ?? null,
        status_color: status?.color ?? null,
        status_category: status?.category ?? null,
      },
    );
  };

  const setAssignee = (assigneeId: string) => {
    const member = members.find((m) => m.id === assigneeId);
    update(
      { assigneeId: assigneeId || null },
      {
        assignee_id: assigneeId || null,
        assignee_name: member?.name ?? null,
        assignee_email: member?.email ?? null,
      },
    );
  };

  const setCycle = (cycleId: string) => {
    const cycle = cycles.find((c) => c.id === cycleId);
    update(
      { cycleId: cycleId || null },
      { cycle_id: cycleId || null, cycle_name: cycle?.name ?? null },
    );
  };

  // Los labels se normalizan en el server (labels del workspace): usamos la respuesta.
  const setLabels = async (next: Array<{ id: string } | { name: string }>) => {
    const keep = new Set(next.flatMap((l) => ('id' in l ? [l.id] : [])));
    const previousLabels = localIssue.labels;
    setLocalIssue((prev) => ({ ...prev, labels: JSON.stringify(issueLabels.filter((l) => keep.has(l.id))) }));
    let updated: TrackIssueWithStatus;
    try {
      updated = await patchIssue(localIssue.id, { labels: next });
    } catch {
      setLocalIssue((prev) => ({ ...prev, labels: previousLabels }));
      onError?.();
      return;
    }
    setLocalIssue((prev) => ({ ...prev, labels: updated.labels }));
    onChange?.();
  };

  return (
    <div className="track-properties">
      <div className="track-property">
        <label htmlFor="prop-status">{labels.status}</label>
        <select id="prop-status" className="select" value={localIssue.status_id ?? ''} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{labels.none}</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <label htmlFor="prop-priority">{labels.priority}</label>
        <select
          id="prop-priority"
          className="select"
          value={localIssue.priority}
          onChange={(e) => update({ priority: e.target.value })}
        >
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <label htmlFor="prop-assignee">{labels.assignee}</label>
        <select id="prop-assignee" className="select" value={localIssue.assignee_id ?? ''} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{labels.noAssignee}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <label htmlFor="prop-cycle">{labels.cycle}</label>
        <select id="prop-cycle" className="select" value={localIssue.cycle_id ?? ''} onChange={(e) => setCycle(e.target.value)}>
          <option value="">{labels.none}</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <span className="track-property-label">{labels.dueDate}</span>
        <span className="track-property-date">
          <DueDateMenu
            dueDate={localIssue.due_date}
            locale={locale}
            today={today}
            labels={dateLabels}
            onChange={(dueDate) => void update({ dueDate })}
          />
        </span>
      </div>
      <div className="track-property track-property-top">
        <span className="track-property-label">{labels.labels}</span>
        <LabelPicker value={issueLabels} onChange={(next) => void setLabels(next)} />
      </div>
      <div className="track-property">
        <label htmlFor="prop-estimate">{labels.estimate}</label>
        <span className="track-property-unit">
          <input
            id="prop-estimate"
            className="input"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder={labels.estimatePlaceholder}
            value={localIssue.estimate ?? ''}
            onChange={(e) => update({ estimate: e.target.value ? Number(e.target.value) : null })}
          />
          <span aria-hidden>{labels.estimateUnit}</span>
        </span>
      </div>
    </div>
  );
}
