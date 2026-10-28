'use client';

import { useEffect, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

interface PublishSettings {
  allow_duplicate: boolean;
  seo_description: string | null;
  seo_noindex: boolean;
}

/**
 * Ajustes de una página publicada (en Compartir › Publicar): duplicar como
 * plantilla, indexación y descripción para buscadores. El dominio y la
 * analítica del sitio van en Ajustes › Docs › Sitio.
 */
export default function DocsPublishSettings({ pageId }: { pageId: string }) {
  const t = useTranslations('docs.publish');
  const uid = useId();
  const [s, setS] = useState<PublishSettings | null>(null);
  const [desc, setDesc] = useState('');
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/docs/pages/${encodeURIComponent(pageId)}/site`)
      .then((r) => (r.ok ? (r.json() as Promise<PublishSettings>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        setS(d);
        setDesc(d.seo_description ?? '');
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [pageId]);

  async function patch(p: Partial<PublishSettings>) {
    setError(false);
    setSaved(false);
    const prev = s;
    if (s) setS({ ...s, ...p });
    const res = await fetch(`/api/docs/pages/${encodeURIComponent(pageId)}/site`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    }).catch(() => null);
    if (!res?.ok) {
      setS(prev);
      setError(true);
      return;
    }
    setS((await res.json()) as PublishSettings);
    setSaved(true);
  }

  if (error && !s) return <p className="ui-error">{t('error')}</p>;
  if (!s) return <p className="ui-help">{t('loading')}</p>;
  return (
    <div className="docs-publish-settings" data-testid="docs-publish-settings">
      <label className="ui-switch docs-switch-row">
        <input type="checkbox" role="switch" checked={s.allow_duplicate} onChange={(e) => void patch({ allow_duplicate: e.target.checked })} data-testid="docs-allow-duplicate" />
        <span className="docs-switch-text">
          <span className="docs-switch-label">{t('allowDuplicate')}</span>
          <span className="ui-help">{t('allowDuplicateHelp')}</span>
        </span>
      </label>
      <label className="ui-switch docs-switch-row">
        <input type="checkbox" role="switch" checked={!s.seo_noindex} onChange={(e) => void patch({ seo_noindex: !e.target.checked })} />
        <span className="docs-switch-text">
          <span className="docs-switch-label">{t('indexing')}</span>
          <span className="ui-help">{t('indexingHelp')}</span>
        </span>
      </label>
      <div className="ui-field">
        <label className="label" htmlFor={`${uid}-desc`}>
          {t('description')}
        </label>
        <textarea
          id={`${uid}-desc`}
          className="input"
          rows={2}
          maxLength={300}
          value={desc}
          placeholder={t('descriptionPlaceholder')}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => {
            if ((s.seo_description ?? '') !== desc.trim()) void patch({ seo_description: desc.trim() || null });
          }}
        />
        <span className="ui-help">{t('descriptionHelp')}</span>
      </div>
      {error && (
        <p className="ui-error" role="alert">
          {t('error')}
        </p>
      )}
      {saved && !error && (
        <p className="ui-help" role="status">
          {t('saved')}
        </p>
      )}
      <Link href="/app/docs/settings?tab=site" className="docs-inline-link">
        {t('siteSettings')}
      </Link>
    </div>
  );
}
