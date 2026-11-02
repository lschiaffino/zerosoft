'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/ui/EmptyState';
import type { ReportConfig, ReportResult, SavedReport } from '@/lib/people-extras';
import { api, Dialog, Field, useErrorText, useToast } from './people-ui';

const COLUMNS = ['name', 'workEmail', 'jobTitle', 'department', 'location', 'country', 'manager', 'status', 'employmentType', 'startDate', 'endDate', 'tenureYears', 'payPeriod', 'phone'] as const;
const TYPES = ['full_time', 'part_time', 'contractor', 'intern'] as const;
const STATUSES = ['active', 'onboarding', 'offboarding', 'terminated'] as const;

/** Armar una lista de personas: columnas, filtros, vista previa, CSV y guardarla. Solo HR (la ruta lo exige). */
export default function CustomReports({ saved: initial, customFields, departments, locations, openId = null, canSeePay = false }: { openId?: string | null; canSeePay?: boolean; saved: SavedReport[]; customFields: Array<{ id: string; label: string; sensitive: boolean }>; departments: string[]; locations: string[] }) {
  const t = useTranslations('people');
  const errText = useErrorText();
  const [toast, push] = useToast();
  const [saved, setSaved] = useState(initial);
  const [config, setConfig] = useState<ReportConfig>({ columns: ['name', 'jobTitle', 'department'] });
  const [result, setResult] = useState<ReportResult | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<SavedReport | null>(null);

  const options = useMemo(
    () => [...COLUMNS.filter((c) => c !== 'payPeriod' || canSeePay).map((c) => ({ key: c as string, label: t(`customReports.columns.${c}`) })), ...customFields.map((f) => ({ key: `custom:${f.id}`, label: f.sensitive ? `${f.label} (${t('customReports.sensitive')})` : f.label }))],
    [customFields, t, canSeePay],
  );
  const labelOf = (key: string, fallback: string) => options.find((o) => o.key === key)?.label ?? fallback;

  const run = async (next = config) => {
    setBusy(true);
    const res = await api<ReportResult>('/api/people/custom-reports', { method: 'POST', json: { config: next } });
    setBusy(false);
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setResult(res.data);
  };
  // Desde ⌘K: /reports?report=<id> abre ese reporte.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !openId) return;
    opened.current = true;
    const r = initial.find((x) => x.id === openId);
    if (r) {
      setConfig(r.config);
      void run(r.config);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  const rename = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!renaming) return;
    const next = String(new FormData(e.currentTarget).get('name') ?? '');
    const res = await api(`/api/people/custom-reports/${renaming.id}`, { method: 'PATCH', json: { name: next } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setSaved((s) => s.map((x) => (x.id === renaming.id ? { ...x, name: next.trim() } : x)).sort((a, b) => a.name.localeCompare(b.name)));
    setRenaming(null);
  };
  const toggle = (key: string, on: boolean) => setConfig((c) => ({ ...c, columns: on ? [...c.columns, key] : c.columns.filter((x) => x !== key) }));
  const download = async () => {
    const res = await fetch('/api/people/custom-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config, format: 'csv' }) });
    if (!res.ok) return push(errText('generic'), 'bad');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'people-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const save = async () => {
    const res = await api<{ report: SavedReport }>('/api/people/custom-reports', { method: 'POST', json: { name, config } });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setSaved((s) => [...s.filter((x) => x.id !== res.data.report.id), res.data.report].sort((a, b) => a.name.localeCompare(b.name)));
    setName('');
    push(t('common.saved'));
  };
  const remove = async (id: string) => {
    const res = await api(`/api/people/custom-reports/${id}`, { method: 'DELETE' });
    if (!res.ok) return push(errText(res.data.error), 'bad');
    setSaved((s) => s.filter((x) => x.id !== id));
  };

  return (
    <section className="ppl-panel" aria-labelledby="ppl-custom-reports" data-testid="people-custom-reports">
      {toast}
      <h2 id="ppl-custom-reports" className="ppl-panel-title">
        {t('customReports.title')}
      </h2>
      <p className="ppl-hint">{t('customReports.hint')}</p>
      {saved.length > 0 && (
        <ul className="ppl-home-list">
          {saved.map((r) => (
            <li key={r.id} className="ppl-home-row">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setConfig(r.config);
                  void run(r.config);
                }}
              >
                {r.name}
              </button>
              <span className="ppl-panel-actions">
                <button type="button" className="btn btn-sm btn-ghost" aria-label={t('customReports.renameNamed', { name: r.name })} onClick={() => setRenaming(r)}>
                  {t('customReports.rename')}
                </button>
                <button type="button" className="btn btn-sm btn-ghost" aria-label={t('customReports.deleteNamed', { name: r.name })} onClick={() => void remove(r.id)}>
                  {t('common.delete')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="ppl-report-columns">
        <legend className="label">{t('customReports.pick')}</legend>
        {options.map((o) => (
          <label key={o.key} className="ppl-check">
            <input type="checkbox" checked={config.columns.includes(o.key)} onChange={(e) => toggle(o.key, e.target.checked)} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="ppl-toolbar">
        <select className="select" aria-label={t('fields.department')} value={config.department ?? ''} onChange={(e) => setConfig({ ...config, department: e.target.value })}>
          <option value="">{t('directory.allDepartments')}</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('fields.location')} value={config.location ?? ''} onChange={(e) => setConfig({ ...config, location: e.target.value })}>
          <option value="">{t('directory.allLocations')}</option>
          {locations.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('fields.employmentType')} value={config.type ?? ''} onChange={(e) => setConfig({ ...config, type: e.target.value })}>
          <option value="">{t('directory.allTypes')}</option>
          {TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`types.${d}`)}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('fields.status')} value={config.status ?? ''} onChange={(e) => setConfig({ ...config, status: e.target.value })}>
          <option value="">{t('directory.current')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={busy || !config.columns.length} onClick={() => void run()}>
          {t('customReports.run')}
        </button>
      </div>
      {!config.columns.length && <p className="ppl-hint">{t('customReports.needColumns')}</p>}
      {result &&
        (result.rows.length === 0 ? (
          <EmptyState compact quiet body={t('customReports.noRows')} />
        ) : (
          <>
            <p className="ppl-hint" data-testid="people-report-total">
              {t('customReports.total', { count: result.total })}
            </p>
            <div className="table-wrap">
              <table className="table table-compact ppl-table" data-testid="people-report-table">
                <thead>
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c.key} scope="col">
                        {labelOf(c.key, c.label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ppl-toolbar ppl-report-save">
              <button type="button" className="btn btn-secondary" onClick={() => void download()}>
                {t('customReports.csv')}
              </button>
              <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t('customReports.namePlaceholder')} aria-label={t('customReports.namePlaceholder')} />
              <button type="button" className="btn btn-secondary" disabled={!name.trim()} onClick={() => void save()}>
                {t('customReports.save')}
              </button>
            </div>
          </>
        ))}
      <Dialog open={renaming !== null} title={t('customReports.rename')} onClose={() => setRenaming(null)}>
        <form onSubmit={rename}>
          <div className="ui-modal-body ui-fields">
            <Field label={t('customReports.namePlaceholder')} htmlFor="rpt-name">
              <input key={renaming?.id} id="rpt-name" name="name" className="input" required maxLength={80} defaultValue={renaming?.name ?? ''} autoFocus />
            </Field>
          </div>
          <div className="ui-modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setRenaming(null)}>
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
