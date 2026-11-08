'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PeriskopeKind, PeriskopeResult } from '@/lib/groups-periskope';
import { api, useErrorText } from './ui';

const KINDS: PeriskopeKind[] = ['chats', 'contacts', 'labels', 'quick_replies'];

/**
 * Ajustes › Migrar: traer de Periskope etiquetas, respuestas rápidas y, sobre
 * los chats que ya llegaron por las líneas conectadas, etiquetas, asignado,
 * propiedades y nombres. Primero una vista previa (no escribe), después
 * importar. Es parcial: las columnas de Periskope no están publicadas.
 */
export default function PeriskopeImport() {
  const t = useTranslations('groups');
  const errText = useErrorText();
  const [kind, setKind] = useState<PeriskopeKind>('labels');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PeriskopeResult | null>(null);

  async function run(preview: boolean) {
    setBusy(true);
    setError('');
    const res = await api<PeriskopeResult>('/api/groups/periskope', { body: { kind, csv, preview } });
    setBusy(false);
    if (!res.data) return setError(errText(res.error));
    setResult(res.data);
  }

  const issueText = (reason: string) => {
    const [base, detail] = reason.split(':');
    return t.has(`migrate.issues.${base}`) ? t(`migrate.issues.${base}`, { detail: detail ?? '' }) : reason;
  };

  return (
    <div className="ui-fields">
      <p className="ui-help">{t('migrate.intro')}</p>
      <ol className="gr-steps">
        <li>{t('migrate.step1')}</li>
        <li>{t('migrate.step2')}</li>
        <li>{t('migrate.step3')}</li>
      </ol>
      <label className="ui-field">
        <span className="label">{t('migrate.kind')}</span>
        <select
          className="select"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as PeriskopeKind);
            setResult(null);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`migrate.kinds.${k}`)}
            </option>
          ))}
        </select>
        <span className="ui-help">{t(`migrate.columns.${kind}`)}</span>
      </label>
      <label className="ui-field">
        <span className="label">{t('migrate.file')}</span>
        <input
          className="input"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setResult(null);
            if (!f) return;
            setError('');
            if (f.size > 4 * 1024 * 1024) return setError(t('migrate.tooBig'));
            setFileName(f.name);
            setCsv(await f.text());
          }}
        />
        {fileName && <span className="ui-help">{fileName}</span>}
      </label>
      <details>
        <summary>{t('migrate.paste')}</summary>
        <textarea className="input gr-mono" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label={t('migrate.paste')} />
      </details>
      <div className="gr-inline-form">
        <button type="button" className="btn btn-secondary" disabled={!csv.trim() || busy} onClick={() => void run(true)}>
          {t('migrate.preview')}
        </button>
        <button type="button" className="btn btn-primary" disabled={!csv.trim() || busy || !result?.dryRun || result.applied === 0} onClick={() => void run(false)} aria-busy={busy || undefined}>
          {t('migrate.import')}
        </button>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className={`gr-banner gr-import-result${result.applied ? ' is-ok' : ' is-warn'}`} role="status">
          <strong>
            {result.dryRun ? t('migrate.previewResult', { applied: result.applied, rows: result.rows }) : t('migrate.done', { applied: result.applied, rows: result.rows })}
          </strong>
          {(result.created.labels > 0 || result.created.quickReplies > 0) && (
            <span>{t('migrate.created', { labels: result.created.labels, replies: result.created.quickReplies })}</span>
          )}
          {result.ignoredColumns.length > 0 && <span>{t('migrate.ignored', { cols: result.ignoredColumns.join(', ') })}</span>}
          {result.issues.length > 0 && (
            <ul>
              {result.issues.slice(0, 20).map((i) => (
                <li key={`${i.line}-${i.reason}`}>{t('migrate.issueLine', { line: i.line, reason: issueText(i.reason) })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
