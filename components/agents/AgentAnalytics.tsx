'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { AgentAnalytics as Analytics, AnalyticsRange } from '@/lib/agents-analytics';
import EmptyState from '@/components/ui/EmptyState';
import { api, errorText, toolName } from './agents-ui';

const RANGES: AnalyticsRange[] = [7, 30, 90];

/**
 * Pestaña Analítica del agente: resolución, derivaciones, topes de pasos,
 * errores por herramienta, pulgares y temas (keywords, sin modelo). Sin el
 * playground. Abajo, el switch de las alertas por email al dueño.
 */
export default function AgentAnalytics({
  agentId,
  canEdit,
  onOpenConversations,
  onOpenReview,
}: {
  agentId: string;
  canEdit: boolean;
  onOpenConversations?: () => void;
  /** Abre Conversaciones con el filtro "Para revisar". */
  onOpenReview?: () => void;
}) {
  const t = useTranslations('agents');
  const format = useFormatter();
  const locale = useLocale();
  const [days, setDays] = useState<AnalyticsRange>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<boolean | null>(null);
  const [alertsBusy, setAlertsBusy] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [scoring, setScoring] = useState(false);
  const [scoreNote, setScoreNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void api<{ analytics?: Analytics; alertsEnabled?: boolean }>(
      `/api/agents/${agentId}/analytics?days=${days}&locale=${locale}`,
    ).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data.analytics) {
        setData(res.data.analytics);
        setAlerts(res.data.alertsEnabled ?? true);
      } else setError(errorText(t, res.data.error));
    });
    return () => {
      cancelled = true;
    };
  }, [agentId, days, locale, t, reload]);

  async function scoreNow() {
    setScoring(true);
    setScoreNote(null);
    const res = await api<{ scored?: number; pending?: number; error?: string }>(`/api/agents/${agentId}/quality`, {
      method: 'POST',
      body: JSON.stringify({ action: 'score' }),
    });
    setScoring(false);
    if (!res.ok) {
      setScoreNote({ kind: 'error', text: errorText(t, res.data.error) });
      return;
    }
    const scored = res.data.scored ?? 0;
    setScoreNote(
      res.data.error && scored === 0
        ? { kind: 'error', text: errorText(t, res.data.error) }
        : { kind: 'ok', text: t('quality.scored', { count: scored }) },
    );
    setReload((n) => n + 1);
  }

  async function toggleAlerts(on: boolean) {
    setAlertsBusy(true);
    setAlertsError(null);
    const res = await api<{ alertsEnabled?: boolean }>(`/api/agents/${agentId}/analytics`, {
      method: 'PATCH',
      body: JSON.stringify({ alertsEnabled: on, locale }),
    });
    setAlertsBusy(false);
    if (res.ok) setAlerts(res.data.alertsEnabled ?? on);
    else setAlertsError(errorText(t, res.data.error));
  }

  const pct = (v: number | null) => (v == null ? '–' : format.number(v, { style: 'percent', maximumFractionDigits: 0 }));
  const num = (v: number) => format.number(v);

  const kpis = data
    ? [
        { key: 'conversations', label: t('analytics.conversations'), value: num(data.conversations) },
        {
          key: 'resolution',
          label: t('analytics.resolution'),
          value: pct(data.resolutionRate),
          hint: t('analytics.resolutionHint', { count: data.resolved }),
        },
        {
          key: 'handoff',
          label: t('analytics.handoff'),
          value: pct(data.handoffRate),
          hint: t('analytics.handoffHint', { count: data.handedOff }),
        },
        {
          key: 'toolErrors',
          label: t('analytics.toolErrors'),
          value: pct(data.toolErrorRate),
          hint: t('analytics.toolErrorsHint', { errors: data.toolErrors, calls: data.toolCalls }),
        },
        {
          key: 'stepLimits',
          label: t('analytics.stepLimits'),
          value: num(data.stepLimits),
          hint: t('analytics.stepLimitsHint', { runs: data.runs }),
        },
        {
          key: 'feedback',
          label: t('analytics.feedback'),
          value: `${num(data.thumbsUp)} / ${num(data.thumbsDown)}`,
          hint: t('analytics.feedbackHint'),
        },
      ]
    : [];

  return (
    <div className="ag-block ag-analytics">
      <div className="ag-analytics-head">
        <p className="ui-help">{t('analytics.intro')}</p>
        <a className="btn btn-secondary btn-sm" href={`/api/agents/${agentId}/export?days=${days}`} download>
          {t('quality.export')}
        </a>
        <nav className="btn-group" aria-label={t('analytics.range')}>
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              className="btn btn-sm"
              aria-pressed={days === d}
              onClick={() => {
                setData(null);
                setDays(d);
              }}
            >
              {t('analytics.lastDays', { days: d })}
            </button>
          ))}
        </nav>
      </div>

      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : !data ? (
        <p className="ui-help" aria-live="polite">
          {t('analytics.loading')}
        </p>
      ) : data.conversations === 0 && data.runs === 0 ? (
        <EmptyState
          quiet
          title={t('analytics.emptyTitle')}
          body={t('analytics.emptyBody')}
          product="agents"
          action={
            onOpenConversations ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenConversations}>
                {t('analytics.openConversations')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <dl className="ag-kpis">
            {kpis.map((k) => (
              <div key={k.key} className="ag-kpi">
                <dt>{k.label}</dt>
                <dd className="data">{k.value}</dd>
                {k.hint && <dd className="ag-kpi-hint">{k.hint}</dd>}
              </div>
            ))}
          </dl>

          <section className="ag-block" aria-labelledby="ag-analytics-topics">
            <h3 id="ag-analytics-topics" className="ui-section-title">
              {t('analytics.topics')}
            </h3>
            <p className="ui-help">{t('analytics.topicsHint')}</p>
            {data.topics.topics.length === 0 ? (
              <p className="ag-quiet">{t('analytics.noTopics')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('analytics.topic')}</th>
                      <th scope="col" className="num">
                        {t('analytics.conversations')}
                      </th>
                      <th scope="col" className="num">
                        {t('analytics.handoff')}
                      </th>
                      <th scope="col">{t('analytics.examples')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topics.topics.map((topic) => (
                      <tr key={topic.keyword}>
                        <td>{topic.keyword}</td>
                        <td className="num data">{num(topic.count)}</td>
                        <td className="num data">{pct(topic.count ? topic.handoffs / topic.count : null)}</td>
                        <td className="ag-analytics-examples">{topic.examples.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.topics.other > 0 && <p className="ui-help">{t('analytics.otherTopics', { count: data.topics.other })}</p>}
          </section>

          <section className="ag-block" aria-labelledby="ag-analytics-tools">
            <h3 id="ag-analytics-tools" className="ui-section-title">
              {t('analytics.tools')}
            </h3>
            {data.tools.length === 0 ? (
              <p className="ag-quiet">{t('analytics.noTools')}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">{t('analytics.tool')}</th>
                      <th scope="col" className="num">
                        {t('analytics.calls')}
                      </th>
                      <th scope="col" className="num">
                        {t('analytics.errors')}
                      </th>
                      <th scope="col" className="num">
                        {t('analytics.avgTime')}
                      </th>
                      <th scope="col">{t('analytics.lastError')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tools.map((tool) => (
                      <tr key={tool.tool}>
                        <td>{toolName(t, tool.tool)}</td>
                        <td className="num data">{num(tool.calls)}</td>
                        <td className="num data" data-bad={tool.errors > 0 || undefined}>
                          {num(tool.errors)}
                        </td>
                        <td className="num data">{t('analytics.ms', { ms: tool.avgMs })}</td>
                        <td className="ag-analytics-error data">{tool.lastError ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="ag-block" aria-labelledby="ag-analytics-quality">
            <div className="ag-section-head">
              <h3 id="ag-analytics-quality" className="ui-section-title">
                {t('quality.title')}
              </h3>
              {canEdit && (
                <button type="button" className="btn btn-secondary btn-sm" aria-busy={scoring || undefined} disabled={scoring} onClick={() => void scoreNow()}>
                  {scoring ? t('quality.scoring') : t('quality.scoreNow')}
                </button>
              )}
            </div>
            <p className="ui-help">{t('quality.hint')}</p>
            {scoreNote && (
              <p className={scoreNote.kind === 'error' ? 'ui-error' : 'ui-help'} role={scoreNote.kind === 'error' ? 'alert' : 'status'}>
                {scoreNote.text}
              </p>
            )}
            {data.quality.scored === 0 ? (
              <p className="ag-quiet">{t('quality.none')}</p>
            ) : (
              <>
                <dl className="ag-kpis">
                  <div className="ag-kpi">
                    <dt>{t('quality.avgCsat')}</dt>
                    <dd className="data">{data.quality.avgCsat == null ? '–' : format.number(data.quality.avgCsat, { maximumFractionDigits: 1 })} / 5</dd>
                    <dd className="ag-kpi-hint">{t('quality.scoredHint', { count: data.quality.scored })}</dd>
                  </div>
                  <div className="ag-kpi">
                    <dt>{t('quality.csatRate')}</dt>
                    <dd className="data">{pct(data.quality.csatRate)}</dd>
                  </div>
                  <div className="ag-kpi">
                    <dt>{t('quality.sentiment')}</dt>
                    <dd className="data">
                      {num(data.quality.sentiment.positive)} / {num(data.quality.sentiment.neutral)} / {num(data.quality.sentiment.negative)}
                    </dd>
                    <dd className="ag-kpi-hint">{t('quality.sentimentHint')}</dd>
                  </div>
                  <div className="ag-kpi">
                    <dt>{t('quality.needsReview')}</dt>
                    <dd className="data">{num(data.quality.needsReview)}</dd>
                    {onOpenReview && data.quality.needsReview > 0 && (
                      <dd className="ag-kpi-hint">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenReview}>
                          {t('quality.openQueue')}
                        </button>
                      </dd>
                    )}
                  </div>
                </dl>
                {data.quality.aiTopics.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <caption className="ui-help ag-caption">{t('quality.aiTopics')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('analytics.topic')}</th>
                          <th scope="col" className="num">
                            {t('analytics.conversations')}
                          </th>
                          <th scope="col" className="num">
                            {t('quality.avgCsat')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.quality.aiTopics.map((topic) => (
                          <tr key={topic.topic}>
                            <td>{topic.topic}</td>
                            <td className="num data">{num(topic.count)}</td>
                            <td className="num data">{topic.avgCsat == null ? '–' : format.number(topic.avgCsat, { maximumFractionDigits: 1 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.quality.criteria.length > 0 && (
                  <div className="table-wrap">
                    <table className="table">
                      <caption className="ui-help ag-caption">{t('quality.criteria')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('quality.criterion')}</th>
                          <th scope="col" className="num">
                            {t('quality.passRate')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.quality.criteria.map((c) => (
                          <tr key={c.criterion}>
                            <td>{c.criterion}</td>
                            <td className="num data" data-bad={c.fail > c.pass || undefined}>
                              {pct(c.pass + c.fail ? c.pass / (c.pass + c.fail) : null)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="ag-block" aria-labelledby="ag-analytics-channels">
            <h3 id="ag-analytics-channels" className="ui-section-title">
              {t('quality.channels')}
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t('quality.channel')}</th>
                    <th scope="col" className="num">
                      {t('analytics.conversations')}
                    </th>
                    <th scope="col" className="num">
                      {t('analytics.resolution')}
                    </th>
                    <th scope="col" className="num">
                      {t('analytics.handoff')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((c) => (
                    <tr key={c.channel}>
                      <td>{t.has(`channelNames.${c.channel}` as never) ? t(`channelNames.${c.channel}` as never) : c.channel}</td>
                      <td className="num data">{num(c.conversations)}</td>
                      <td className="num data">{pct(c.resolutionRate)}</td>
                      <td className="num data">{num(c.handedOff)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ag-block" aria-labelledby="ag-analytics-reasons">
            <h3 id="ag-analytics-reasons" className="ui-section-title">
              {t('quality.handoffReasons')}
            </h3>
            {data.handoffReasons.length === 0 ? (
              <p className="ag-quiet">{t('quality.noHandoffs')}</p>
            ) : (
              <ul className="ag-rows">
                {data.handoffReasons.map((r) => (
                  <li key={`${r.kind}:${r.reason}`} className="ag-reason">
                    <span className="badge">{t(`quality.reasonKinds.${r.kind}`)}</span>
                    <span className="ag-reason-text">{r.reason || t(`quality.reasonEmpty.${r.kind}`)}</span>
                    <span className="data">{num(r.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="ag-block ag-analytics-alerts" aria-labelledby="ag-analytics-alerts">
        <h3 id="ag-analytics-alerts" className="ui-section-title">
          {t('analytics.alertsTitle')}
        </h3>
        <label className="ui-switch">
          <input
            type="checkbox"
            role="switch"
            checked={alerts ?? true}
            disabled={!canEdit || alerts === null || alertsBusy}
            aria-busy={alertsBusy || undefined}
            onChange={(e) => void toggleAlerts(e.target.checked)}
          />
          {t('analytics.alertsSwitch')}
        </label>
        <p className="ui-help">{t('analytics.alertsHint')}</p>
        {alertsError && (
          <p className="ui-error" role="alert">
            {alertsError}
          </p>
        )}
      </section>
    </div>
  );
}
