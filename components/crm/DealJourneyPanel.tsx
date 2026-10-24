'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { JourneyMode, JourneyRange, JourneyResult } from '@/lib/crm-stage-history';

/** Igual que JOURNEY_RANGES en lib/crm-stage-history (server-only). */
const JOURNEY_RANGES: JourneyRange[] = ['30d', '90d', 'quarter', '12m', 'all'];
import PipelineSelect from './PipelineSelect';

interface Props {
  journey: JourneyResult | null;
  range: JourneyRange;
  mode: JourneyMode;
  pipelines: Array<{ id: string; name: string }>;
  selectedPipelineId: string | null;
  locale: string;
}

/** Recorrido de deals: embudo con conversión, tiempo y caída por etapa (historial real de etapas). */
export default function DealJourneyPanel({ journey, range, mode, pipelines, selectedPipelineId, locale }: Props) {
  const t = useTranslations('crm');
  const tj = (k: string, v?: Record<string, string | number>) => t(`journey.${k}`, v);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const num = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  const pct = (n: number | null) => (n === null ? '·' : `${num(n)}%`);

  function set(param: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(param, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  const max = Math.max(1, ...(journey?.stages.map((s) => s.reached) ?? [1]));

  return (
    <div className="journey" data-testid="deal-journey">
      <div className="report-controls">
        <div className="report-tabs" role="group" aria-label={tj('rangeLabel')}>
          {JOURNEY_RANGES.map((r) => (
            <button key={r} type="button" className={`report-tab${r === range ? ' active' : ''}`} aria-pressed={r === range} onClick={() => set('jrange', r)}>
              {tj(`range.${r}`)}
            </button>
          ))}
        </div>
        <div className="report-tabs" role="group" aria-label={tj('modeLabel')}>
          {(['cumulative', 'strict'] as const).map((m) => (
            <button key={m} type="button" className={`report-tab${m === mode ? ' active' : ''}`} aria-pressed={m === mode} onClick={() => set('jmode', m)}>
              {tj(`mode.${m}`)}
            </button>
          ))}
        </div>
        {pipelines.length > 1 && <PipelineSelect pipelines={pipelines} selectedId={selectedPipelineId} label={t('reports.pipeline')} />}
      </div>

      {!journey || journey.total === 0 ? (
        <section className="panel rb-empty">
          <p className="rb-empty-title">{tj('emptyTitle')}</p>
          <p className="muted">{tj('emptyDesc')}</p>
        </section>
      ) : (
        <>
          <div className="fc-kpis">
            {(
              [
                ['total', num(journey.total)],
                ['won', num(journey.won)],
                ['lost', num(journey.lost)],
                ['open', num(journey.open)],
                ['winRate', pct(journey.winRate)],
                ['avgDaysToWin', journey.avgDaysToWin === null ? '·' : tj('days', { n: num(journey.avgDaysToWin) })],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="panel stat-card">
                <span className="stat-num">{v}</span>
                <span className="stat-label">{tj(`kpi.${k}`)}</span>
              </div>
            ))}
          </div>

          <section className="panel fc-section">
            <p className="section-label">{tj('funnel')}</p>
            <div className="jr-funnel">
              {journey.stages.map((s) => (
                <div key={s.id} className={`jr-row${s.id === journey.biggestDropStageId ? ' is-drop' : ''}`}>
                  <span className="breakdown-name jr-name" title={s.name}>
                    {s.name}
                  </span>
                  <span className="jr-track" title={tj('reachedTitle', { n: s.reached })}>
                    <span className="jr-bar" style={{ display: 'block', width: `${Math.max((s.reached / max) * 100, 1)}%` }} />
                  </span>
                  <span className="jr-conv">
                    {num(s.reached)} · {pct(s.fromStartRate)}
                  </span>
                </div>
              ))}
            </div>
            {journey.biggestDropStageId && (
              <p className="muted fc-help">
                {tj('biggestDrop', { stage: journey.stages.find((s) => s.id === journey.biggestDropStageId)?.name ?? '' })}
              </p>
            )}
          </section>

          <section className="panel fc-section">
            <p className="section-label">{tj('byStage')}</p>
            <div className="rb-scroll">
              <table className="table fc-table" data-testid="journey-table">
                <thead>
                  <tr>
                    <th>{tj('cols.stage')}</th>
                    <th className="num">{tj('cols.reached')}</th>
                    <th className="num">{tj('cols.next')}</th>
                    <th className="num">{tj('cols.avgDays')}</th>
                    <th className="num">{tj('cols.current')}</th>
                    <th className="num">{tj('cols.lost')}</th>
                    <th className="num">{tj('cols.lostRate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {journey.stages.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td className="num">{num(s.reached)}</td>
                      <td className="num">{s.isWon ? '' : pct(s.nextRate)}</td>
                      <td className="num" title={tj('exitsTitle', { n: s.exits })}>
                        {s.avgDays === null ? '·' : tj('days', { n: num(s.avgDays) })}
                      </td>
                      <td className="num">{num(s.current)}</td>
                      <td className={`num${s.lost > 0 ? ' jr-drop' : ''}`}>{s.isWon ? '' : num(s.lost)}</td>
                      <td className="num">{s.isWon ? '' : pct(s.lostRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted fc-help">{tj(mode === 'cumulative' ? 'helpCumulative' : 'helpStrict')}</p>
          </section>
        </>
      )}
    </div>
  );
}
