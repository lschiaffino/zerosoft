'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { TrackStatusRow, TrackCycleRow } from '@/lib/db';
import type { IssueLabel } from '@/lib/track-schema';

interface IssueFormProps {
  locale: string;
  projectId: string;
  statuses: TrackStatusRow[];
  cycles: TrackCycleRow[];
  labels: {
    title: string;
    titlePlaceholder: string;
    description: string;
    status: string;
    priority: string;
    assignee: string;
    cycle: string;
    estimate: string;
    dueDate: string;
    labels: string;
    create: string;
    saving: string;
    cancel: string;
    genericError: string;
  };
  priorities: Array<{ value: string; label: string }>;
}

const LABEL_COLORS = ['#000000', '#333333', '#666666', '#999999', '#bbbbbb'];

export default function IssueForm({ locale, projectId, statuses, cycles, labels, priorities }: IssueFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? '');
  const [priority, setPriority] = useState('medium');
  const [cycleId, setCycleId] = useState('');
  const [estimate, setEstimate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [issueLabels, setIssueLabels] = useState<IssueLabel[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/track/projects/${projectId}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() ? [{ type: 'text', text: description.trim() }] : [],
          statusId: statusId || undefined,
          priority,
          cycleId: cycleId || undefined,
          estimate: estimate ? Number(estimate) : undefined,
          dueDate: dueDate || undefined,
          labels: issueLabels.length ? issueLabels : undefined,
        }),
      });

      const data: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { error?: string }).error ?? 'generic';
        setError(code);
        setSubmitting(false);
        return;
      }

      const issue = data as { id: string };
      router.push(`/${locale}/app/track/issues/${issue.id}`);
    } catch {
      setError('generic');
      setSubmitting(false);
    }
  }

  return (
    <form className="track-form" onSubmit={onSubmit}>
      {error && <p className="form-error">{labels.genericError}</p>}

      <div className="track-form-row">
        <label htmlFor="title">{labels.title}</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={labels.titlePlaceholder}
          required
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="description">{labels.description}</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="status">{labels.status}</label>
        <select id="status" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="track-form-row">
        <label htmlFor="priority">{labels.priority}</label>
        <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {priorities.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="track-form-row">
        <label htmlFor="cycle">{labels.cycle}</label>
        <select id="cycle" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
          <option value="">—</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="track-form-row">
        <label htmlFor="estimate">{labels.estimate}</label>
        <input
          id="estimate"
          type="number"
          min={0}
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="dueDate">{labels.dueDate}</label>
        <input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>

      <div className="track-form-row">
        <label htmlFor="labels">{labels.labels}</label>
        <div className="track-label-input">
          {issueLabels.map((l, idx) => (
            <span
              key={l.id}
              className="track-label-chip"
              style={{ background: l.color, color: '#fff' }}
            >
              {l.name}
              <button
                type="button"
                onClick={() => setIssueLabels((prev) => prev.filter((_, i) => i !== idx))}
                aria-label="remove"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="labels"
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const name = labelInput.trim();
                if (!name || issueLabels.length >= 10) return;
                const color = LABEL_COLORS[issueLabels.length % LABEL_COLORS.length];
                setIssueLabels((prev) => [...prev, { id: crypto.randomUUID(), name, color }]);
                setLabelInput('');
              }
            }}
            placeholder="Type and press Enter"
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
                setIssueLabels((prev) => [...prev, { id: crypto.randomUUID(), name, color: c }]);
                setLabelInput('');
              }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
      </div>

      <div className="track-form-actions">
        <button type="submit" className="btn btn-solid" disabled={submitting || !title.trim()}>
          {submitting ? labels.saving : labels.create}
        </button>
      </div>
    </form>
  );
}
