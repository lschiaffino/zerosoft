'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { LinkDto } from '@/lib/links';
import TagsInput from './TagsInput';

const SLUG_RE = /^[A-Za-z0-9_-]{2,32}$/;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

interface EditLinkFormProps {
  link: LinkDto;
  /** Después de guardar OK (el panel lateral se cierra). */
  onSaved?: () => void;
}

export default function EditLinkForm({ link, onSaved }: EditLinkFormProps) {
  const t = useTranslations('link');
  const router = useRouter();

  const [url, setUrl] = useState(link.url);
  const [slug, setSlug] = useState(link.slug);
  const [title, setTitle] = useState(link.title ?? '');
  const [tags, setTags] = useState<string[]>(link.tags);
  const [expiresAt, setExpiresAt] = useState(link.expires_at ? toLocalInput(link.expires_at) : '');
  const [maxClicks, setMaxClicks] = useState(link.max_clicks?.toString() ?? '');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [redirectType, setRedirectType] = useState<301 | 302>(link.redirect_type);
  const [ogTitle, setOgTitle] = useState(link.og.title ?? '');
  const [ogDescription, setOgDescription] = useState(link.og.description ?? '');
  const [ogImage, setOgImage] = useState(link.og.image ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    if (slug.trim() && !SLUG_RE.test(slug.trim())) {
      setError(t('errors.invalid_slug'));
      return;
    }

    const payload: Record<string, unknown> = {
      url: url.trim(),
      title: title.trim() || null,
      tags,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      maxClicks: maxClicks ? Number(maxClicks) : null,
      redirectType,
      ogTitle: ogTitle.trim() || null,
      ogDescription: ogDescription.trim() || null,
      ogImage: ogImage.trim() || null,
    };
    if (slug.trim() && slug.trim() !== link.slug) payload.slug = slug.trim();
    if (clearPassword) payload.password = '';
    else if (password) payload.password = password;

    setSaving(true);
    try {
      const res = await fetch(`/api/links/${link.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic'));
      } else {
        setSaved(true);
        setPassword('');
        setClearPassword(false);
        router.refresh();
        setTimeout(() => setSaved(false), 2000);
        onSaved?.();
      }
    } catch {
      setError(t('errors.generic'));
    }
    setSaving(false);
  }

  return (
    <form className="link-form" onSubmit={onSubmit}>
      <div className="field">
        <label className="label" htmlFor="el-url">{t('detail.urlLabel')}</label>
        <input
          id="el-url"
          className="input"
          type="text"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="el-slug">{t('detail.slugLabel')}</label>
        <input
          id="el-slug"
          className="input mono"
          type="text"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="el-title">{t('detail.titleLabel')}</label>
        <input
          id="el-title"
          className="input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label">{t('detail.tagsLabel')}</label>
        <TagsInput tags={tags} onChange={setTags} />
      </div>

      <div className="field">
        <label className="label" htmlFor="el-redirect">
          {t('detail.redirectTypeLabel')}
        </label>
        <select
          id="el-redirect"
          className="input mono"
          value={redirectType}
          onChange={(e) => setRedirectType(Number(e.target.value) as 301 | 302)}
        >
          <option value={302}>{t('detail.redirect302')}</option>
          <option value={301}>{t('detail.redirect301')}</option>
        </select>
      </div>

      <div className="edit-grid">
        <div className="field">
          <label className="label" htmlFor="el-exp">{t('detail.expiresLabel')}</label>
          <input
            id="el-exp"
            className="input mono"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="el-max">{t('detail.maxClicksLabel')}</label>
          <input
            id="el-max"
            className="input mono"
            type="number"
            min={1}
            value={maxClicks}
            onChange={(e) => setMaxClicks(e.target.value)}
            placeholder="∞"
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="el-pw">{t('detail.passwordLabel')}</label>
        <input
          id="el-pw"
          className="input mono"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={link.has_password ? t('detail.passwordKeep') : ''}
          autoComplete="new-password"
          disabled={clearPassword}
        />
        {link.has_password && (
          <label className="check-row mono">
            <input
              type="checkbox"
              checked={clearPassword}
              onChange={(e) => setClearPassword(e.target.checked)}
            />
            {t('detail.passwordClear')}
          </label>
        )}
      </div>

      <div className="field">
        <span className="label">{t('detail.ogTitle')}</span>
        <div className="og-grid">
          <div className="field">
            <label className="label" htmlFor="el-og-title">
              {t('detail.ogTitleLabel')}
            </label>
            <input
              id="el-og-title"
              className="input"
              type="text"
              value={ogTitle}
              onChange={(e) => setOgTitle(e.target.value)}
              placeholder={t('detail.ogTitlePlaceholder')}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="el-og-desc">
              {t('detail.ogDescriptionLabel')}
            </label>
            <input
              id="el-og-desc"
              className="input"
              type="text"
              value={ogDescription}
              onChange={(e) => setOgDescription(e.target.value)}
              placeholder={t('detail.ogDescriptionPlaceholder')}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="el-og-img">
              {t('detail.ogImageLabel')}
            </label>
            <input
              id="el-og-img"
              className="input mono"
              type="text"
              value={ogImage}
              onChange={(e) => setOgImage(e.target.value)}
              placeholder={t('detail.ogImagePlaceholder')}
            />
          </div>
        </div>
      </div>

      {error && <p className="form-error mono">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-solid btn-small" disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </button>
        {saved && <span className="saved-note mono">{t('common.saved')}</span>}
      </div>
    </form>
  );
}
