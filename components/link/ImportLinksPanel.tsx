'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Report {
  imported: number;
  kept: number;
  renamed: Array<{ from: string; to: string }>;
  skipped: Array<{ from: string; reason: string }>;
  truncated: boolean;
}

/** Importar desde Bitly (token de API o CSV exportado). El token no se guarda. */
export default function ImportLinksPanel() {
  const t = useTranslations('link');
  const [mode, setMode] = useState<'token' | 'csv'>('token');
  const [token, setToken] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setReport(null);
    let res: Response | null;
    if (mode === 'token') {
      res = await fetch('/api/links/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'bitly', token: token.trim() }),
      }).catch(() => null);
    } else {
      const form = new FormData();
      if (file) form.set('file', file);
      res = await fetch('/api/links/import', { method: 'POST', body: form }).catch(() => null);
    }
    setBusy(false);
    if (res?.ok) {
      setReport((await res.json()) as Report);
      setToken('');
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
    setError(code && t.has(`import.errors.${code}`) ? t(`import.errors.${code}`) : t('errors.generic'));
  }

  return (
    <div className="apikeys">
      <p className="muted apikeys-desc">{t('import.desc')}</p>
      <div className="calendar-embed-tabs" role="tablist">
        {(['token', 'csv'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`btn btn-small ${mode === m ? 'btn-solid' : 'btn-ghost'}`}
            onClick={() => setMode(m)}
          >
            {t(`import.${m}`)}
          </button>
        ))}
      </div>
      <form className="apikeys-create" onSubmit={run}>
        {mode === 'token' ? (
          <input
            className="input mono"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('import.tokenPlaceholder')}
            aria-label={t('import.token')}
            autoComplete="off"
          />
        ) : (
          <input
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-label={t('import.csv')}
          />
        )}
        <button
          type="submit"
          className="btn btn-solid btn-small"
          disabled={busy || (mode === 'token' ? !token.trim() : !file)}
        >
          {busy ? t('import.running') : t('import.run')}
        </button>
      </form>
      <p className="muted mono">{mode === 'token' ? t('import.tokenHelp') : t('import.csvHelp')}</p>
      {error && <p className="form-error">{error}</p>}
      {report && (
        <div className="key-reveal">
          <p className="label">
            {t('import.done', { imported: report.imported, kept: report.kept })}
            {report.truncated && ` ${t('import.truncated')}`}
          </p>
          {report.renamed.length > 0 && (
            <details>
              <summary className="mono">{t('import.renamed', { n: report.renamed.length })}</summary>
              <ul className="mono muted">
                {report.renamed.slice(0, 200).map((r) => (
                  <li key={r.from}>
                    {r.from} → {r.to}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {report.skipped.length > 0 && (
            <details>
              <summary className="mono">{t('import.skipped', { n: report.skipped.length })}</summary>
              <ul className="mono muted">
                {report.skipped.slice(0, 200).map((r) => (
                  <li key={r.from}>
                    {r.from} — {t.has(`errors.${r.reason}`) ? t(`errors.${r.reason}`) : t('errors.generic')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
