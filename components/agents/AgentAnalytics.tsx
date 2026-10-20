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
}: {
  agentId: string;
  canEdit: boolean;
  onOpenConversations?: () => void;
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
  }, [agentId, days, locale, t]);

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

          {data.channels.length > 1 && (
            <p className="ui-help">
              {data.channels
                .map((c) => `${t.has(`channelNames.${c.channel}` as never) ? t(`channelNames.${c.channel}` as never) : c.channel}: ${num(c.conversations)}`)
                .join(' · ')}
            </p>
          )}
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
