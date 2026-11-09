'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { LlmGeneration, LlmOverview, LlmTrace } from '@/lib/analytics/more-types';
import Chart from './Chart';
import RangeSelect from './RangeSelect';
import { api, bucketLabel, fmtNumber, fmtPercent, fmtTime } from './client';

export function fmtUsd(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: v > 0 && v < 1 ? 4 : 2, maximumFractionDigits: v > 0 && v < 1 ? 4 : 2 }).format(v);
}

export function fmtLatency(ms: number | null): string {
  if (ms === null) return '–';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

function Generations({ projectId, range, models, trace, onClearTrace }: { projectId: string; range: string; models: string[]; trace: string | null; onClearTrace: () => void }) {
  const t = useTranslations('analyticsMore.llm');
  const locale = useLocale();
  const [model, setModel] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [rows, setRows] = useState<LlmGeneration[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (before: number | null, signal?: AbortSignal) => {
      const params = new URLSearchParams({ project: projectId, from: range });
      if (model) params.set('model', model);
      if (trace) params.set('trace', trace);
      if (errorsOnly) params.set('errors', '1');
      if (before) params.set('before', String(before));
      return api<{ generations: LlmGeneration[]; nextBefore: number | null }>(`/api/analytics/llm/generations?${params.toString()}`, { signal });
    },
    [projectId, range, model, trace, errorsOnly],
  );

  useEffect(() => {
    const ctl = new AbortController();
    setError(false);
    load(null, ctl.signal)
      .then((r) => {
        setRows(r.generations);
        setNext(r.nextBefore);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      });
    return () => ctl.abort();
  }, [load]);

  return (
    <div className="an-form">
      <div className="an-toolbar">
        <select className="select" aria-label={t('modelFilter')} value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">{t('allModels')}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="ui-check">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> {t('errorsOnly')}
        </label>
        {trace && (
          <button type="button" className="an-chip" onClick={onClearTrace} aria-label={t('clearTrace', { trace })}>
            <span className="an-chip-text">
              {t('traceChip')}: {trace}
            </span>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {rows && rows.length === 0 && <p className="an-empty-result">{t('noGenerations')}</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap table-stack">
          <table className="table an-list" data-testid="an-llm-generations">
            <thead>
              <tr>
                <th scope="col">{t('model')}</th>
                <th scope="col">{t('date')}</th>
                <th scope="col" className="num">
                  {t('tokens')}
                </th>
                <th scope="col" className="num">
                  {t('cost')}
                </th>
                <th scope="col" className="num">
                  {t('latency')}
                </th>
                <th scope="col">{t('result')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td className="an-llm-model">
                    <Link href={`/app/pulse/llm/${g.id}`} className="an-row-link">
                      {g.model}
                    </Link>
                  </td>
                  <td className="an-muted an-small an-nowrap" data-label={t('date')}>
                    {fmtTime(g.ts, locale)}
                  </td>
                  <td className="num" data-label={t('tokens')}>
                    {fmtNumber(g.inputTokens + g.outputTokens, locale)}
                  </td>
                  <td className="num" data-label={t('cost')}>
                    {fmtUsd(g.costUsd, locale)}
                  </td>
                  <td className="num" data-label={t('latency')}>
                    {fmtLatency(g.latencyMs)}
                  </td>
                  <td data-label={t('result')}>{g.isError ? <span className="badge badge-bad">{t('statusError')}</span> : <span className="badge badge-ok">{t('statusOk')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next !== null && (
        <div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              load(next)
                .then((r) => {
                  setRows((cur) => [...(cur ?? []), ...r.generations]);
                  setNext(r.nextBefore);
                })
                .catch(() => setError(true))
                .finally(() => setBusy(false));
            }}
          >
            {t('loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

/** LLM: lo que informan los eventos $ai_generation del cliente (con los nombres de PostHog). */
export default function LlmPage({ projectId, publicKey }: { projectId: string; publicKey: string }) {
  const t = useTranslations('analyticsMore.llm');
  const locale = useLocale();
  const [range, setRange] = useState('-30d');
  const [data, setData] = useState<{ overview: LlmOverview; traces: LlmTrace[] } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'generations' | 'traces'>('generations');
  const [chart, setChart] = useState<'calls' | 'cost'>('calls');
  const [trace, setTrace] = useState<string | null>(null);
  const [origin, setOrigin] = useState('https://zerosoft.ai');
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(false);
    api<{ overview: LlmOverview; traces: LlmTrace[] }>(`/api/analytics/llm?project=${encodeURIComponent(projectId)}&from=${encodeURIComponent(range)}`, { signal: ctl.signal })
      .then(setData)
      .catch(() => {
        if (!ctl.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [projectId, range]);

  const example = `curl -X POST ${origin}/api/ingest/e \\
  -H 'Authorization: Bearer <secret key>' \\
  -H 'Content-Type: application/json' \\
  -d '{"event":"$ai_generation","distinct_id":"user-123","properties":{
    "$ai_model":"gpt-4o-mini","$ai_provider":"openai",
    "$ai_input_tokens":120,"$ai_output_tokens":48,
    "$ai_total_cost_usd":0.00042,"$ai_latency":1.2,
    "$ai_trace_id":"trace-1","$ai_is_error":false}}'`;
  const exampleBrowser = `zs.capture('$ai_generation', { $ai_model: 'gpt-4o-mini', $ai_input_tokens: 120, $ai_output_tokens: 48, $ai_latency: 1.2 });`;

  const o = data?.overview;
  const n = (v: number) => fmtNumber(v, locale);
  return (
    <div className="app-page ui-page an-page" aria-busy={loading}>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="an-toolbar">
        <RangeSelect value={range} onChange={setRange} />
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {!data && loading && <span className="ui-skeleton ui-skeleton-block" />}
      {o && o.totals.calls === 0 && (
        <>
          <EmptyState product="pulse" title={t('emptyTitle')} body={t('emptyBody')} />
          <section className="an-panel an-form" aria-labelledby="an-llm-example" data-testid="an-llm-example">
            <h2 id="an-llm-example" className="an-h3">
              {t('exampleTitle')}
            </h2>
            <p className="an-note">{t('exampleBody')}</p>
            <pre className="an-code">
              <code>{example}</code>
            </pre>
            <p className="an-note">{t('exampleBrowser', { key: publicKey })}</p>
            <pre className="an-code">
              <code>{exampleBrowser}</code>
            </pre>
            <p className="an-note">{t('noWrappers')}</p>
          </section>
        </>
      )}
      {o && o.totals.calls > 0 && data && (
        <>
          <div className="an-stats" data-testid="an-llm-stats">
            <div className="an-stat">
              <span className="an-stat-label">{t('calls')}</span>
              <span className="an-stat-value">{n(o.totals.calls)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('inputTokens')}</span>
              <span className="an-stat-value">{n(o.totals.inputTokens)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('outputTokens')}</span>
              <span className="an-stat-value">{n(o.totals.outputTokens)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('cost')}</span>
              <span className="an-stat-value">{fmtUsd(o.totals.costUsd, locale)}</span>
            </div>
            <div className="an-stat">
              <span className="an-stat-label">{t('errorRate')}</span>
              <span className="an-stat-value">{fmtPercent(o.totals.errors / o.totals.calls, locale)}</span>
            </div>
          </div>
          <p className="an-note">{t('reportedNote')}</p>
          {o.truncated && <p className="an-note">{t('truncated')}</p>}
          <section className="an-panel an-form" aria-label={t('perDay')}>
            <div className="ui-tabs" role="tablist" aria-label={t('perDay')}>
              {(['calls', 'cost'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={chart === k} className="ui-tab" onClick={() => setChart(k)}>
                  {t(k === 'calls' ? 'calls' : 'cost')}
                </button>
              ))}
            </div>
            <Chart
              kind="bar"
              labels={o.buckets.map((b) => bucketLabel(b, locale))}
              series={[{ label: chart === 'calls' ? t('calls') : t('cost'), data: chart === 'calls' ? o.callsPerDay : o.costPerDay }]}
              summary={t('chartSummary', { calls: o.totals.calls })}
              height={200}
            />
          </section>
          <section className="an-form" aria-labelledby="an-llm-models">
            <h2 id="an-llm-models" className="an-h3">
              {t('perModel')}
            </h2>
            <div className="table-wrap table-stack">
              <table className="table an-list" data-testid="an-llm-models-table">
                <thead>
                  <tr>
                    <th scope="col">{t('model')}</th>
                    <th scope="col" className="num">
                      {t('calls')}
                    </th>
                    <th scope="col" className="num">
                      {t('tokens')}
                    </th>
                    <th scope="col" className="num">
                      {t('cost')}
                    </th>
                    <th scope="col" className="num">
                      {t('p50')}
                    </th>
                    <th scope="col" className="num">
                      {t('p95')}
                    </th>
                    <th scope="col" className="num">
                      {t('errorRate')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {o.models.map((m) => (
                    <tr key={m.model}>
                      <td className="an-llm-model">
                        <span className="an-llm-name">{m.model}</span>
                        {m.provider && <span className="an-muted an-small"> · {m.provider}</span>}
                      </td>
                      <td className="num" data-label={t('calls')}>
                        {n(m.calls)}
                      </td>
                      <td className="num" data-label={t('tokens')}>
                        {n(m.inputTokens + m.outputTokens)}
                      </td>
                      <td className="num" data-label={t('cost')}>
                        {fmtUsd(m.costUsd, locale)}
                      </td>
                      <td className="num" data-label={t('p50')}>
                        {fmtLatency(m.p50LatencyMs)}
                      </td>
                      <td className="num" data-label={t('p95')}>
                        {fmtLatency(m.p95LatencyMs)}
                      </td>
                      <td className="num" data-label={t('errorRate')}>
                        {fmtPercent(m.errors / Math.max(1, m.calls), locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="an-form">
            <div className="ui-tabs" role="tablist" aria-label={t('listLabel')}>
              {(['generations', 'traces'] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className="ui-tab" onClick={() => setTab(k)}>
                  {t(k)}
                </button>
              ))}
            </div>
            {tab === 'generations' ? (
              <Generations projectId={projectId} range={range} models={o.models.map((m) => m.model)} trace={trace} onClearTrace={() => setTrace(null)} />
            ) : data.traces.length === 0 ? (
              <p className="an-empty-result">{t('noTraces')}</p>
            ) : (
              <div className="table-wrap table-stack">
                <table className="table an-list" data-testid="an-llm-traces">
                  <thead>
                    <tr>
                      <th scope="col">{t('trace')}</th>
                      <th scope="col" className="num">
                        {t('generations')}
                      </th>
                      <th scope="col" className="num">
                        {t('tokens')}
                      </th>
                      <th scope="col" className="num">
                        {t('cost')}
                      </th>
                      <th scope="col" className="num">
                        {t('errors')}
                      </th>
                      <th scope="col">{t('date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.traces.map((tr) => (
                      <tr key={tr.traceId}>
                        <td className="an-llm-model">
                          <button
                            type="button"
                            className="an-row-button an-mono an-llm-trace"
                            onClick={() => {
                              setTrace(tr.traceId);
                              setTab('generations');
                            }}
                          >
                            {tr.traceId}
                          </button>
                        </td>
                        <td className="num" data-label={t('generations')}>
                          {n(tr.generations)}
                        </td>
                        <td className="num" data-label={t('tokens')}>
                          {n(tr.inputTokens + tr.outputTokens)}
                        </td>
                        <td className="num" data-label={t('cost')}>
                          {fmtUsd(tr.costUsd, locale)}
                        </td>
                        <td className="num" data-label={t('errors')}>
                          {n(tr.errors)}
                        </td>
                        <td className="an-muted an-small an-nowrap" data-label={t('date')}>
                          {fmtTime(tr.lastTs, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
