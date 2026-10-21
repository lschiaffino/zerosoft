'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { bulkResultsToCsv, checkBulkRows, parseBulkLines, type BulkResultItem } from '@/lib/link-bulk-csv';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import LinkIcon from './LinkIcon';

interface BulkCreateFormProps {
  /** Dominio por defecto (zerosoft). */
  domain: string;
  /** Dominios propios verificados del workspace. */
  customDomains?: Array<{ id: string; hostname: string }>;
  /** Carpetas en las que quien mira puede crear links. */
  folders?: Array<{ id: string; name: string }>;
}

/**
 * Pegar hasta 200 filas y acortarlas todas: cada fila es una URL y, si se
 * quiere, su slug y su título (`url, slug, título`). Dominio y carpeta para
 * todo el lote; tag y UTM comunes en "Avanzado".
 */
export default function BulkCreateForm({ domain, customDomains = [], folders = [] }: BulkCreateFormProps) {
  const t = useTranslations('link');
  const [urls, setUrls] = useState('');
  const [domainId, setDomainId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tag, setTag] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [results, setResults] = useState<BulkResultItem[] | null>(null);

  // Revisión fila por fila antes de crear (mismas reglas que el server).
  const checked = useMemo(() => checkBulkRows(parseBulkLines(urls), { customDomain: !!domainId }), [urls, domainId]);
  const count = checked.length;
  const bad = checked.filter((r) => r.problem).length;
  const errorText = (code?: string) => (code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));

  async function create(): Promise<string | void> {
    setResults(null);
    try {
      const res = await fetch('/api/links/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          urls,
          domainId: domainId || undefined,
          folderId: folderId || undefined,
          tag: tag.trim() || undefined,
          utmSource: utmSource.trim() || undefined,
          utmMedium: utmMedium.trim() || undefined,
          utmCampaign: utmCampaign.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { results?: BulkResultItem[]; error?: string } | null;
      if (!res.ok || !data?.results) {
        return data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic');
      }
      setResults(data.results);
    } catch {
      return t('errors.generic');
    }
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

  const created = results?.filter((r) => r.status === 'created').length ?? 0;

  return (
    <>
      <FormSection
        title={t('bulk.title')}
        description={t('bulk.sub')}
        onSubmit={create}
        submitLabel={count > 1 ? t('bulk.createN', { n: count }) : t('bulk.create')}
        note={t('bulk.count', { n: count })}
        className="lk-form"
      >
        <div className="ui-field">
          <label className="label" htmlFor="bulk-urls">
            {t('bulk.urlsLabel')}
          </label>
          <textarea
            id="bulk-urls"
            className="textarea mono"
            rows={10}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={t('bulk.urlsPlaceholder')}
            required
            spellCheck={false}
            aria-describedby="bulk-urls-help"
          />
          <p id="bulk-urls-help" className="ui-help">
            {t('bulk.rowsHelp')}
          </p>
        </div>

        {count > 0 && (
          <div className="ui-field" data-testid="bulk-preview">
            <span className="label">{t('bulk.previewTitle')}</span>
            <p className="ui-help" role="status">
              {t('bulk.previewSummary', { ok: count - bad, bad })}
            </p>
            <div className="table-wrap lk-bulk-preview">
              <table className="table table-compact">
                <caption className="sr-only">{t('bulk.previewTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('bulk.colUrl')}</th>
                    <th scope="col">{t('bulk.colSlug')}</th>
                    <th scope="col">{t('bulk.colTitle')}</th>
                    <th scope="col">{t('bulk.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {checked.map((r, i) => (
                    <tr key={i} data-problem={r.problem ?? undefined}>
                      <td className="data lk-cell-trunc">{r.url}</td>
                      <td className="data">{r.slug ?? <span className="ui-help">{t('bulk.slugAuto')}</span>}</td>
                      <td className="lk-cell-trunc">{r.title ?? ''}</td>
                      <td>
                        {r.problem ? (
                          <span className="lk-bulk-error">
                            <span className="badge badge-bad">{t('bulk.statusError')}</span>
                            <span className="ui-help">{errorText(r.problem)}</span>
                          </span>
                        ) : (
                          <span className="badge badge-ok">{t('bulk.rowOk')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(customDomains.length > 0 || folders.length > 0) && (
          <div className="ui-fields-2">
            {customDomains.length > 0 && (
              <div className="ui-field">
                <label className="label" htmlFor="bulk-domain">
                  {t('bulk.domainLabel')}
                </label>
                <select
                  id="bulk-domain"
                  className="select mono"
                  value={domainId}
                  onChange={(e) => setDomainId(e.target.value)}
                >
                  <option value="">{domain}</option>
                  {customDomains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.hostname}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {folders.length > 0 && (
              <div className="ui-field">
                <label className="label" htmlFor="bulk-folder">
                  {t('folders.field')}
                </label>
                <select id="bulk-folder" className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                  <option value="">{t('folders.noFolder')}</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <AdvancedSection storageKey="link.bulk" hint={t('bulk.advancedHint')}>
          <div className="ui-field">
            <label className="label" htmlFor="bulk-tag">
              {t('bulk.tagLabel')}
            </label>
            <input
              id="bulk-tag"
              className="input"
              type="text"
              maxLength={40}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder={t('bulk.tagPlaceholder')}
            />
          </div>
          <fieldset className="lk-fieldset">
            <legend className="label">{t('bulk.utmTitle')}</legend>
            <div className="lk-utm">
              {(
                [
                  ['bulk-utm-source', 'utmSource', utmSource, setUtmSource],
                  ['bulk-utm-medium', 'utmMedium', utmMedium, setUtmMedium],
                  ['bulk-utm-campaign', 'utmCampaign', utmCampaign, setUtmCampaign],
                ] as const
              ).map(([fid, key, value, set]) => (
                <div className="ui-field" key={fid}>
                  <label className="label" htmlFor={fid}>
                    {t(`new.${key}`)}
                  </label>
                  <input
                    id={fid}
                    className="input mono"
                    type="text"
                    maxLength={100}
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    placeholder={t(`new.${key}Placeholder`)}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        </AdvancedSection>
      </FormSection>

      {results && (
        <section className="panel lk-panel" aria-labelledby="bulk-results-title">
          <div className="lk-panel-head">
            <div>
              <h2 className="lk-h" id="bulk-results-title">
                {t('bulk.resultsTitle')}
              </h2>
              <p className="ui-help" role="status">
                {t('bulk.resultsSummary', { created, failed: results.length - created })}
              </p>
            </div>
            <button type="button" className="btn btn-sm" onClick={downloadCsv}>
              <LinkIcon name="download" size={14} />
              {t('bulk.downloadCsv')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table table-compact">
              <caption className="sr-only">{t('bulk.resultsTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('bulk.colUrl')}</th>
                  <th scope="col">{t('bulk.colTitle')}</th>
                  <th scope="col">{t('bulk.colShort')}</th>
                  <th scope="col">{t('bulk.colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td className="data lk-cell-trunc">{r.url}</td>
                    <td className="lk-cell-trunc">{r.title ?? ''}</td>
                    <td className="data">
                      {r.short_url ? (
                        <a href={r.short_url} target="_blank" rel="noopener noreferrer" className="cell-link">
                          {r.short_url.replace(/^https?:\/\//, '')}
                        </a>
                      ) : null}
                    </td>
                    <td>
                      {r.status === 'created' ? (
                        <span className="badge badge-ok">{t('bulk.statusCreated')}</span>
                      ) : (
                        <span className="lk-bulk-error">
                          <span className="badge badge-bad">{t('bulk.statusError')}</span>
                          <span className="ui-help">{errorText(r.error)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
