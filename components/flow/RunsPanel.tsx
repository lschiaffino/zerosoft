'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import type { FlowRunDto, FlowStepDto } from '@/lib/flow';
import { i18nKey, formatDuration, pretty } from './flow-ui';

export type RunDetail = FlowRunDto & { steps: FlowStepDto[] };

interface Props {
  flowId: string;
  /** Corrida a mostrar al abrir (p. ej. la del último "Test run"). */
  selectedRunId: string | null;
  onSelect: (run: RunDetail | null) => void;
  refreshKey: number;
  canEdit?: boolean;
  /** Hay cambios sin guardar (la re-ejecución usa el grafo guardado). */
  dirty?: boolean;
  onRerun?: (run: RunDetail) => void;
}

/** Historial de corridas con el detalle de cada paso (input / output / error). */
export default function RunsPanel({ flowId, selectedRunId, onSelect, refreshKey, canEdit, dirty, onRerun }: Props) {
  const t = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [runs, setRuns] = useState<FlowRunDto[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function rerunFrom(nodeId: string) {
    if (!detail) return;
    if (dirty && !window.confirm(t('runs.rerunDirty'))) return;
    setRerunning(nodeId);
    setRerunError(null);
    const res = await fetch(`/api/flow/runs/${detail.id}/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromNodeId: nodeId }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { run?: RunDetail; error?: string } | null;
    setRerunning(null);
    if (!res?.ok || !data?.run) {
      const code = data?.error ?? 'generic';
      setRerunError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
      return;
    }
    setDetail(data.run);
    onSelect(data.run);
    onRerun?.(data.run);
  }

  async function cancelRun() {
    if (!detail || !window.confirm(t('runs.cancelConfirm'))) return;
    setCancelling(true);
    setRerunError(null);
    const res = await fetch(`/api/flow/runs/${detail.id}/cancel`, { method: 'POST' }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { run?: RunDetail; error?: string } | null;
    setCancelling(false);
    if (!res?.ok || !data?.run) {
      const code = data?.error ?? 'generic';
      setRerunError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
      return;
    }
    setDetail(data.run);
    onSelect(data.run);
    void loadRuns();
  }

  const loadRuns = useCallback(async () => {
    const res = await fetch(`/api/flow/flows/${flowId}/runs?limit=50`).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { runs?: FlowRunDto[] } | null;
    setRuns(data?.runs ?? []);
  }, [flowId]);

  const loadRun = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/flow/runs/${id}`).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { run?: RunDetail } | null;
      setDetail(data?.run ?? null);
      onSelect(data?.run ?? null);
      setOpenStep(null);
    },
    [onSelect],
  );

  useEffect(() => {
    void loadRuns();
  }, [loadRuns, refreshKey]);

  useEffect(() => {
    const id = selectedRunId ?? runs?.[0]?.id ?? null;
    if (id && id !== detail?.id) void loadRun(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId, runs]);

  if (runs === null) return <p className="muted flow-pad">{t('runs.loading')}</p>;

  return (
    <div className="flow-runs">
      <div className="flow-runs-list">
        <div className="flow-runs-head">
          <h3>{t('runs.title')}</h3>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => void loadRuns()}>
            {t('runs.refresh')}
          </button>
        </div>
        {runs.length === 0 ? (
          <p className="muted flow-pad">{t('runs.empty')}</p>
        ) : (
          <ul>
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`flow-run-item${detail?.id === r.id ? ' is-active' : ''}`}
                  onClick={() => void loadRun(r.id)}
                >
                  <span className={`flow-dot is-${r.status}`} aria-hidden="true" />
                  <span className="flow-run-main">
                    <span>{t(`runs.status.${r.status}`)}</span>
                    <span className="muted">
                      {r.rerunOf ? t('runs.rerun') : t.has(`runs.triggers.${i18nKey(r.triggerType)}`) ? t(`runs.triggers.${i18nKey(r.triggerType)}`) : r.triggerType} ·{' '}
                      {format.relativeTime(new Date(r.createdAt), now)}
                    </span>
                  </span>
                  <span className="muted mono">{formatDuration(r.startedAt, r.finishedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flow-run-detail">
        {!detail ? (
          <p className="muted flow-pad">{t('runs.selectRun')}</p>
        ) : (
          <>
            <div className="flow-run-summary">
              <span className={`flow-dot is-${detail.status}`} aria-hidden="true" />
              <strong>{t(`runs.status.${detail.status}`)}</strong>
              <span className="muted">
                {format.dateTime(new Date(detail.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}
              </span>
              <span className="muted mono">{detail.id.slice(0, 8)}</span>
              {canEdit && (detail.status === 'queued' || detail.status === 'waiting') && (
                <button type="button" className="btn btn-small btn-ghost" disabled={cancelling} onClick={() => void cancelRun()}>
                  {t('runs.cancel')}
                </button>
              )}
            </div>
            {detail.error && <p className="flow-error">{detail.error}</p>}
            {detail.rerunOf && <p className="muted flow-hint">{t('runs.rerunOf', { id: detail.rerunOf.slice(0, 8) })}</p>}
            {rerunError && (
              <p className="flow-error" role="alert">
                {rerunError}
              </p>
            )}
            <ol className="flow-steps">
              {detail.steps.map((s) => {
                const open = openStep === s.id;
                return (
                  <li key={s.id} className={`flow-step is-${s.status}`}>
                    <button type="button" className="flow-step-head" onClick={() => setOpenStep(open ? null : s.id)} aria-expanded={open}>
                      <span className={`flow-dot is-${s.status}`} aria-hidden="true" />
                      <span className="flow-step-name">
                        {t(`nodes.${i18nKey(s.nodeType)}.title`)} <span className="mono muted">{s.nodeId}</span>
                      </span>
                      <span className="muted">{t(`stepStatus.${s.status}`)}</span>
                      <span className="muted mono">{formatDuration(s.startedAt, s.finishedAt)}</span>
                    </button>
                    {s.error && <p className="flow-error flow-step-error">{s.error}</p>}
                    {open && canEdit && (detail.status === 'failed' || detail.status === 'success') && !s.nodeType.startsWith('trigger.') && (
                      <div className="flow-step-actions">
                        <button type="button" className="btn btn-small" disabled={rerunning !== null} onClick={() => void rerunFrom(s.nodeId)}>
                          {rerunning === s.nodeId ? t('editor.running') : t('runs.rerunFrom')}
                        </button>
                        <span className="muted">{t('runs.rerunHint')}</span>
                      </div>
                    )}
                    {open && (
                      <div className="flow-step-io">
                        {s.input !== null && (
                          <div>
                            <p className="label">{t('runs.input')}</p>
                            <pre className="flow-json">{pretty(s.input)}</pre>
                          </div>
                        )}
                        <div>
                          <p className="label">{t('runs.output')}</p>
                          <pre className="flow-json">{pretty(s.output)}</pre>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
