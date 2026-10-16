'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { FlowRunDto, FlowStepDto } from '@/lib/flow';
import { i18nKey, formatDuration, pretty, RUN_BADGE, stepErrorInfo } from './flow-ui';

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
  /** Lleva al editor con ese nodo elegido (para arreglar el paso que falló). */
  onOpenNode?: (nodeId: string) => void;
}

/** Historial de corridas con el detalle de cada paso (input / output / error). */
export default function RunsPanel({ flowId, selectedRunId, onSelect, refreshKey, canEdit, dirty, onRerun, onOpenNode }: Props) {
  const t = useTranslations('flow');
  const format = useFormatter();
  const now = useNow({ updateInterval: 30_000 });
  const [runs, setRuns] = useState<FlowRunDto[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [loadError, setLoadError] = useState(false);

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
    if (!res?.ok || !data?.runs) {
      setLoadError(true);
      setRuns((r) => r ?? []);
      return;
    }
    setLoadError(false);
    setRuns(data.runs);
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

  /** Error legible: qué pasó y cómo se arregla; el código crudo queda abajo, como dato. */
  function errorBlock(raw: string, nodeId: string | null, className: string) {
    const info = stepErrorInfo(raw);
    return (
      <div className={`flow-run-error ${className}`.trim()} role="note">
        {info && <p className="flow-run-error-text">{t(`stepErrors.${info.key}`, info.values ?? {})}</p>}
        <p className="flow-run-error-code data">{raw}</p>
        {info?.inEditor && nodeId && onOpenNode && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenNode(nodeId)}>
            {t('runs.openInEditor')}
          </button>
        )}
      </div>
    );
  }

  if (runs === null) {
    return (
      <div className="flow-runs" aria-busy="true">
        <div className="flow-runs-list">
          <div className="ui-loading-stack flow-pad">
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        </div>
        <div className="flow-run-detail">
          <div className="ui-loading-stack">
            <span className="ui-skeleton ui-skeleton-title" />
            <span className="ui-skeleton ui-skeleton-block" />
          </div>
        </div>
        <span className="sr-only">{t('runs.loading')}</span>
      </div>
    );
  }

  const retry = (
    <div className="flow-load-error" role="alert">
      <p className="ui-error">{t('runs.loadError')}</p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadRuns()}>
        {t('editor.retry')}
      </button>
    </div>
  );

  if (runs.length === 0) {
    return (
      <div className="flow-runs-empty">
        {loadError ? retry : <EmptyState product="flow" title={t('runs.emptyTitle')} body={t('runs.emptyBody')} />}
      </div>
    );
  }

  return (
    <div className="flow-runs">
      <div className="flow-runs-list">
        <div className="flow-runs-head">
          <h2 className="flow-panel-title">{t('runs.title')}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadRuns()}>
            {t('runs.refresh')}
          </button>
        </div>
        {loadError && retry}
        <ul>
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flow-run-item"
                aria-current={detail?.id === r.id ? 'true' : undefined}
                onClick={() => void loadRun(r.id)}
              >
                <span className="flow-run-main">
                  <span className={`badge ${RUN_BADGE[r.status] ?? ''}`}>{t(`runs.status.${r.status}`)}</span>
                  <span className="flow-muted" suppressHydrationWarning>
                    {r.rerunOf
                      ? t('runs.rerun')
                      : t.has(`runs.triggers.${i18nKey(r.triggerType)}`)
                        ? t(`runs.triggers.${i18nKey(r.triggerType)}`)
                        : r.triggerType}{' '}
                    · {format.relativeTime(new Date(r.createdAt), now)}
                  </span>
                </span>
                <span className="flow-muted data">{formatDuration(r.startedAt, r.finishedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flow-run-detail">
        {!detail ? (
          <p className="ui-help">{t('runs.selectRun')}</p>
        ) : (
          <>
            <div className="flow-run-summary">
              <span className={`badge ${RUN_BADGE[detail.status] ?? ''}`}>{t(`runs.status.${detail.status}`)}</span>
              <span className="flow-muted" suppressHydrationWarning>
                {format.dateTime(new Date(detail.createdAt), { dateStyle: 'medium', timeStyle: 'medium' })}
              </span>
              <span className="flow-muted data">{detail.id.slice(0, 8)}</span>
              {canEdit && (detail.status === 'queued' || detail.status === 'waiting') && (
                <button
                  type="button"
                  className="btn btn-ghost btn-danger btn-sm"
                  aria-busy={cancelling || undefined}
                  onClick={() => void cancelRun()}
                >
                  {t('runs.cancel')}
                </button>
              )}
            </div>
            {/* El error se muestra una sola vez: en el paso que falló, o acá si no hay paso (flow apagado, sin trigger…). */}
            {detail.error &&
              !detail.steps.some((s) => s.error) &&
              errorBlock(detail.error.replace(/^[A-Za-z0-9_-]+: /, ''), null, '')}
            {detail.rerunOf && <p className="ui-help">{t('runs.rerunOf', { id: detail.rerunOf.slice(0, 8) })}</p>}
            {rerunError && (
              <p className="ui-error" role="alert">
                {rerunError}
              </p>
            )}
            <ol className="flow-steps">
              {detail.steps.map((s) => {
                const open = openStep === s.id;
                return (
                  <li key={s.id} className="flow-step" data-status={s.status}>
                    <button type="button" className="flow-step-head" onClick={() => setOpenStep(open ? null : s.id)} aria-expanded={open}>
                      <span className="flow-step-station" aria-hidden="true" />
                      <span className="flow-step-name">
                        {t(`nodes.${i18nKey(s.nodeType)}.title`)} <span className="flow-muted data">{s.nodeId}</span>
                      </span>
                      <span className={`badge ${RUN_BADGE[s.status] ?? ''}`}>{t(`stepStatus.${s.status}`)}</span>
                      <span className="flow-muted data flow-step-time">{formatDuration(s.startedAt, s.finishedAt)}</span>
                    </button>
                    {s.error && errorBlock(s.error, s.nodeType.startsWith('trigger.') ? null : s.nodeId, 'flow-step-error')}
                    {open && canEdit && (detail.status === 'failed' || detail.status === 'success') && !s.nodeType.startsWith('trigger.') && (
                      <div className="flow-step-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={rerunning !== null && rerunning !== s.nodeId}
                          aria-busy={rerunning === s.nodeId || undefined}
                          onClick={() => void rerunFrom(s.nodeId)}
                        >
                          {t('runs.rerunFrom')}
                        </button>
                        <span className="ui-help">{t('runs.rerunHint')}</span>
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
