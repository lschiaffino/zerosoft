'use client';

/**
 * Vínculos externos del issue: hilo de Slack sincronizado, issue de Sentry,
 * issue de GitHub (sync), ticket de Zendesk o conversación de Intercom, y los
 * diseños de Figma (vinculados o pegados en la descripción y comentarios) con
 * su vista previa embebida. Se puede vincular un link nuevo y quitar uno.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { ExternalRefView } from '@/lib/track-integrations';

interface LinksData {
  refs: ExternalRefView[];
  figma: Array<{ url: string; embedUrl: string }>;
}

const PROVIDER_LABEL: Record<string, string> = {
  slack_thread: 'Slack',
  sentry: 'Sentry',
  github_issue: 'GitHub',
  zendesk: 'Zendesk',
  intercom: 'Intercom',
};

export function IssueLinksPanel({ issueId, refreshKey = 0 }: { issueId: string; refreshKey?: number }) {
  const t = useTranslations('track');
  const [data, setData] = useState<LinksData | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/track/issues/${issueId}/links`).catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData((await res.json()) as LinksData);
  }, [issueId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/track/issues/${issueId}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t('issueLinks.unsupported'));
      return;
    }
    setData((await res.json()) as LinksData);
    setUrl('');
    setAdding(false);
  };

  const remove = async (refId: string) => {
    const res = await fetch(`/api/track/issues/${issueId}/links?refId=${encodeURIComponent(refId)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setData((await res.json()) as LinksData);
  };

  if (failed) return null;
  const empty = !data || (data.refs.length === 0 && data.figma.length === 0);

  return (
    <section className="track-detail-section" data-testid="track-issue-links">
      <div className="track-links-head">
        <h2 className="track-section-title">{t('issueLinks.title')}</h2>
        {!adding ? (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)} data-testid="track-issue-link-add">
            {t('issueLinks.add')}
          </button>
        ) : null}
      </div>
      {adding ? (
        <form className="track-int-row" onSubmit={(e) => void submit(e)}>
          <label className="sr-only" htmlFor={`issue-link-${issueId}`}>
            {t('issueLinks.urlLabel')}
          </label>
          <input
            id={`issue-link-${issueId}`}
            className="input track-links-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false);
                setError(null);
              }
            }}
            placeholder={t('issueLinks.placeholder')}
            autoFocus
            required
            data-testid="track-issue-link-url"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            {t('issueLinks.save')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
            {t('issueLinks.cancel')}
          </button>
        </form>
      ) : null}
      {error ? (
        <p className="ui-error" role="alert">
          {error}
        </p>
      ) : null}
      {empty && !adding ? <p className="ui-help">{t('issueLinks.empty')}</p> : null}
      {data && data.refs.length > 0 ? (
        <ul className="track-gh-list track-link-list">
          {data.refs.map((r) => (
            <li key={r.id} className="track-link-item" data-testid="track-issue-link">
              <span className="track-gh-kind">{PROVIDER_LABEL[r.provider] ?? r.provider}</span>
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="track-gh-title">
                  {r.title || r.url}
                </a>
              ) : (
                <span className="track-gh-title">{r.title || r.externalId}</span>
              )}
              {r.state ? <span className="badge">{t.has(`issueLinks.states.${r.state}`) ? t(`issueLinks.states.${r.state}`) : r.state}</span> : null}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove(r.id)} aria-label={t('issueLinks.remove', { name: PROVIDER_LABEL[r.provider] ?? r.provider })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {data && data.figma.length > 0 ? (
        <ul className="track-figma-list">
          {data.figma.map((f) => (
            <li key={f.url} className="track-figma-item" data-testid="track-figma-embed">
              <div className="track-int-row">
                <span className="track-gh-kind">Figma</span>
                <a href={f.url} target="_blank" rel="noreferrer" className="track-gh-title">
                  {f.url.replace(/^https:\/\/(www\.)?figma\.com\//, '')}
                </a>
                <button type="button" className="btn btn-sm" onClick={() => setPreview(preview === f.url ? null : f.url)} aria-expanded={preview === f.url}>
                  {preview === f.url ? t('issueLinks.hidePreview') : t('issueLinks.showPreview')}
                </button>
              </div>
              {preview === f.url ? (
                <iframe
                  className="track-figma-frame"
                  src={f.embedUrl}
                  title={t('issueLinks.figmaTitle')}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer"
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
