'use client';

import { useRouter } from '@/i18n/navigation';
import type { Workflow } from '@/lib/crm-workflows';

interface WorkflowListProps {
  workflows: Workflow[];
  labels: {
    enabled: string;
    disabled: string;
    edit: string;
    runNow: string;
    delete: string;
    noWorkflows: string;
    triggerLabel: string;
    actionsLabel: string;
  };
}

export default function WorkflowList({ workflows, labels }: WorkflowListProps) {
  const router = useRouter();

  async function toggle(id: string, enabled: boolean) {
    await fetch(`/api/crm/workflows/${id}/toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).catch(() => null);
    router.refresh();
  }

  async function run(id: string) {
    await fetch(`/api/crm/workflows/${id}/run`, { method: 'POST' }).catch(() => null);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm(labels.delete)) return;
    await fetch(`/api/crm/workflows/${id}`, { method: 'DELETE' }).catch(() => null);
    router.refresh();
  }

  if (!workflows.length) {
    return <p className="muted">{labels.noWorkflows}</p>;
  }

  return (
    <div className="workflow-list">
      {workflows.map((wf) => (
        <div key={wf.id} className="panel workflow-card">
          <div className="workflow-card-head">
            <h3 className="workflow-name">{wf.name}</h3>
            <span className={`badge${wf.enabled ? '' : ' muted'}`}>
              {wf.enabled ? labels.enabled : labels.disabled}
            </span>
          </div>
          <p className="muted">
            {labels.triggerLabel}: {wf.triggers.map((t) => t.type).join(', ') || '—'}
          </p>
          <p className="muted">
            {labels.actionsLabel}: {wf.actions.length}
          </p>
          <div className="workflow-card-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => router.push(`/app/crm/workflows/${wf.id}`)}
            >
              {labels.edit}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => run(wf.id)}>
              {labels.runNow}
            </button>
            <label className="workflow-toggle">
              <input
                type="checkbox"
                checked={wf.enabled}
                onChange={(e) => toggle(wf.id, e.target.checked)}
              />
              <span>{wf.enabled ? labels.enabled : labels.disabled}</span>
            </label>
            <button type="button" className="btn btn-sm btn-ghost danger" onClick={() => remove(wf.id)}>
              {labels.delete}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
