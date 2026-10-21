'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDate } from '@/lib/utils';
import CopyButton from './CopyButton';
import LinkIcon from './LinkIcon';

export interface ShareView {
  id: string;
  url: string;
  created_at: string;
}

interface SharePanelProps {
  /** Qué se comparte: un link o todos los links de un tag. */
  target: { linkId: string } | { tag: string };
  initial: ShareView[];
}

/**
 * Páginas públicas de solo lectura con las analytics de un link o un tag:
 * crear una (link largo y aleatorio), copiarla y revocarla.
 */
export default function SharePanel({ target, initial }: SharePanelProps) {
  const t = useTranslations('link');
  const locale = useLocale();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorText = (code: string | undefined) =>
    code && t.has(`share.errors.${code}`) ? t(`share.errors.${code}`) : t('errors.generic');

  async function create() {
    setBusy('new');
    setError(null);
    const res = await fetch('/api/links/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(target),
    }).catch(() => null);
    setBusy(null);
    if (res?.status === 201) {
      const row = (await res.json()) as ShareView;
      setRows((prev) => [row, ...prev]);
      return;
    }
    setError(errorText(res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined));
  }

  async function revoke(id: string) {
    if (!window.confirm(t('share.revokeConfirm'))) return;
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/links/shares/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.status === 204) {
      setRows((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    setError(errorText(res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined));
  }

  return (
    <section className="lk-block" aria-labelledby="lk-share-title" data-testid="link-share-panel">
      <div className="lk-panel-head">
        <div>
          <h2 className="lk-h" id="lk-share-title">
            {'tag' in target ? t('share.titleTag', { tag: target.tag }) : t('share.title')}
          </h2>
          <p className="ui-help">{t('share.desc')}</p>
        </div>
        <button type="button" className="btn btn-sm" onClick={() => void create()} disabled={busy === 'new'} aria-busy={busy === 'new' || undefined}>
          <LinkIcon name="share" size={14} />
          {t('share.create')}
        </button>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="lk-empty-line">{t('share.empty')}</p>
      ) : (
        <ul className="lk-share-list">
          {rows.map((r) => (
            <li key={r.id} className="lk-share-row">
              <span className="data lk-cell-trunc" title={r.url}>
                {r.url.replace(/^https?:\/\//, '')}
              </span>
              <span className="ui-help">{t('share.createdOn', { date: formatDate(r.created_at, locale) })}</span>
              <span className="lk-share-actions">
                <CopyButton text={r.url} className="btn btn-sm btn-ghost" />
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-ghost">
                  {t('share.open')}
                </a>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => void revoke(r.id)}
                  disabled={busy === r.id}
                >
                  {t('share.revoke')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
