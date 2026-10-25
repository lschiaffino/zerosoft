'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import {
  BUILTIN_FIELDS,
  DATE_BUCKETS,
  FILTER_OPS,
  REPORT_AGGS,
  REPORT_SOURCES,
  REPORT_VIZ,
  SOURCE_ASSOCIATIONS,
  SOURCE_OBJECT,
  defaultConfig,
  fieldObject,
  toCsv,
  type ReportConfig,
  type ReportEnum,
  type ReportFieldType,
  type ReportObject,
  type ReportResult,
  type ReportSource,
} from '@/lib/crm-report-builder';
import { ACTIVITY_TYPES, LEAD_STATUSES, LIFECYCLE_STAGES, PRIORITIES, SOURCES } from '@/lib/crm-constants';
import ReportChart, { resultToCsvRows, useReportFormat } from './ReportChart';

export interface BuilderField {
  key: string;
  obj: ReportObject;
  type: ReportFieldType;
  enum?: ReportEnum;
  options?: string[];
  /** Etiqueta de un campo propio. */
  label?: string;
}

interface Props {
  report: { id: string; name: string; config: ReportConfig } | null;
  customFields: BuilderField[];
  dashboards: Array<{ id: string; name: string }>;
  people: Array<{ id: string; name: string }>;
  pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>;
  locale: string;
  baseCurrency: string;
}

type RunState = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; result: ReportResult };

const FORECAST_VALUES = ['pipeline', 'best_case', 'commit', 'closed_won', 'lost'];

export default function ReportBuilder({ report, customFields, dashboards, people, pipelines, locale, baseCurrency }: Props) {
  const router = useRouter();
  const fmt = useReportFormat(locale, baseCurrency);
  const { t } = fmt;
  const tb = (k: string, v?: Record<string, string | number>) => t(`reportBuilder.${k}`, v);

  const [id, setId] = useState(report?.id ?? null);
  const [name, setName] = useState(report?.name ?? '');
  const [config, setConfig] = useState<ReportConfig>(report?.config ?? defaultConfig('deals'));
  const [saved, setSaved] = useState(() => JSON.stringify({ name: report?.name ?? '', config: report?.config ?? null }));
  const [run, setRun] = useState<RunState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<null | 'dashboard'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const dirty = JSON.stringify({ name, config }) !== saved;

  // ---------- Campos ----------
  const base = SOURCE_OBJECT[config.source];
  const objects = useMemo(() => [base, ...config.objects.filter((o) => o !== base)], [base, config.objects]);
  const fields: BuilderField[] = useMemo(() => {
    const out: BuilderField[] = [];
    for (const o of objects) {
      for (const f of BUILTIN_FIELDS[o]) {
        if (f.only && !f.only.includes(config.source)) continue;
        out.push({ key: `${o}.${f.name}`, obj: o, type: f.type, enum: f.enum });
      }
      out.push(...customFields.filter((c) => c.obj === o));
    }
    return out;
  }, [objects, customFields, config.source]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const multi = objects.length > 1;
  const label = (f: BuilderField | undefined, key?: string) => {
    if (!f) return key ?? '';
    const l = fmt.fieldLabel(f);
    return multi ? `${tb(`objectNames.${f.obj}`)} · ${l}` : l;
  };

  function patch(p: Partial<ReportConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  // ---------- Correr el reporte (debounce) ----------
  useEffect(() => {
    setRun({ status: 'loading' });
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/crm/custom-reports/run', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ config }),
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setRun({ status: 'error', code: (data as { error?: string }).error ?? 'unknown' });
        else setRun({ status: 'ready', result: data as ReportResult });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setRun({ status: 'error', code: 'network' });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [config]);

  // Aviso al salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  function flash(m: string) {
    setMessage(m);
    setTimeout(() => setMessage(null), 2000);
  }

  async function save(): Promise<string | null> {
    const finalName = name.trim() || tb('untitled');
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(id ? `/api/crm/custom-reports/${id}` : '/api/crm/custom-reports', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: finalName, config }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(errorText((data as { error?: string }).error));
        return null;
      }
      const row = (await res.json()) as { id: string; name: string };
      setName(row.name);
      setSaved(JSON.stringify({ name: row.name, config }));
      flash(tb('saved'));
      if (!id) {
        setId(row.id);
        router.replace(`/app/crm/reports/custom/${row.id}`);
      }
      router.refresh();
      return row.id;
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!id) return;
    const res = await fetch(`/api/crm/custom-reports/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      setSaved(JSON.stringify({ name, config }));
      router.push('/app/crm/reports/custom');
      router.refresh();
    } else setError(tb('errors.generic'));
  }

  async function addToDashboard(dashboardId: string) {
    setMenu(null);
    const reportId = dirty || !id ? await save() : id;
    if (!reportId) return;
    const res = await fetch(`/api/crm/dashboards/${dashboardId}/widgets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'custom_report', config: { reportId } }),
    });
    if (res.ok) flash(tb('addedToDashboard'));
    else setError(tb('errors.generic'));
  }

  function exportCsv() {
    if (run.status !== 'ready') return;
    const { header, rows } = resultToCsvRows(run.result, fmt);
    const blob = new Blob([`﻿${toCsv(header, rows)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(name.trim() || tb('untitled')).replace(/[^\p{L}\p{N}\- _]/gu, '').slice(0, 80) || 'report'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function errorText(code?: string): string {
    if (code && t.has(`reportBuilder.errors.${code}`)) return tb(`errors.${code}`);
    return tb('errors.generic');
  }

  // ---------- Opciones para valores select ----------
  function optionsFor(f: BuilderField): Array<{ value: string; label: string }> {
    const fromList = (list: readonly string[], ns: string) => list.map((v) => ({ value: v, label: t(`enums.${ns}.${v}`) }));
    switch (f.enum) {
      case 'lifecycle':
        return fromList(LIFECYCLE_STAGES, 'lifecycle');
      case 'leadStatus':
        return fromList(LEAD_STATUSES, 'leadStatus');
      case 'source':
        return fromList(SOURCES, 'source');
      case 'priority':
        return fromList(PRIORITIES, 'priority');
      case 'activityType':
        return fromList(ACTIVITY_TYPES.filter((a) => a !== 'task'), 'activityType');
      case 'owner':
        return people.map((p) => ({ value: p.id, label: p.name }));
      case 'pipeline':
        return pipelines.map((p) => ({ value: p.id, label: p.name }));
      case 'stage':
        return pipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: pipelines.length > 1 ? `${p.name} · ${s.name}` : s.name })));
      case 'forecastCategory':
        return FORECAST_VALUES.map((v) => ({ value: v, label: t(`forecast.category.${v}`) }));
      case 'options':
        return (f.options ?? []).map((o) => ({ value: o, label: o }));
      default:
        return [];
    }
  }

  const aggregate = config.dimensions.length > 0 || config.viz !== 'table';
  const numberFields = fields.filter((f) => f.type === 'number');
  const dimFields = fields.filter((f) => f.type !== 'number' && !(f.type === 'text' && f.key.endsWith('.email')));
  const unusedColumns = fields.filter((f) => !config.columns.includes(f.key));

  function setSource(source: ReportSource) {
    setConfig({ ...defaultConfig(source), viz: config.viz === 'table' ? 'table' : config.viz });
  }

  function toggleObject(o: ReportObject, on: boolean) {
    if (on) {
      patch({ objects: [...config.objects, o] });
      return;
    }
    // Quitar un objeto quita sus campos de la config.
    const keep = (k: string) => fieldObject(k) !== o;
    setConfig((c) => ({
      ...c,
      objects: c.objects.filter((x) => x !== o),
      columns: c.columns.filter(keep),
      filters: c.filters.filter((f) => keep(f.f)),
      dimensions: c.dimensions.filter((d) => keep(d.field)),
      metric: (c.metric.field && !keep(c.metric.field)) || c.metric.object === o ? { agg: 'count' } : c.metric,
    }));
  }

  return (
    <div className="rb">
      <div className="rb-head">
        <input
          className="input rb-name"
          aria-label={tb('name')}
          placeholder={tb('untitled')}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
          }}
        />
        <div className="rb-head-actions">
          {dirty && <span className="muted rb-status">{tb('unsaved')}</span>}
          {message && (
            <span className="saved-ok rb-status" role="status">
              {message}
            </span>
          )}
          <button type="button" className="btn btn-small btn-solid" onClick={() => void save()} disabled={saving}>
            {saving ? t('common.saving') : tb('save')}
          </button>
          <button type="button" className="btn btn-small" onClick={exportCsv} disabled={run.status !== 'ready'}>
            {tb('exportCsv')}
          </button>
          <div className="rb-menu-wrap" ref={menuRef}>
            <button type="button" className="btn btn-small" aria-haspopup="menu" aria-expanded={menu === 'dashboard'} onClick={() => setMenu(menu ? null : 'dashboard')}>
              {tb('addToDashboard')}
            </button>
            {menu === 'dashboard' && (
              <div className="rb-menu" role="menu">
                {dashboards.length === 0 ? (
                  <p className="muted">{tb('noDashboards')}</p>
                ) : (
                  dashboards.map((d) => (
                    <button key={d.id} type="button" role="menuitem" onClick={() => void addToDashboard(d.id)}>
                      {d.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {id &&
            (confirmDelete ? (
              <>
                <span className="rb-status">{tb('confirmDelete')}</span>
                <button type="button" className="btn btn-small btn-danger" onClick={() => void remove()} onKeyDown={(e) => e.key === 'Escape' && setConfirmDelete(false)}>
                  {t('common.delete')}
                </button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirmDelete(false)} autoFocus onKeyDown={(e) => e.key === 'Escape' && setConfirmDelete(false)}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setConfirmDelete(true)}>
                {t('common.delete')}
              </button>
            ))}
        </div>
      </div>
      {error && (
        <p className="rb-error" role="alert">
          {error}
        </p>
      )}

      <div className="rb-layout">
        <aside className="rb-side">
          <section className="panel rb-section">
            <p className="section-label">{tb('source')}</p>
            <select className="filter-select" aria-label={tb('source')} value={config.source} onChange={(e) => setSource(e.target.value as ReportSource)}>
              {REPORT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {tb(`sources.${s}`)}
                </option>
              ))}
            </select>
            <p className="section-label">{tb('objects')}</p>
            {SOURCE_ASSOCIATIONS[config.source].map((o) => (
              <label key={o} className="rb-check">
                <input type="checkbox" checked={config.objects.includes(o)} onChange={(e) => toggleObject(o, e.target.checked)} />
                <span>{tb(`objectNames.${o}`)}</span>
              </label>
            ))}
          </section>

          <section className="panel rb-section">
            <p className="section-label">{tb('viz')}</p>
            <div className="rb-viz" role="group" aria-label={tb('viz')}>
              {REPORT_VIZ.map((v) => (
                <button key={v} type="button" aria-pressed={config.viz === v} onClick={() => patch({ viz: v })}>
                  {tb(`vizs.${v}`)}
                </button>
              ))}
            </div>
          </section>

          {aggregate ? (
            <>
              <section className="panel rb-section">
                <p className="section-label">{tb('metric')}</p>
                <div className="rb-row">
                  <select
                    className="filter-select"
                    aria-label={tb('metric')}
                    value={config.metric.agg}
                    onChange={(e) => {
                      const agg = e.target.value as ReportConfig['metric']['agg'];
                      patch({ metric: agg === 'count' ? { agg } : { agg, field: config.metric.field ?? numberFields[0]?.key } });
                    }}
                  >
                    {REPORT_AGGS.map((a) => (
                      <option key={a} value={a} disabled={a !== 'count' && numberFields.length === 0}>
                        {tb(`aggs.${a}`)}
                      </option>
                    ))}
                  </select>
                  {config.metric.agg === 'count' ? (
                    <select
                      className="filter-select"
                      aria-label={tb('countWhat')}
                      value={config.metric.object ?? base}
                      onChange={(e) => patch({ metric: { agg: 'count', object: e.target.value as ReportObject } })}
                    >
                      {objects.map((o) => (
                        <option key={o} value={o}>
                          {tb(`objectNames.${o}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="filter-select"
                      aria-label={tb('metricField')}
                      value={config.metric.field ?? ''}
                      onChange={(e) => patch({ metric: { ...config.metric, field: e.target.value } })}
                    >
                      {numberFields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {label(f)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </section>

              {config.viz !== 'kpi' && (
                <section className="panel rb-section">
                  <p className="section-label">{tb('dimensions')}</p>
                  {config.dimensions.map((d, i) => {
                    const f = fieldByKey.get(d.field);
                    return (
                      <div key={i} className="rb-row">
                        <select
                          className="filter-select"
                          aria-label={tb('dimension', { n: i + 1 })}
                          value={d.field}
                          onChange={(e) => {
                            const nf = fieldByKey.get(e.target.value);
                            const dims = [...config.dimensions];
                            dims[i] = { field: e.target.value, bucket: nf?.type === 'date' ? d.bucket ?? 'month' : undefined };
                            patch({ dimensions: dims });
                          }}
                        >
                          {!f && <option value={d.field}>{d.field}</option>}
                          {dimFields.map((x) => (
                            <option key={x.key} value={x.key}>
                              {label(x)}
                            </option>
                          ))}
                        </select>
                        {f?.type === 'date' && (
                          <select
                            className="filter-select"
                            aria-label={tb('bucket')}
                            value={d.bucket ?? 'month'}
                            onChange={(e) => {
                              const dims = [...config.dimensions];
                              dims[i] = { ...d, bucket: e.target.value as (typeof DATE_BUCKETS)[number] };
                              patch({ dimensions: dims });
                            }}
                          >
                            {DATE_BUCKETS.map((b) => (
                              <option key={b} value={b}>
                                {tb(`buckets.${b}`)}
                              </option>
                            ))}
                          </select>
                        )}
                        <button type="button" className="rb-icon-btn" aria-label={tb('removeDimension')} onClick={() => patch({ dimensions: config.dimensions.filter((_x, j) => j !== i) })}>
                          ×
                        </button>
                      </div>
                    );
                  })}
                  {config.dimensions.length < 2 && dimFields.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      onClick={() => {
                        const pick = dimFields.find((f) => !config.dimensions.some((d) => d.field === f.key)) ?? dimFields[0];
                        patch({ dimensions: [...config.dimensions, { field: pick.key, bucket: pick.type === 'date' ? 'month' : undefined }] });
                      }}
                    >
                      + {tb('addDimension')}
                    </button>
                  )}
                  {config.dimensions.length > 0 && (
                    <select className="filter-select" aria-label={tb('sort')} value={config.sort} onChange={(e) => patch({ sort: e.target.value as ReportConfig['sort'] })}>
                      {(['value_desc', 'value_asc', 'label'] as const).map((s) => (
                        <option key={s} value={s}>
                          {tb(`sorts.${s}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </section>
              )}
            </>
          ) : (
            <section className="panel rb-section">
              <p className="section-label">{tb('columns')}</p>
              {config.columns.map((k, i) => (
                <div key={k} className="rb-chip-row">
                  <span title={label(fieldByKey.get(k), k)}>{label(fieldByKey.get(k), k)}</span>
                  <span>
                    <button type="button" className="rb-icon-btn" aria-label={tb('moveUp')} disabled={i === 0} onClick={() => {
                      const cols = [...config.columns];
                      [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
                      patch({ columns: cols });
                    }}>
                      ↑
                    </button>
                    <button type="button" className="rb-icon-btn" aria-label={tb('removeColumn')} onClick={() => patch({ columns: config.columns.filter((c) => c !== k) })}>
                      ×
                    </button>
                  </span>
                </div>
              ))}
              {unusedColumns.length > 0 && config.columns.length < 15 && (
                <select
                  className="filter-select"
                  aria-label={tb('addColumn')}
                  value=""
                  onChange={(e) => e.target.value && patch({ columns: [...config.columns, e.target.value] })}
                >
                  <option value="">+ {tb('addColumn')}</option>
                  {unusedColumns.map((f) => (
                    <option key={f.key} value={f.key}>
                      {label(f)}
                    </option>
                  ))}
                </select>
              )}
              <p className="muted rb-note">{tb('columnsHint')}</p>
            </section>
          )}

          <section className="panel rb-section">
            <p className="section-label">{tb('filters')}</p>
            {config.filters.map((rule, i) => {
              const f = fieldByKey.get(rule.f);
              const ops = f ? FILTER_OPS[f.type] : [];
              const set = (p: Partial<typeof rule>) => {
                const list = [...config.filters];
                list[i] = { ...rule, ...p };
                patch({ filters: list });
              };
              const needsValue = rule.o !== 'known' && rule.o !== 'unknown';
              return (
                <div key={i} className="rb-filter">
                  <div className="rb-row">
                    <select
                      className="filter-select"
                      aria-label={t('filters.property')}
                      value={rule.f}
                      onChange={(e) => {
                        const nf = fieldByKey.get(e.target.value);
                        set({ f: e.target.value, o: nf ? FILTER_OPS[nf.type][0] : 'is', v: '', v2: undefined });
                      }}
                    >
                      {!f && <option value={rule.f}>{rule.f}</option>}
                      {fields.map((x) => (
                        <option key={x.key} value={x.key}>
                          {label(x)}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="rb-icon-btn" aria-label={t('filters.removeRule')} onClick={() => patch({ filters: config.filters.filter((_x, j) => j !== i) })}>
                      ×
                    </button>
                  </div>
                  <div className="rb-row">
                    <select className="filter-select" aria-label={t('filters.operator')} value={rule.o} onChange={(e) => set({ o: e.target.value, v: e.target.value === 'last' ? '30' : rule.v })}>
                      {ops.map((o) => (
                        <option key={o} value={o}>
                          {t.has(`filters.op.${o}`) ? t(`filters.op.${o}`) : tb(`ops.${o}`)}
                        </option>
                      ))}
                    </select>
                    {f && needsValue && <FilterValue field={f} rule={rule} options={optionsFor(f)} onChange={set} tb={tb} t={t} />}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-small btn-ghost"
              onClick={() => {
                const f = fields[0];
                patch({ filters: [...config.filters, { f: f.key, o: FILTER_OPS[f.type][0], v: '' }] });
              }}
              disabled={config.filters.length >= 20}
            >
              {t('filters.addRule')}
            </button>
          </section>
        </aside>

        <div className="rb-main">
          <section className="panel rb-result" aria-live="polite" aria-busy={run.status === 'loading'}>
            <div className="rb-result-head">
              <p className="section-label">{tb('preview')}</p>
              <span className="muted rb-note">{tb(`sources.${config.source}`)}</span>
            </div>
            {run.status === 'loading' && <p className="muted">{t('dashboards.loading')}</p>}
            {run.status === 'error' && (
              <p className="rb-error" role="alert">
                {errorText(run.code)}
              </p>
            )}
            {run.status === 'ready' && <ReportChart result={run.result} viz={config.viz} locale={locale} baseCurrency={baseCurrency} />}
          </section>
        </div>
      </div>
    </div>
  );
}

function FilterValue({
  field,
  rule,
  options,
  onChange,
  tb,
  t,
}: {
  field: BuilderField;
  rule: { o: string; v?: string; v2?: string };
  options: Array<{ value: string; label: string }>;
  onChange: (p: { v?: string; v2?: string }) => void;
  tb: (k: string, v?: Record<string, string | number>) => string;
  t: (k: string) => string;
}) {
  const aria = t('filters.value');
  if (field.type === 'boolean') {
    return (
      <select className="filter-select" aria-label={aria} value={rule.v ?? ''} onChange={(e) => onChange({ v: e.target.value })}>
        <option value="">{tb('chooseValue')}</option>
        <option value="1">{t('common.yes')}</option>
        <option value="0">{t('common.no')}</option>
      </select>
    );
  }
  if (field.type === 'select') {
    if (!options.length) return <input className="input" aria-label={aria} value={rule.v ?? ''} onChange={(e) => onChange({ v: e.target.value })} />;
    return (
      <select className="filter-select" aria-label={aria} value={rule.v ?? ''} onChange={(e) => onChange({ v: e.target.value })}>
        <option value="">{tb('chooseValue')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'date') {
    if (rule.o === 'last') {
      return (
        <input className="input" type="number" min={1} max={3650} aria-label={tb('lastDays')} value={rule.v ?? ''} onChange={(e) => onChange({ v: e.target.value })} />
      );
    }
    return (
      <>
        <input className="input" type="date" aria-label={aria} value={rule.v ?? ''} onChange={(e) => onChange({ v: e.target.value })} />
        {rule.o === 'between' && <input className="input" type="date" aria-label={t('filters.valueTo')} value={rule.v2 ?? ''} onChange={(e) => onChange({ v2: e.target.value })} />}
      </>
    );
  }
  return (
    <input
      className="input"
      type={field.type === 'number' ? 'number' : 'text'}
      aria-label={aria}
      value={rule.v ?? ''}
      onChange={(e) => onChange({ v: e.target.value })}
    />
  );
}
