'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';

interface Report {
  imported: number;
  kept: number;
  renamed: Array<{ from: string; to: string }>;
  skipped: Array<{ from: string; reason: string }>;
  truncated: boolean;
}

const SOURCES = ['bitly', 'rebrandly', 'shortio'] as const;
type Source = (typeof SOURCES)[number];

/** Importar desde Bitly, Rebrandly o Short.io (token de API) o un CSV. El token no se guarda. */
export default function ImportLinksPanel() {
  const t = useTranslations('link');
  const [source, setSource] = useState<Source>('bitly');
  const [mode, setMode] = useState<'token' | 'csv'>('token');
  const [token, setToken] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function run(): Promise<string | void> {
    setReport(null);
    let res: Response | null;
    if (mode === 'token') {
      res = await fetch('/api/links/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, token: token.trim() }),
      }).catch(() => null);
    } else {
      const form = new FormData();
      if (file) form.set('file', file);
      res = await fetch('/api/links/import', { method: 'POST', body: form }).catch(() => null);
    }
    if (res?.ok) {
      setReport((await res.json()) as Report);
      setToken('');
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    return code && t.has(`import.errors.${code}`) ? t(`import.errors.${code}`) : t('errors.generic');
  }

  return (
    <>
      <FormSection
        title={t(`import.titles.${source}`)}
        description={t('import.desc')}
        onSubmit={run}
        submitLabel={t('import.run')}
        disabled={mode === 'token' ? !token.trim() : !file}
        className="lk-form"
      >
        <div className="ui-field">
          <label className="label" htmlFor="import-source">
            {t('import.source')}
          </label>
          <select
            id="import-source"
            className="select lk-select-auto"
            value={source}
            onChange={(e) => {
              setSource(e.target.value as Source);
              setToken('');
              setReport(null);
            }}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`import.sources.${s}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="ui-field">
          <span className="label" id="import-mode-label">
            {t('import.from')}
          </span>
          <div className="btn-group" role="group" aria-labelledby="import-mode-label">
            {(['token', 'csv'] as const).map((m) => (
              <button key={m} type="button" className="btn btn-sm" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`import.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {mode === 'token' ? (
          <div className="ui-field">
            <label className="label" htmlFor="import-token">
              {t(`import.tokens.${source}`)}
            </label>
            <input
              id="import-token"
              className="input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t(`import.tokens.${source}`)}
              autoComplete="off"
              aria-describedby="import-help"
            />
            <p id="import-help" className="ui-help">
              {t(`import.tokenHelps.${source}`)}
            </p>
          </div>
        ) : (
          <div className="ui-field">
            <label className="label" htmlFor="import-file">
              {t('import.csv')}
            </label>
            <input
              id="import-file"
              className="input lk-file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby="import-help"
            />
            <p id="import-help" className="ui-help">
              {t('import.csvHelp')}
            </p>
          </div>
        )}
      </FormSection>

      {report && (
        <section className="panel lk-panel" aria-labelledby="import-report-title">
          <h2 className="lk-h" id="import-report-title">
            {t('import.reportTitle')}
          </h2>
          <p role="status">
            {t('import.done', { imported: report.imported, kept: report.kept })}
            {report.truncated && ` ${t('import.truncated')}`}
          </p>
          {report.renamed.length > 0 && (
            <details className="lk-details">
              <summary>{t('import.renamed', { n: report.renamed.length })}</summary>
              <ul className="lk-report-list data">
                {report.renamed.slice(0, 200).map((r) => (
                  <li key={r.from}>{t('import.renamedRow', { from: r.from, to: r.to })}</li>
                ))}
              </ul>
            </details>
          )}
          {report.skipped.length > 0 && (
            <details className="lk-details">
              <summary>{t('import.skipped', { n: report.skipped.length })}</summary>
              <ul className="lk-report-list">
                {report.skipped.slice(0, 200).map((r) => (
                  <li key={r.from}>
                    <span className="data">{r.from}</span>{' '}
                    <span className="ui-help">{t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : t('errors.generic')}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p>
            <Link href="/app/links" className="lk-more">
              {t('import.seeLinks')}
            </Link>
          </p>
        </section>
      )}
    </>
  );
}
