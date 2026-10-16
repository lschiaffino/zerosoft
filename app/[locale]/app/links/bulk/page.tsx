'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { bulkResultsToCsv, type BulkResultItem } from '@/lib/link-bulk-csv';

export default function BulkPage() {
  const t = useTranslations('link');
  const [urls, setUrls] = useState('');
  const [tag, setTag] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResults(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/links/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          urls,
          tag: tag.trim() || undefined,
          utmSource: utmSource.trim() || undefined,
          utmMedium: utmMedium.trim() || undefined,
          utmCampaign: utmCampaign.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { results?: BulkResultItem[]; error?: string }
        | undefined;
      if (!res.ok || !data?.results) {
        setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
      } else {
        setResults(data.results);
      }
    } catch {
      setError(t('errors.generic'));
    }
    setSubmitting(false);
  }

  // El CSV sale de los resultados en pantalla: volver a pedirlo al server
  // crearía todos los links otra vez.
  function downloadCsv() {
    if (!results) return;
    const blob = new Blob([bulkResultsToCsv(results)], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'links.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  return (
    <div className="app-page narrow">
      <Link href="/app/links" className="mono back-link">
        {t('detail.back')}
      </Link>
      <h1 className="app-title">{t('bulk.title')}</h1>
      <p className="app-sub muted">{t('bulk.sub')}</p>

      <form className="link-form" onSubmit={onSubmit}>
        <div className="field">
          <label className="label" htmlFor="bulk-urls">
            {t('bulk.urlsLabel')}
          </label>
          <textarea
            id="bulk-urls"
            className="input mono"
            rows={10}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={t('bulk.urlsPlaceholder')}
            required
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="bulk-tag">
            {t('bulk.tagLabel')}
          </label>
          <input
            id="bulk-tag"
            className="input"
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={t('bulk.tagPlaceholder')}
          />
        </div>

        <div className="field">
          <span className="label">{t('bulk.utmTitle')}</span>
          <div className="utm-grid">
            <input
              className="input mono"
              type="text"
              value={utmSource}
              onChange={(e) => setUtmSource(e.target.value)}
              placeholder={t('new.utmSource')}
              aria-label={t('new.utmSource')}
            />
            <input
              className="input mono"
              type="text"
              value={utmMedium}
              onChange={(e) => setUtmMedium(e.target.value)}
              placeholder={t('new.utmMedium')}
              aria-label={t('new.utmMedium')}
            />
            <input
              className="input mono"
              type="text"
              value={utmCampaign}
              onChange={(e) => setUtmCampaign(e.target.value)}
              placeholder={t('new.utmCampaign')}
              aria-label={t('new.utmCampaign')}
            />
          </div>
        </div>

        {error && <p className="form-error mono">{error}</p>}

        <button type="submit" className="btn btn-solid" disabled={submitting}>
          {submitting ? t('bulk.creating') : t('bulk.create')}
        </button>
      </form>

      {results && (
        <section className="panel">
          <div className="panel-head">
            <p className="section-label">{t('bulk.resultsTitle')}</p>
            <button type="button" className="btn btn-small" onClick={downloadCsv}>
              {t('bulk.downloadCsv')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="links-table bulk-table">
              <thead>
                <tr>
                  <th>{t('bulk.colUrl')}</th>
                  <th>{t('bulk.colShort')}</th>
                  <th>{t('bulk.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="cell-url mono">{r.url}</td>
                    <td className="cell-slug mono">
                      {r.short_url ? (
                        <a href={r.short_url} target="_blank" rel="noopener noreferrer">
                          {r.short_url}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {r.status === 'created' ? (
                        <span className="badge status-active">{t('bulk.statusCreated')}</span>
                      ) : (
                        <>
                          <span className="badge status-expired">{t('bulk.statusError')}</span>{' '}
                          <span className="muted">
                            {r.error && t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t('errors.generic')}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
