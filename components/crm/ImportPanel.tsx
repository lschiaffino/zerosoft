'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { ImportResult } from '@/lib/crm';
import {
  IMPORT_FIELDS as FIELDS,
  guessMapping,
  parseCsv,
  type ImportEntity as Entity,
} from './csv';

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
    setMapping(guessMapping(hdrs, entity));
  }

  function mappedRows(): Array<Record<string, string>> {
    return rows
      .map((r) => {
        const obj: Record<string, string> = {};
        mapping.forEach((m, i) => {
          const v = (r[i] ?? '').trim();
          if (m && v) obj[m] = v;
        });
        return obj;
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
  }

  const parsed = headers.length > 0 && rows.length > 0;
  const preview = rows.slice(0, 5);

  return (
    <div className="imp">
      {/* Stepper */}
      <p className="imp-steps mono">
        <span className={step === 1 ? 'imp-step active' : 'imp-step'}>{t('importP.stepUpload')}</span>
        <span className="imp-step-sep">·</span>
        <span className={step === 2 ? 'imp-step active' : 'imp-step'}>{t('importP.stepMap')}</span>
        <span className="imp-step-sep">·</span>
        <span className={step === 3 ? 'imp-step active' : 'imp-step'}>{t('importP.stepResult')}</span>
      </p>

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
              }}
            >
              <option value="contacts">{t('settings.entities.contacts')}</option>
              <option value="companies">{t('settings.entities.companies')}</option>
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
                  {FIELDS[entity].map((f) => (
                    <option key={f} value={f}>
                      {t(`importP.fields.${f}`)}
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
                {t('importP.errors')} ({result.errors.length})
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
