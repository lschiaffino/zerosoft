'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AgentPendingActionDto } from '@/lib/agents-config';
import { api, errorText, toolName } from './agents-ui';

/** Detalle legible del input de una acción (sin mostrar JSON crudo cuando no hace falta). */
function inputLines(input: unknown): Array<[string, string]> {
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string])
    .slice(0, 8);
}

/**
 * Acciones del agente que esperan aprobación en una conversación: aprobar
 * la ejecuta en el momento; rechazar la descarta. Las ya decididas quedan
 * con su estado.
 */
export default function AgentApprovals({
  agentId,
  actions,
  onChange,
}: {
  agentId: string;
  actions: AgentPendingActionDto[];
  onChange: (action: AgentPendingActionDto) => void;
}) {
  const t = useTranslations('agents');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (actions.length === 0) return null;

  async function decide(a: AgentPendingActionDto, decision: 'approve' | 'reject') {
    setBusy(a.id);
    setError(null);
    const res = await api<{ action?: AgentPendingActionDto }>(`/api/agents/${agentId}/approvals/${a.id}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    setBusy(null);
    if (!res.ok || !res.data.action) {
      setError(errorText(t, res.data.error));
      return;
    }
    onChange(res.data.action);
  }

  return (
    <section className="ag-approvals ag-pad" aria-label={t('approvals.title')}>
      <h4 className="label">{t('approvals.title')}</h4>
      <ul className="ag-approval-list">
        {actions.map((a) => {
          const resultError =
            a.result && typeof a.result === 'object' && typeof (a.result as { error?: unknown }).error === 'string'
              ? String((a.result as { error: string }).error)
              : null;
          return (
            <li key={a.id} className={`ag-approval is-${a.status}`}>
              <div className="ag-approval-head">
                <span className="ag-approval-tool">{toolName(t, a.tool)}</span>
                <span className={`badge${a.status === 'pending' ? ' badge-warn' : ''}`}>{t(`approvals.status.${a.status}`)}</span>
              </div>
              <dl className="ag-approval-input">
                {inputLines(a.input).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="data">{v}</dd>
                  </div>
                ))}
              </dl>
              {a.status === 'pending' ? (
                <div className="ag-approval-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busy !== null}
                    aria-busy={busy === a.id || undefined}
                    onClick={() => void decide(a, 'approve')}
                  >
                    {t('approvals.approve')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void decide(a, 'reject')}>
                    {t('approvals.reject')}
                  </button>
                </div>
              ) : (
                <p className="ui-help">
                  {t('approvals.decided', { who: a.decidedBy || '—' })}
                  {resultError ? ` ${t('approvals.failed', { code: resultError })}` : ''}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
