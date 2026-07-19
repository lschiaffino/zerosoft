'use client';

import { useState } from 'react';
import type { TrackCycleRow, TrackStatusRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';
import type { ProjectMember, TrackIssueWithStatus } from '@/lib/track-data';
import StatusBadge from './StatusBadge';

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
  };
  priorities: Array<{ value: string; label: string }>;
}

const LABEL_COLORS = ['#000000', '#333333', '#666666', '#999999', '#bbbbbb'];

function parseLabels(raw: string): IssueLabel[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function labelsToJson(value: unknown): string {
  if (value == null) return '[]';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function patchIssue(issueId: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/track/issues/${issueId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('update failed');
}

export default function IssuePropertiesPanel({
  issue,
  statuses,
  cycles,
  members,
  labels,
  priorities,
}: IssuePropertiesPanelProps) {
  const [localIssue, setLocalIssue] = useState(issue);
  const [labelInput, setLabelInput] = useState('');

  const issueLabels = parseLabels(localIssue.labels);

  const applyOptimistic = (patch: Record<string, unknown>): Partial<TrackIssueWithStatus> => {
    const out: Partial<TrackIssueWithStatus> = {};
    if ('priority' in patch) out.priority = patch.priority as typeof localIssue.priority;
    if ('dueDate' in patch) out.due_date = (patch.dueDate as string | null) ?? null;
    if ('estimate' in patch) out.estimate = (patch.estimate as number | null) ?? null;
    if ('labels' in patch) out.labels = labelsToJson(patch.labels);
    return out;
  };

  const update = async (patch: Record<string, unknown>, optimistic?: Partial<TrackIssueWithStatus>) => {
    setLocalIssue((prev) => ({ ...prev, ...applyOptimistic(patch), ...optimistic }));
    await patchIssue(localIssue.id, patch);
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

  const addLabel = (name: string, color: string) => {
    const next = [...issueLabels, { id: crypto.randomUUID(), name, color }];
    update({ labels: next }, { labels: JSON.stringify(next) });
  };

  const removeLabel = (id: string) => {
    const next = issueLabels.filter((l) => l.id !== id);
    update({ labels: next }, { labels: JSON.stringify(next) });
  };

  return (
    <div className="track-properties">
      <div className="track-property">
        <label>{labels.status}</label>
        <select value={localIssue.status_id ?? ''} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{labels.none}</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <label>{labels.priority}</label>
        <select
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
        <label>{labels.assignee}</label>
        <select value={localIssue.assignee_id ?? ''} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{labels.noAssignee}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <label>{labels.cycle}</label>
        <select value={localIssue.cycle_id ?? ''} onChange={(e) => setCycle(e.target.value)}>
          <option value="">{labels.none}</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="track-property">
        <label>{labels.dueDate}</label>
        <input
          type="date"
          value={localIssue.due_date ?? ''}
          onChange={(e) => update({ dueDate: e.target.value || null })}
        />
      </div>
      <div className="track-property track-property-stack">
        <label>{labels.labels}</label>
        <div className="track-label-input">
          {issueLabels.map((l) => (
            <span key={l.id} className="track-label-chip" style={{ background: l.color, color: '#fff' }}>
              {l.name}
              <button type="button" onClick={() => removeLabel(l.id)} aria-label="remove">
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const name = labelInput.trim();
                if (!name || issueLabels.length >= 10) return;
                addLabel(name, LABEL_COLORS[issueLabels.length % LABEL_COLORS.length]);
                setLabelInput('');
              }
            }}
            placeholder="Add label"
          />
        </div>
        <div className="track-label-colors">
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="track-label-color"
              style={{ background: c }}
              onClick={() => {
                const name = labelInput.trim();
                if (!name || issueLabels.length >= 10) return;
                addLabel(name, c);
                setLabelInput('');
              }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="track-property">
        <label>{labels.estimate}</label>
        <input
          type="number"
          min={0}
          value={localIssue.estimate ?? ''}
          onChange={(e) => update({ estimate: e.target.value ? Number(e.target.value) : null })}
        />
      </div>
    </div>
  );
}
