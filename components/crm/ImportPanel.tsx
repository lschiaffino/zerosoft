'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ImportResult } from '@/lib/crm';
import {
  CSV_PRESETS,
  CUSTOM_PREFIX,
  finalizeRow,
  guessMapping,
  importTargets,
  mappingToObject,
  parseCsv,
  presetColumnsMapping,
  presetMapping,
  type CsvPreset,
  type ImportEntity as Entity,
  type MappableCustomField,
} from './csv';

interface SavedPreset {
  id: string;
  name: string;
  mapping: Record<string, string>;
}

/** Preset de mapeo elegido: auto-detect, el export de otro CRM o uno guardado (id). */
type PresetChoice = 'auto' | CsvPreset | string;

/** Import en 3 pasos: pegar/elegir CSV → mapear columnas → resultado. */
export default function ImportPanel() {
  const t = useTranslations('crm');
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entity, setEntity] = useState<Entity>('contacts');
  const [raw, setRaw] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<MappableCustomField[]>([]);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [preset, setPreset] = useState<PresetChoice>('auto');
  const [presetName, setPresetName] = useState('');
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

  // Custom fields y presets guardados de la entidad elegida.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/crm/custom-fields?entity=${entity}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: Array<{ name: string; label: string }> }) => {
        if (!cancelled) setCustomFields(d.rows.map((f) => ({ name: f.name, label: f.label })));
      })
      .catch(() => null);
    fetch(`/api/crm/import/presets?entity=${entity}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d: { rows: SavedPreset[] }) => {
        if (!cancelled) setPresets(d.rows);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [entity]);

  function mappingFor(choice: PresetChoice, hdrs: string[]): string[] {
    if ((CSV_PRESETS as readonly string[]).includes(choice)) {
      return presetColumnsMapping(choice as CsvPreset, hdrs, entity, customFields);
    }
    const saved = presets.find((p) => p.id === choice);
    if (saved) return presetMapping(hdrs, saved.mapping, importTargets(entity, customFields));
    return guessMapping(hdrs, entity, customFields);
  }

  function onPreset(choice: PresetChoice) {
    setPreset(choice);
    setPresetNotice(null);
    setMapping(mappingFor(choice, headers));
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    setPresetNotice(null);
    const res = await fetch('/api/crm/import/presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, name, mapping: mappingToObject(headers, mapping) }),
    }).catch(() => null);
    if (!res || res.status !== 201) {
      setPresetNotice(t('errors.generic'));
      return;
    }
    const created = (await res.json()) as SavedPreset;
    setPresets((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setPreset(created.id);
    setPresetName('');
    setPresetNotice(t('importP.presetSaved'));
  }

  async function deletePreset(id: string) {
    const res = await fetch(`/api/crm/import/presets/${id}`, { method: 'DELETE' }).catch(() => null);
    if (!res || !res.ok) {
      setPresetNotice(t('errors.generic'));
      return;
    }
    setPresets((prev) => prev.filter((p) => p.id !== id));
    setPreset('auto');
    setPresetNotice(null);
  }

  function fieldLabel(f: string): string {
    if (f.startsWith(CUSTOM_PREFIX)) {
      const name = f.slice(CUSTOM_PREFIX.length);
      const cf = customFields.find((c) => c.name === name);
      return t('importP.customField', { label: cf?.label ?? name });
    }
    return t(`importP.fields.${f}`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result ?? ''));
    reader.readAsText(file);
  }

  function onParse() {
    setError(null);
    const parsed = parseCsv(raw);
    if (parsed.length < 2 || parsed[0].length === 0) {
      setError(t('importP.parseError'));
      return;
    }
    const hdrs = parsed[0].map((h) => h.trim());
    const dataRows = parsed.slice(1);
    setHeaders(hdrs);
    setRows(dataRows);
    setMapping(mappingFor(preset, hdrs));
  }

  function mappedRows(): Array<Record<string, string>> {
    return rows
      .map((r) => {
        const obj: Record<string, string> = {};
        mapping.forEach((m, i) => {
          const v = (r[i] ?? '').trim();
          if (m && v) obj[m] = v;
        });
        return finalizeRow(obj);
      })
      .filter((obj) => Object.keys(obj).length > 0);
  }

  async function onRun() {
    const payload = mappedRows();
    if (payload.length === 0) {
      setError(t('errors.invalid_input'));
      return;
    }
    setError(null);
    setBusy(true);
    const res = await fetch('/api/crm/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity, mode, rows: payload }),
    }).catch(() => null);
    if (res && res.status === 200) {
      setResult((await res.json()) as ImportResult);
      setStep(3);
      router.refresh();
    } else {
      const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      setError(
        data?.error && t.has(`errors.${data.error}`)
          ? t(`errors.${data.error}`)
          : t('errors.import_failed'),
      );
    }
    setBusy(false);
  }

  function reset() {
    setStep(1);
    setRaw('');
    setHeaders([]);
    setRows([]);
    setMapping([]);
    setResult(null);
    setError(null);
    setPreset('auto');
    setPresetNotice(null);
  }

  const parsed = headers.length > 0 && rows.length > 0;
  const preview = rows.slice(0, 5);

  return (
    <div className="imp">
      {/* Stepper */}
      {/* Pasos numerados, como el asistente de workflows. */}
      <ol className="wf-steps imp-steps" aria-label={t('importP.stepsLabel')}>
        {[t('importP.stepUpload'), t('importP.stepMap'), t('importP.stepResult')].map((label, i) => (
          <li key={label} className="wf-steps-item" data-state={i + 1 < step ? 'done' : i + 1 === step ? 'current' : 'next'}>
            <span className="wf-steps-btn" aria-current={i + 1 === step ? 'step' : undefined}>
              <span className="wf-steps-n" aria-hidden="true">{i + 1}</span>
              <span>{label}</span>
            </span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="imp-body">
          <div className="imp-entity">
            <span className="label">{t('settings.fieldEntity')}</span>
            <select
              className="filter-select"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as Entity);
                setHeaders([]);
                setRows([]);
                setPreset('auto');
              }}
            >
              <option value="contacts">{t('settings.entities.contacts')}</option>
              <option value="companies">{t('settings.entities.companies')}</option>
              <option value="deals">{t('settings.entities.deals')}</option>
            </select>
          </div>

          <p className="muted">{t('importP.pasteHint')}</p>
          <textarea
            className="input imp-textarea mono"
            rows={8}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'email,first_name,last_name\nada@zero.ai,Ada,Lovelace'}
            spellCheck={false}
          />
          <label className="btn btn-small imp-file">
            {t('importP.dropHint')}
            <input type="file" accept=".csv,text/csv" className="imp-file-input" onChange={onFile} />
          </label>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={onParse}
              disabled={!raw.trim()}
            >
              {t('importP.parse')}
            </button>
            {parsed && (
              <button type="button" className="btn btn-solid btn-small" onClick={() => setStep(2)}>
                {t('importP.next')}
              </button>
            )}
          </div>

          {parsed && (
            <div className="imp-preview">
              <p className="label">{t('importP.preview', { count: preview.length })}</p>
              <div className="table-wrap">
                <table className="table imp-table">
                  <thead>
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, ri) => (
                      <tr key={ri}>
                        {headers.map((_, ci) => (
                          <td key={ci}>{r[ci] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="imp-body">
          <div className="imp-presets">
            <label className="imp-preset-pick">
              <span className="label">{t('importP.preset')}</span>
              <select
                className="filter-select"
                value={preset}
                onChange={(e) => onPreset(e.target.value)}
                aria-label={t('importP.preset')}
              >
                <option value="auto">{t('importP.presetAuto')}</option>
                {CSV_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {t(`importP.presets.${p}`)}
                  </option>
                ))}
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {presets.some((p) => p.id === preset) && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => deletePreset(preset)}>
                {t('importP.presetDelete')}
              </button>
            )}
            <span className="imp-preset-save">
              <input
                className="input"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t('importP.presetNamePlaceholder')}
                aria-label={t('importP.presetName')}
                maxLength={100}
              />
              <button
                type="button"
                className="btn btn-small"
                onClick={savePreset}
                disabled={!presetName.trim() || !mapping.some(Boolean)}
              >
                {t('importP.presetSave')}
              </button>
            </span>
            {presetNotice && (
              <span className="muted imp-preset-notice" role="status">
                {presetNotice}
              </span>
            )}
          </div>
          <p className="muted">{t(`importP.hint.${entity}`)}</p>

          <p className="label">{t('importP.mapTo')}</p>
          <div className="imp-map">
            {headers.map((h, i) => (
              <div className="imp-map-row" key={i}>
                <span className="mono imp-map-head" title={h}>
                  {h}
                </span>
                <span className="muted imp-map-sample" title={rows[0]?.[i] ?? ''}>
                  {rows[0]?.[i] ?? ''}
                </span>
                <select
                  className="filter-select"
                  value={mapping[i] ?? ''}
                  onChange={(e) =>
                    setMapping((prev) => prev.map((m, mi) => (mi === i ? e.target.value : m)))
                  }
                >
                  <option value="">{t('importP.ignore')}</option>
                  {importTargets(entity, customFields).map((f) => (
                    <option key={f} value={f}>
                      {fieldLabel(f)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="imp-mode">
            <span className="label">{t('importP.mode')}</span>
            <label className="imp-radio">
              <input
                type="radio"
                name="imp-mode"
                checked={mode === 'skip'}
                onChange={() => setMode('skip')}
              />{' '}
              {t('importP.modeSkip')}
            </label>
            <label className="imp-radio">
              <input
                type="radio"
                name="imp-mode"
                checked={mode === 'update'}
                onChange={() => setMode('update')}
              />{' '}
              {t('importP.modeUpdate')}
            </label>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn btn-small" onClick={() => setStep(1)} disabled={busy}>
              {t('common.back')}
            </button>
            <button
              type="button"
              className="btn btn-solid btn-small"
              onClick={onRun}
              disabled={busy}
            >
              {busy ? t('importP.running') : t('importP.run', { count: rows.length })}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="imp-body">
          <p className="imp-done">{t('importP.done')}</p>
          <div className="stat-cards imp-result-cards">
            <div className="panel stat-card">
              <span className="stat-num">{result.created}</span>
              <span className="stat-label">{t('importP.created')}</span>
            </div>
            <div className="panel stat-card">
              <span className="stat-num">{result.updated}</span>
              <span className="stat-label">{t('importP.updated')}</span>
            </div>
            <div className="panel stat-card">
              <span className="stat-num">{result.skipped}</span>
              <span className="stat-label">{t('importP.skipped')}</span>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="imp-errors">
              <p className="label">
                {t('importP.errorsAndWarnings')} ({result.errors.length})
              </p>
              <ul className="imp-error-list">
                {result.errors.slice(0, 20).map((err, i) => (
                  <li key={i} className="mono">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="btn btn-small" onClick={reset}>
              {t('importP.again')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
