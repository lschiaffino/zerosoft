'use client';

import type { CrmWorkflowRunRow } from '@/lib/db';

interface WorkflowRunsProps {
  runs: CrmWorkflowRunRow[];
  labels: {
    title: string;
    noRuns: string;
    status: Record<string, string>;
  };
}

function formatWhen(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('default', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export default function WorkflowRuns({ runs, labels }: WorkflowRunsProps) {
  if (!runs.length) {
    return <p className="muted">{labels.noRuns}</p>;
  }

  return (
    <div className="workflow-runs">
      <p className="section-label">{labels.title}</p>
      {runs.map((run) => {
        let summary = '';
        try {
          const output: { results?: Array<{ type: string; ok: boolean; error?: string }> } =
            JSON.parse(run.output || '{}');
          const ok = output.results?.filter((r) => r.ok).length ?? 0;
          const total = output.results?.length ?? 0;
          summary = `${ok}/${total} actions OK`;
        } catch {
          summary = '—';
        }
        return (
          <div key={run.id} className="workflow-run-row">
            <span className={`badge run-${run.status}`}>{labels.status[run.status] ?? run.status}</span>
            <span className="muted">{formatWhen(run.started_at)}</span>
            <span className="run-summary">{summary}</span>
          </div>
        );
      })}
    </div>
  );
}
