'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { normHeader, parseCsv } from './csv';
import { notifyObjectsChanged } from './CrmObjectsBranch';

interface ObjectInfo {
  id: string;
  singular: string;
  plural: string;
  primaryLabel: string;
  description: string;
}

/** Nombre y descripción del objeto (solo admins). Guardar renombra en la lista y el sidebar sin recargar. */
export function ObjectDefinitionForm({ object }: { object: ObjectInfo }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [singular, setSingular] = useState(object.singular);
  const [plural, setPlural] = useState(object.plural);
  const [primaryLabel, setPrimaryLabel] = useState(object.primaryLabel);
  const [description, setDescription] = useState(object.description);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    singular !== object.singular ||
    plural !== object.plural ||
    primaryLabel !== object.primaryLabel ||
    description !== object.description;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!singular.trim() || !plural.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/crm/objects/${object.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        singular: singular.trim(),
        plural: plural.trim(),
        primaryLabel: primaryLabel.trim(),
        description: description.trim(),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setNote(t('objects.saved'));
      notifyObjectsChanged();
      router.refresh();
      return;
    }
    setError(t('errors.generic'));
  }

  return (
    <form className="crm-form obj-def-form" onSubmit={save}>
      <div className="ui-fields-2">
        <label className="ui-field">
          <span className="label">{t('objects.singular')}</span>
          <input className="input" value={singular} onChange={(e) => setSingular(e.target.value)} maxLength={80} required />
        </label>
        <label className="ui-field">
          <span className="label">{t('objects.plural')}</span>
          <input className="input" value={plural} onChange={(e) => setPlural(e.target.value)} maxLength={80} required />
        </label>
        <label className="ui-field">
          <span className="label">{t('objects.primaryLabel')}</span>
          <input
            className="input"
            value={primaryLabel}
            onChange={(e) => setPrimaryLabel(e.target.value)}
            placeholder={t('objects.defaultPrimary')}
            maxLength={80}
          />
        </label>
        <label className="ui-field">
          <span className="label">{t('objects.description')}</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || busy} aria-busy={busy || undefined}>
          {t('objects.save')}
        </button>
        {note && !dirty && (
          <span className="saved-note" role="status">
            {note}
          </span>
        )}
        {error && (
          <span className="ui-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

interface ImportProps {
  objectId: string;
  primaryLabel: string;
  properties: Array<{ name: string; label: string }>;
}

/** Import CSV de registros: elegir archivo, mapear columnas a propiedades y crear. */
export function ObjectImport({ objectId, primaryLabel, properties }: ImportProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const targets = useMemo(
    () => [
      { value: 'name', label: primaryLabel },
      { value: 'owner', label: t('objects.import.owner') },
      ...properties.map((p) => ({ value: `custom.${p.name}`, label: p.label })),
    ],
    [primaryLabel, properties, t],
  );

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2 || !parsed[0].length) {
      setRows(null);
      setError(t('objects.import.parseError'));
      return;
    }
    setRows(parsed);
    // Adivina por nombre: la columna que se llama como la propiedad.
    setMapping(
      parsed[0].map((h) => {
        const n = normHeader(h);
        if (n === normHeader(primaryLabel) || n === 'name' || n === 'nombre' || n === 'nome') return 'name';
        if (n === 'owner' || n === 'owner email' || n === 'dueno' || n === 'responsavel') return 'owner';
        const p = properties.find((x) => normHeader(x.label) === n || normHeader(x.name) === n);
        return p ? `custom.${p.name}` : '';
      }),
    );
  }

  const nameCol = mapping.indexOf('name');

  async function run() {
    if (!rows || nameCol < 0 || busy) return;
    setBusy(true);
    setError(null);
    const body = rows.slice(1).map((r) => {
      const custom: Record<string, string> = {};
      let ownerEmail = '';
      mapping.forEach((m, i) => {
        const v = (r[i] ?? '').trim();
        if (!v) return;
        if (m === 'owner') ownerEmail = v;
        else if (m.startsWith('custom.')) custom[m.slice(7)] = v;
      });
      return { name: (r[nameCol] ?? '').trim(), ownerEmail: ownerEmail || undefined, custom };
    });
    const res = await fetch(`/api/crm/objects/${objectId}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rows: body }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setResult((await res.json()) as { created: number; skipped: number; errors: string[] });
      setRows(null);
      router.refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  return (
    <div className="obj-import">
      <p className="ui-help">{t('objects.import.help')}</p>
      <label className="ui-field">
        <span className="label">{t('objects.import.file')}</span>
        <input className="input" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {rows && (
        <>
          <div className="table-wrap">
            <table className="table crm-table obj-import-map">
              <thead>
                <tr>
                  <th scope="col">{t('objects.import.column')}</th>
                  <th scope="col">{t('objects.import.mapTo')}</th>
                </tr>
              </thead>
              <tbody>
                {rows[0].map((h, i) => (
                  <tr key={`${h}-${i}`}>
                    <td className="mono">{h || '—'}</td>
                    <td>
                      <select
                        className="select"
                        aria-label={`${t('objects.import.mapTo')}: ${h}`}
                        value={mapping[i] ?? ''}
                        onChange={(e) => setMapping((prev) => prev.map((m, j) => (j === i ? e.target.value : m)))}
                      >
                        <option value="">{t('objects.import.skip')}</option>
                        {targets.map((o) => (
                          <option key={o.value} value={o.value} disabled={o.value !== (mapping[i] ?? '') && mapping.includes(o.value)}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nameCol < 0 && <p className="ui-help">{t('objects.import.needName')}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={nameCol < 0 || busy} aria-busy={busy || undefined}>
              {busy ? t('objects.import.running') : t('objects.import.run', { count: rows.length - 1 })}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className="obj-import-result">
          <p>{t('objects.import.result', { created: result.created, skipped: result.skipped })}</p>
          {result.errors.length > 0 && (
            <details>
              <summary>{t('objects.import.warnings')}</summary>
              <ul className="muted">
                {result.errors.slice(0, 50).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
