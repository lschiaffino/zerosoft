'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import TagsInput from './TagsInput';

const SLUG_RE = /^[A-Za-z0-9_-]{2,32}$/;

type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

function composeUrl(url: string, source: string, medium: string, campaign: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (source.trim()) u.searchParams.set('utm_source', source.trim());
    if (medium.trim()) u.searchParams.set('utm_medium', medium.trim());
    if (campaign.trim()) u.searchParams.set('utm_campaign', campaign.trim());
    return u.toString();
  } catch {
    return null;
  }
}

export default function NewLinkForm({ domain }: { domain: string }) {
  const t = useTranslations('link');
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [slugState, setSlugState] = useState<SlugState>('idle');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [utmSource, setUtmSource] = useState('');
  const [utmMedium, setUtmMedium] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [redirectType, setRedirectType] = useState<301 | 302>(302);
  const [advanced, setAdvanced] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [maxClicks, setMaxClicks] = useState('');
  const [password, setPassword] = useState('');
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Debounced slug availability check.
  useEffect(() => {
    const value = slug.trim();
    if (!value) {
      setSlugState('idle');
      return;
    }
    if (!SLUG_RE.test(value)) {
      setSlugState('invalid');
      return;
    }
    setSlugState('checking');
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/links/check-slug?slug=${encodeURIComponent(value)}`);
        const data = (await res.json()) as { available: boolean; valid: boolean };
        setSlugState(data.valid && data.available ? 'available' : 'taken');
      } catch {
        setSlugState('idle');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [slug]);

  const finalUrl = useMemo(
    () => composeUrl(url, utmSource, utmMedium, utmCampaign),
    [url, utmSource, utmMedium, utmCampaign],
  );

  const slugHint: Record<SlugState, string | null> = {
    idle: null,
    checking: t('new.slugChecking'),
    available: t('new.slugAvailable'),
    taken: t('new.slugTaken'),
    invalid: t('new.slugInvalid'),
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!finalUrl) {
      setError(t('errors.invalid_url'));
      return;
    }
    if (slug.trim() && !SLUG_RE.test(slug.trim())) {
      setError(t('errors.invalid_slug'));
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { url: url.trim(), tags, redirectType };
      if (slug.trim()) payload.slug = slug.trim();
      if (title.trim()) payload.title = title.trim();
      if (utmSource.trim()) payload.utmSource = utmSource.trim();
      if (utmMedium.trim()) payload.utmMedium = utmMedium.trim();
      if (utmCampaign.trim()) payload.utmCampaign = utmCampaign.trim();
      if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
      if (maxClicks) payload.maxClicks = Number(maxClicks);
      if (password) payload.password = password;
      if (ogTitle.trim()) payload.ogTitle = ogTitle.trim();
      if (ogDescription.trim()) payload.ogDescription = ogDescription.trim();
      if (ogImage.trim()) payload.ogImage = ogImage.trim();

      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        const link = (await res.json()) as { id: string };
        router.push(`/app/links/${link.id}`);
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const code = data?.error;
      setError(code ? t(`errors.${code}`) : t('errors.generic'));
      setSubmitting(false);
    } catch {
      setError(t('errors.generic'));
      setSubmitting(false);
    }
  }

  return (
    <form className="link-form" onSubmit={onSubmit}>
      <div className="field">
        <label className="label" htmlFor="nl-url">{t('new.urlLabel')}</label>
        <input
          id="nl-url"
          className="input"
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('new.urlPlaceholder')}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="nl-slug">{t('new.slugLabel')}</label>
        <div className="slug-row">
          <span className="slug-domain mono">{domain}/</span>
          <input
            id="nl-slug"
            className="input mono"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('new.slugPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {slugHint[slugState] && (
          <p className={`field-hint slug-${slugState}`}>{slugHint[slugState]}</p>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="nl-title">{t('new.titleLabel')}</label>
        <input
          id="nl-title"
          className="input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('new.titlePlaceholder')}
        />
      </div>

      <div className="field">
        <label className="label">{t('new.tagsLabel')}</label>
        <TagsInput tags={tags} onChange={setTags} />
      </div>

      <div className="field">
        <span className="label">{t('new.utmTitle')}</span>
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
        {finalUrl && (
          <p className="field-hint utm-preview">
            <span className="muted">{t('new.utmPreview')}:</span> {finalUrl}
          </p>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor="nl-redirect">
          {t('new.redirectTypeLabel')}
        </label>
        <select
          id="nl-redirect"
          className="input mono"
          value={redirectType}
          onChange={(e) => setRedirectType(Number(e.target.value) as 301 | 302)}
        >
          <option value={302}>{t('new.redirect302')}</option>
          <option value={301}>{t('new.redirect301')}</option>
        </select>
      </div>

      <button
        type="button"
        className="advanced-toggle mono"
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
      >
        {advanced ? '−' : '+'} {t('new.advanced')}
      </button>

      {advanced && (
        <div className="advanced-grid">
          <div className="field">
            <label className="label" htmlFor="nl-exp">{t('new.expiresLabel')}</label>
            <input
              id="nl-exp"
              className="input mono"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="nl-max">{t('new.maxClicksLabel')}</label>
            <input
              id="nl-max"
              className="input mono"
              type="number"
              min={1}
              value={maxClicks}
              onChange={(e) => setMaxClicks(e.target.value)}
              placeholder="∞"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="nl-pw">{t('new.passwordLabel')}</label>
            <input
              id="nl-pw"
              className="input mono"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>
      )}

      <button
        type="button"
        className="advanced-toggle mono"
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
      >
        {advanced ? '−' : '+'} {t('new.ogTitle')}
      </button>

      {advanced && (
        <div className="advanced-grid">
          <div className="field">
            <label className="label" htmlFor="nl-og-title">
              {t('new.ogTitleLabel')}
            </label>
            <input
              id="nl-og-title"
              className="input"
              type="text"
              value={ogTitle}
              onChange={(e) => setOgTitle(e.target.value)}
              placeholder={t('new.ogTitlePlaceholder')}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="nl-og-desc">
              {t('new.ogDescriptionLabel')}
            </label>
            <input
              id="nl-og-desc"
              className="input"
              type="text"
              value={ogDescription}
              onChange={(e) => setOgDescription(e.target.value)}
              placeholder={t('new.ogDescriptionPlaceholder')}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="nl-og-img">
              {t('new.ogImageLabel')}
            </label>
            <input
              id="nl-og-img"
              className="input mono"
              type="text"
              value={ogImage}
              onChange={(e) => setOgImage(e.target.value)}
              placeholder={t('new.ogImagePlaceholder')}
            />
          </div>
        </div>
      )}

      {error && <p className="form-error mono">{error}</p>}

      <button
        type="submit"
        className="btn btn-solid"
        disabled={submitting || slugState === 'taken' || slugState === 'invalid'}
      >
        {submitting ? t('new.creating') : t('new.create')}
      </button>
    </form>
  );
}
