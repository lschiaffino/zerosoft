'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DatasetFilter, DatasetRowDto } from '@/lib/robots-dataset';
import { MAX_AI_COLUMN_ROWS, MAX_AI_COLUMNS, listVariables, type RobotSettings, type RobotStep } from '@/lib/robots-schema';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import { RobotDialog } from './robots-ui';
import { parseDbUtc } from '@/lib/utils';

const FILTERS: DatasetFilter[] = ['active', 'new', 'changed', 'removed', 'all'];

interface RowsResponse {
  rows: DatasetRowDto[];
  total: number;
  columns: string[];
  counts: { active: number; removed: number };
  hidden: number;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Pestaña Datos: la tabla acumulada entre corridas (filtros, búsqueda, CSV,
 * vaciar) y sus ajustes (lista, clave única, columnas con IA).
 */
export default function DataPanel({
  robotId,
  steps,
  settings,
  onSettings,
  readOnly,
  dirty,
  refreshKey,
  onToast,
}: {
  robotId: string;
  steps: RobotStep[];
  settings: RobotSettings;
  onSettings: (s: RobotSettings) => void;
  readOnly: boolean;
  dirty: boolean;
  /** Cambia cuando termina una corrida: se recargan las filas. */
  refreshKey: number;
  onToast: (msg: string) => void;
}) {
  const t = useTranslations('robots.data');
  const format = useFormatter();
  const uid = useId();
  const [filter, setFilter] = useState<DatasetFilter>('active');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const lists = listVariables(steps);
  const ds = settings.dataset ?? { enabled: true, variable: '', keyFields: [] };
  const enabled = ds.enabled !== false;
  const aiColumns = settings.aiColumns ?? [];

  // Búsqueda con un respiro mientras se escribe.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(q), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ filter });
    if (query.trim()) params.set('q', query.trim());
    const res = await fetch(`/api/robots/${robotId}/rows?${params}`).catch(() => null);
    const body = (await res?.json().catch(() => null)) as RowsResponse | null;
    setLoading(false);
    if (!res?.ok || !body) {
      setError(true);
      return;
    }
    setData(body);
  }, [robotId, filter, query]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const setDataset = (patch: Partial<NonNullable<RobotSettings['dataset']>>) =>
    onSettings({ ...settings, dataset: { enabled: ds.enabled !== false, variable: ds.variable ?? '', keyFields: ds.keyFields ?? [], ...patch } });

  async function clear() {
    setClearing(true);
    const res = await fetch(`/api/robots/${robotId}/rows`, { method: 'DELETE' }).catch(() => null);
    setClearing(false);
    setClearOpen(false);
    if (res?.ok) {
      onToast(t('cleared'));
      void load();
    }
  }

  const columns = data?.columns ?? [];
  const csvHref = `/api/robots/${robotId}/rows?${new URLSearchParams({ filter, format: 'csv', ...(query.trim() ? { q: query.trim() } : {}) })}`;

  return (
    <div className="robots-data">
      <section className="robots-block" aria-labelledby={`${uid}-rows`}>
        <div className="robots-block-head is-stacked">
          <h2 className="ui-section-title" id={`${uid}-rows`}>
            {t('title')}
          </h2>
          <p className="robots-muted">{t('desc')}</p>
        </div>
        <div className="robots-data-bar">
          <div className="btn-group" role="group" aria-label={t('filtersLabel')}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className="btn btn-sm" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`filters.${f}`)}
              </button>
            ))}
          </div>
          <input
            className="input robots-data-search"
            type="search"
            value={q}
            placeholder={t('search')}
            aria-label={t('search')}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="robots-toolbar-actions">
            <a className="btn btn-secondary btn-sm" href={csvHref} download aria-disabled={!data?.total || undefined}>
              {t('csv')}
            </a>
            {!readOnly && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={!data || data.counts.active + data.counts.removed === 0} onClick={() => setClearOpen(true)}>
                {t('clear')}
              </button>
            )}
          </span>
        </div>
        {data && data.hidden > 0 && <p className="robots-note-warn">{t('hidden', { count: data.hidden })}</p>}
        {loading && !data ? (
          <div className="ui-loading-stack" aria-busy="true">
            <span className="sr-only">{t('loading')}</span>
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
            <span className="ui-skeleton ui-skeleton-row" />
          </div>
        ) : error ? (
          <div className="robots-alert" role="alert">
            {t('error')}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
              {t('retry')}
            </button>
          </div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState quiet title={data && (query || filter !== 'active') && data.counts.active + data.counts.removed > 0 ? t('emptyFilter') : t('empty')} />
        ) : (
          <>
            <p className="robots-muted robots-small" aria-live="polite">
              {t('count', { shown: data.rows.length, total: data.total })}
            </p>
            <div className="table-wrap robots-scroll" aria-busy={loading || undefined}>
              <table className="table table-compact table-sticky robots-data-table">
                <caption className="sr-only">{t('tableTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('status')}</th>
                    {columns.map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                    <th scope="col">{t('firstSeen')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} data-status={r.status}>
                      <td>
                        {r.status === 'removed' ? (
                          <span className="badge badge-bad">{t('badgeRemoved')}</span>
                        ) : r.isNew ? (
                          <span className="badge badge-ok">{t('badgeNew')}</span>
                        ) : r.changedAt && r.changedAt === r.lastSeenAt ? (
                          <span className="badge badge-warn">{t('badgeChanged')}</span>
                        ) : null}
                      </td>
                      {columns.map((c) => (
                        <td key={c}>{cell(r.data[c])}</td>
                      ))}
                      <td className="num" suppressHydrationWarning>
                        {format.dateTime(parseDbUtc(r.firstSeenAt), { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <FormSection title={t('settingsTitle')} description={dirty ? t('unsaved') : undefined}>
        <label className="ui-switch">
          <input type="checkbox" role="switch" checked={enabled} disabled={readOnly} onChange={(e) => setDataset({ enabled: e.target.checked })} />
          <span>{t('enabled')}</span>
        </label>
        {lists.length === 0 ? (
          <p className="robots-muted robots-small">{t('noLists')}</p>
        ) : (
          enabled && (
            <div className="ui-fields-2">
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-var`}>
                  {t('variable')}
                </label>
                <select id={`${uid}-var`} className="select" value={ds.variable ?? ''} disabled={readOnly} onChange={(e) => setDataset({ variable: e.target.value })}>
                  <option value="">{t('variableAuto', { name: lists[0] })}</option>
                  {lists.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`${uid}-key`}>
                  {t('key')}
                </label>
                <input
                  id={`${uid}-key`}
                  className="input data"
                  value={(ds.keyFields ?? []).join(', ')}
                  readOnly={readOnly}
                  placeholder={t('keyPlaceholder')}
                  spellCheck={false}
                  aria-describedby={`${uid}-key-help`}
                  onChange={(e) =>
                    setDataset({
                      keyFields: e.target.value
                        .split(/[,\s]+/)
                        .map((x) => x.trim())
                        .filter((x) => /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(x))
                        .slice(0, 5),
                    })
                  }
                />
                <p className="ui-help" id={`${uid}-key-help`}>
                  {t('keyHint')}
                </p>
              </div>
            </div>
          )
        )}
      </FormSection>

      <FormSection title={t('aiTitle')} description={t('aiDesc', { rows: MAX_AI_COLUMN_ROWS })}>
        {aiColumns.map((c, i) => (
          <div key={i} className="robots-ai-col">
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-ai-l-${i}`}>
                {t('aiList')}
              </label>
              <select
                id={`${uid}-ai-l-${i}`}
                className="select"
                value={c.variable}
                disabled={readOnly}
                onChange={(e) => onSettings({ ...settings, aiColumns: aiColumns.map((x, k) => (k === i ? { ...x, variable: e.target.value } : x)) })}
              >
                {[...new Set([c.variable, ...lists])].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="ui-field">
              <label className="label" htmlFor={`${uid}-ai-n-${i}`}>
                {t('aiName')}
              </label>
              <input
                id={`${uid}-ai-n-${i}`}
                className="input data"
                value={c.name}
                readOnly={readOnly}
                spellCheck={false}
                onChange={(e) => onSettings({ ...settings, aiColumns: aiColumns.map((x, k) => (k === i ? { ...x, name: e.target.value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) } : x)) })}
              />
            </div>
            <div className="ui-field robots-wide">
              <label className="label" htmlFor={`${uid}-ai-p-${i}`}>
                {t('aiPrompt')}
              </label>
              <input
                id={`${uid}-ai-p-${i}`}
                className="input"
                value={c.prompt}
                readOnly={readOnly}
                maxLength={1000}
                placeholder={t('aiPromptPlaceholder')}
                onChange={(e) => onSettings({ ...settings, aiColumns: aiColumns.map((x, k) => (k === i ? { ...x, prompt: e.target.value } : x)) })}
              />
            </div>
            {!readOnly && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onSettings({ ...settings, aiColumns: aiColumns.filter((_, k) => k !== i) })}
              >
                {t('aiRemove')}
              </button>
            )}
          </div>
        ))}
        {!readOnly && lists.length > 0 && aiColumns.length < MAX_AI_COLUMNS && (
          <div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onSettings({ ...settings, aiColumns: [...aiColumns, { variable: ds.variable || lists[0], name: `ai_${aiColumns.length + 1}`, prompt: '' }] })}
            >
              {t('aiAdd')}
            </button>
          </div>
        )}
        {lists.length === 0 && <p className="robots-muted robots-small">{t('noLists')}</p>}
      </FormSection>

      <RobotDialog
        open={clearOpen}
        busy={clearing}
        onClose={() => setClearOpen(false)}
        title={t('clearTitle')}
        foot={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setClearOpen(false)} disabled={clearing}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn-primary btn-danger" onClick={() => void clear()} disabled={clearing} aria-busy={clearing || undefined}>
              {t('clear')}
            </button>
          </>
        }
      >
        <p>{t('clearDesc')}</p>
      </RobotDialog>
    </div>
  );
}
