'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatNumber } from '@/lib/utils';
import ChatCollection, { type CollectionItem } from './ChatCollection';

const METRICS = ['conversations', 'resolved', 'resolution_rate', 'first_response', 'resolution_time', 'csat', 'messages'];
const GROUPS = ['day', 'week', 'tag', 'widget', 'team', 'channel', 'priority', 'status', 'assignee', 'company'];

interface Report extends CollectionItem {
  metric: string;
  group_by: string;
  range_days: number;
  widget_id: string | null;
}

interface Row {
  key: string;
  label: string;
  value: number | null;
  conversations: number;
}

/** Reportes propios: métrica × dimensión, guardados con nombre; abrir uno lo corre. */
export default function CustomReportsClient({ widgets }: { widgets: Array<{ id: string; name: string }> }) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const params = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(params.get('report'));
  const [result, setResult] = useState<{ report: Report; rows: Row[]; total: number } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const run = useCallback(async (id: string) => {
    setState('loading');
    try {
      const res = await fetch(`/api/chat/custom-reports/${id}`);
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { report: Report; result: { rows: Row[]; total: number } };
      setResult({ report: data.report, rows: data.result.rows, total: data.result.total });
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (openId) void run(openId);
    else setResult(null);
  }, [openId, run]);

  const rowLabel = (r: Row, group: string) => {
    if (group === 'priority') return t(`priorities.${r.key}`);
    if (group === 'status') return t(`conversation.${r.key}`);
    if (group === 'channel') return t(`channels.${r.key}`);
    return r.label || t('reportsCustom.none');
  };
  const format = (v: number | null, metric: string) => {
    if (v == null) return '–';
    if (metric === 'resolution_rate') return `${formatNumber(Math.round(v), locale)}%`;
    if (metric === 'first_response' || metric === 'resolution_time') return `${formatNumber(Math.round(v), locale)} min`;
    if (metric === 'csat') return `${formatNumber(Math.round(v * 10) / 10, locale)} / 5`;
    return formatNumber(v, locale);
  };
  const max = Math.max(1, ...(result?.rows ?? []).map((r) => r.value ?? 0));

  return (
    <>
      <ChatCollection<Report>
        ns="reportsCustom"
        api="/api/chat/custom-reports"
        listKey="reports"
        canManage
        defaults={{ metric: 'conversations', group_by: 'day', range_days: '30', widget_id: '' }}
        fields={[
          { id: 'name', label: t('reportsCustom.name'), type: 'text', required: true, maxLength: 80 },
          { id: 'metric', label: t('reportsCustom.metric'), type: 'select', options: METRICS.map((m) => ({ value: m, label: t(`reportsCustom.metrics.${m}`) })) },
          { id: 'group_by', label: t('reportsCustom.groupBy'), type: 'select', options: GROUPS.map((g) => ({ value: g, label: t(`reportsCustom.groups.${g}`) })) },
          { id: 'range_days', label: t('reportsCustom.range'), type: 'number', required: true },
          { id: 'widget_id', label: t('reportsCustom.widget'), type: 'select', options: [{ value: '', label: t('reportsCustom.allWidgets') }, ...widgets.map((w) => ({ value: w.id, label: w.name }))] },
        ]}
        toForm={(r) => ({ name: r.name, metric: r.metric, group_by: r.group_by, range_days: String(r.range_days), widget_id: r.widget_id ?? '' })}
        columns={[
          {
            label: t('reportsCustom.name'),
            render: (r) => (
              <button type="button" className="chat-row-button" aria-current={openId === r.id ? 'true' : undefined} onClick={() => setOpenId(r.id)}>
                {r.name}
              </button>
            ),
          },
          { label: t('reportsCustom.metric'), render: (r) => t(`reportsCustom.metrics.${r.metric}`) },
          { label: t('reportsCustom.groupBy'), render: (r) => t(`reportsCustom.groups.${r.group_by}`) },
          { label: t('reportsCustom.range'), render: (r) => t('reportsCustom.days', { days: r.range_days }) },
        ]}
        onSaved={(r) => {
          setOpenId(r.id);
          void run(r.id);
        }}
      />

      {state === 'error' && (
        <p className="ui-error" role="alert">
          {t('errors.loadFailed')}
        </p>
      )}
      {state === 'loading' && !result && <span className="ui-skeleton ui-skeleton-row" aria-label={t('common.loading')} />}
      {result && (
        <section className="chat-pane" aria-labelledby="chat-custom-result">
          <div className="chat-pane-head">
            <h2 id="chat-custom-result" className="ui-section-title">
              {result.report.name}
            </h2>
            <a className="btn btn-secondary btn-sm" href={`/api/chat/custom-reports/${result.report.id}?format=csv`} download>
              {t('reports.exportCsv')}
            </a>
          </div>
          <p className="ui-help">{t('reportsCustom.total', { count: result.total })}</p>
          {result.rows.length === 0 ? (
            <p className="chat-quiet">{t('reports.breakdownEmpty')}</p>
          ) : (
            <div className="table-wrap chat-stack">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{t(`reportsCustom.groups.${result.report.group_by}`)}</th>
                    <th scope="col" className="num">
                      {t(`reportsCustom.metrics.${result.report.metric}`)}
                    </th>
                    <th scope="col" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.key}>
                      <td>{rowLabel(r, result.report.group_by)}</td>
                      <td className="num data" data-label={t(`reportsCustom.metrics.${result.report.metric}`)}>{format(r.value, result.report.metric)}</td>
                      <td aria-hidden="true" className="chat-custom-bar-cell">
                        <span className="chat-custom-bar" style={{ width: `${Math.round(((r.value ?? 0) / max) * 100)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="ui-help">
            <Link href="/app/chat/reports">{t('reportsCustom.back')}</Link>
          </p>
        </section>
      )}
    </>
  );
}
