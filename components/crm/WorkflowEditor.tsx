'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { Workflow, WorkflowTriggerInput, WorkflowActionInput } from '@/lib/crm-workflows';
import type { CrmWorkflowRunRow, CrmListRow } from '@/lib/db';
import WorkflowRuns from './WorkflowRuns';

const TRIGGER_TYPES = [
  'contact_created',
  'contact_updated',
  'deal_created',
  'deal_updated',
  'deal_stage_changed',
  'deal_won',
  'deal_lost',
  'task_due',
  'email_received',
  'meeting_booked',
  'manual',
] as const;

const ACTION_TYPES = [
  'send_email',
  'create_task',
  'create_activity',
  'update_field',
  'add_to_list',
  'webhook',
  'notify_user',
] as const;

interface WorkflowEditorProps {
  workflow: Workflow | null;
  lists: CrmListRow[];
  runs: CrmWorkflowRunRow[];
  labels: {
    name: string;
    enabled: string;
    disabled: string;
    triggers: string;
    actions: string;
    addTrigger: string;
    addAction: string;
    save: string;
    saving: string;
    runNow: string;
    delete: string;
    deleteConfirm: string;
    runs: string;
    noRuns: string;
    runStatus: Record<string, string>;
    triggerTypes: Record<string, string>;
    actionTypes: Record<string, string>;
    fromStageId: string;
    toStageId: string;
    to: string;
    subject: string;
    body: string;
    dueInDays: string;
    ownerId: string;
    entity: string;
    field: string;
    value: string;
    listId: string;
    url: string;
    method: string;
    headers: string;
    message: string;
  };
}

export default function WorkflowEditor({ workflow, lists, runs, labels }: WorkflowEditorProps) {
  const router = useRouter();
  const isNew = !workflow;
  const [name, setName] = useState(workflow?.name ?? '');
  const [enabled, setEnabled] = useState(workflow?.enabled ?? true);
  const [triggers, setTriggers] = useState<WorkflowTriggerInput[]>(
    workflow?.triggers.length
      ? workflow.triggers.map((t) => ({ type: t.type, config: t.config, position: t.position }))
      : [{ type: 'contact_created', config: {} }],
  );
  const [actions, setActions] = useState<WorkflowActionInput[]>(
    workflow?.actions.length
      ? workflow.actions.map((a) => ({ type: a.type, config: a.config, position: a.position }))
      : [{ type: 'create_task', config: { subject: '' } }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateTrigger(index: number, patch: Partial<WorkflowTriggerInput>) {
    setTriggers((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  }

  function updateTriggerConfig(index: number, patch: Record<string, unknown>) {
    setTriggers((prev) =>
      prev.map((t, i) =>
        i === index ? { ...t, config: { ...(t.config ?? {}), ...patch } } : t,
      ),
    );
  }

  function removeTrigger(index: number) {
    setTriggers((prev) => prev.filter((_, i) => i !== index));
  }

  function addTrigger() {
    setTriggers((prev) => [...prev, { type: 'contact_created', config: {} }]);
  }

  function moveAction(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= actions.length) return;
    setActions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(next, 0, moved);
      return copy.map((a, i) => ({ ...a, position: i }));
    });
  }

  function updateAction(index: number, patch: Partial<WorkflowActionInput>) {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  }

  function updateActionConfig(index: number, patch: Record<string, unknown>) {
    setActions((prev) =>
      prev.map((a, i) =>
        i === index ? { ...a, config: { ...(a.config ?? {}), ...patch } } : a,
      ),
    );
  }

  function removeAction(index: number) {
    setActions((prev) => prev.filter((_, i) => i !== index));
  }

  function addAction() {
    setActions((prev) => [...prev, { type: 'create_task', config: { subject: '' } }]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      name,
      enabled,
      triggers: triggers.map((t, i) => ({ ...t, position: t.position ?? i })),
      actions: actions.map((a, i) => ({ ...a, position: a.position ?? i })),
    };

    const res = isNew
      ? await fetch('/api/crm/workflows', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      : await fetch(`/api/crm/workflows/${workflow!.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'save_failed');
      return;
    }
    const saved = (await res.json()) as Workflow;
    if (isNew) {
      router.push(`/app/crm/workflows/${saved.id}`);
    } else {
      router.refresh();
    }
  }

  async function run() {
    if (!workflow) return;
    await fetch(`/api/crm/workflows/${workflow.id}/run`, { method: 'POST' }).catch(() => null);
    router.refresh();
  }

  async function remove() {
    if (!workflow || !confirm(labels.deleteConfirm)) return;
    await fetch(`/api/crm/workflows/${workflow.id}`, { method: 'DELETE' }).catch(() => null);
    router.push('/app/crm/workflows');
  }

  return (
    <div className="workflow-editor">
      <div className="panel">
        <div className="form-row">
          <label className="section-label">{labels.name}</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={labels.name}
          />
        </div>
        <label className="workflow-toggle-inline">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{enabled ? labels.enabled : labels.disabled}</span>
        </label>
      </div>

      <div className="panel">
        <p className="section-label">{labels.triggers}</p>
        {triggers.map((t, i) => (
          <div key={i} className="workflow-block">
            <select
              className="filter-select"
              value={t.type}
              onChange={(e) => updateTrigger(i, { type: e.target.value as typeof TRIGGER_TYPES[number] })}
            >
              {TRIGGER_TYPES.map((tt) => (
                <option key={tt} value={tt}>
                  {labels.triggerTypes[tt] ?? tt}
                </option>
              ))}
            </select>
            {t.type === 'deal_stage_changed' && (
              <div className="workflow-config-row">
                <input
                  className="input"
                  value={safeString(t.config?.fromStageId)}
                  onChange={(e) => updateTriggerConfig(i, { fromStageId: e.target.value })}
                  placeholder={labels.fromStageId}
                />
                <input
                  className="input"
                  value={safeString(t.config?.toStageId)}
                  onChange={(e) => updateTriggerConfig(i, { toStageId: e.target.value })}
                  placeholder={labels.toStageId}
                />
              </div>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeTrigger(i)}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={addTrigger}>
          {labels.addTrigger}
        </button>
      </div>

      <div className="panel">
        <p className="section-label">{labels.actions}</p>
        {actions.map((a, i) => (
          <div key={i} className="workflow-block">
            <div className="workflow-block-head">
              <select
                className="filter-select"
                value={a.type}
                onChange={(e) =>
                  updateAction(i, { type: e.target.value as typeof ACTION_TYPES[number], config: {} })
                }
              >
                {ACTION_TYPES.map((at) => (
                  <option key={at} value={at}>
                    {labels.actionTypes[at] ?? at}
                  </option>
                ))}
              </select>
              <div className="workflow-block-arrows">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveAction(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => moveAction(i, 1)}>
                  ↓
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeAction(i)}>
                  ✕
                </button>
              </div>
            </div>
            <ActionConfig
              type={a.type}
              config={a.config ?? {}}
              lists={lists}
              labels={labels}
              onChange={(patch) => updateActionConfig(i, patch)}
            />
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={addAction}>
          {labels.addAction}
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="workflow-editor-actions">
        <button type="button" className="btn btn-solid" disabled={saving || !name.trim()} onClick={save}>
          {saving ? labels.saving : labels.save}
        </button>
        {!isNew && (
          <button type="button" className="btn" onClick={run}>
            {labels.runNow}
          </button>
        )}
        {!isNew && (
          <button type="button" className="btn btn-ghost danger" onClick={remove}>
            {labels.delete}
          </button>
        )}
      </div>

      {!isNew && (
        <div className="panel">
          <WorkflowRuns
            runs={runs}
            labels={{ title: labels.runs, noRuns: labels.noRuns, status: labels.runStatus }}
          />
        </div>
      )}
    </div>
  );
}

function ActionConfig({
  type,
  config,
  lists,
  labels,
  onChange,
}: {
  type: typeof ACTION_TYPES[number];
  config: Record<string, unknown>;
  lists: CrmListRow[];
  labels: WorkflowEditorProps['labels'];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  switch (type) {
    case 'send_email':
      return (
        <div className="workflow-config">
          <input
            className="input"
            value={safeString(config.to)}
            onChange={(e) => onChange({ to: e.target.value })}
            placeholder={labels.to}
          />
          <input
            className="input"
            value={safeString(config.subject)}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder={labels.subject}
          />
          <textarea
            className="textarea"
            rows={4}
            value={safeString(config.body)}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={labels.body}
          />
        </div>
      );
    case 'create_task':
      return (
        <div className="workflow-config">
          <input
            className="input"
            value={safeString(config.subject)}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder={labels.subject}
          />
          <input
            className="input"
            type="number"
            value={safeNumber(config.dueInDays)}
            onChange={(e) => onChange({ dueInDays: Number(e.target.value) })}
            placeholder={labels.dueInDays}
          />
          <input
            className="input"
            value={safeString(config.ownerId)}
            onChange={(e) => onChange({ ownerId: e.target.value })}
            placeholder={labels.ownerId}
          />
        </div>
      );
    case 'create_activity':
      return (
        <div className="workflow-config">
          <input
            className="input"
            value={safeString(config.type)}
            onChange={(e) => onChange({ type: e.target.value })}
            placeholder={labels.entity}
          />
          <input
            className="input"
            value={safeString(config.subject)}
            onChange={(e) => onChange({ subject: e.target.value })}
            placeholder={labels.subject}
          />
          <textarea
            className="textarea"
            rows={3}
            value={safeString(config.body)}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder={labels.body}
          />
        </div>
      );
    case 'update_field':
      return (
        <div className="workflow-config">
          <select
            className="filter-select"
            value={safeString(config.entity)}
            onChange={(e) => onChange({ entity: e.target.value })}
          >
            <option value="">{labels.entity}</option>
            <option value="contact">Contact</option>
            <option value="company">Company</option>
            <option value="deal">Deal</option>
          </select>
          <input
            className="input"
            value={safeString(config.field)}
            onChange={(e) => onChange({ field: e.target.value })}
            placeholder={labels.field}
          />
          <input
            className="input"
            value={safeString(config.value)}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={labels.value}
          />
        </div>
      );
    case 'add_to_list':
      return (
        <div className="workflow-config">
          <select
            className="filter-select"
            value={safeString(config.listId)}
            onChange={(e) => onChange({ listId: e.target.value })}
          >
            <option value="">{labels.listId}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      );
    case 'webhook':
      return (
        <div className="workflow-config">
          <input
            className="input"
            value={safeString(config.url)}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder={labels.url}
          />
          <input
            className="input"
            value={safeString(config.method)}
            onChange={(e) => onChange({ method: e.target.value })}
            placeholder={labels.method}
          />
          <textarea
            className="textarea"
            rows={2}
            value={safeString(config.headers)}
            onChange={(e) => onChange({ headers: e.target.value })}
            placeholder={labels.headers}
          />
        </div>
      );
    case 'notify_user':
      return (
        <div className="workflow-config">
          <textarea
            className="textarea"
            rows={3}
            value={safeString(config.message)}
            onChange={(e) => onChange({ message: e.target.value })}
            placeholder={labels.message}
          />
        </div>
      );
    default:
      return null;
  }
}

function safeString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

function safeNumber(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}
