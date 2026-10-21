'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { LinkDto } from '@/lib/links';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import TagsInput from './TagsInput';
import { readUtm, syncUtm, UTM_FIELDS, type UtmField } from '@/lib/link-url';
import UtmFields, { type UtmDraft } from './UtmFields';
import FolderSelect from './FolderSelect';

const SLUG_RE = /^[A-Za-z0-9_-]{2,32}$/;

function utmDrafts(url: string): UtmDraft {
  const u = readUtm(url);
  const out = {} as UtmDraft;
  for (const f of UTM_FIELDS) out[f] = u[f] ?? '';
  return out;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * Ajustes de un link: lo que se toca seguido (destino, slug, título, tags)
 * arriba; UTM, redirect, vencimiento, límite, contraseña, params y vista
 * previa social en "Avanzado". Un solo Guardar. Los UTM viven en la URL: los
 * campos y el destino se editan en espejo.
 */
export default function EditLinkForm({
  link,
  folders = [],
}: {
  link: LinkDto;
  /** Carpetas editables por quien mira (el campo se muestra si hay alguna). */
  folders?: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('link');
  const router = useRouter();

  const [url, setUrl] = useState(link.url);
  const [utm, setUtm] = useState(() => utmDrafts(link.url));
  const [forwardParams, setForwardParams] = useState(link.forward_params);
  const [expiredUrl, setExpiredUrl] = useState(link.expired_url ?? '');
  const [slug, setSlug] = useState(link.slug);
  const [title, setTitle] = useState(link.title ?? '');
  const [tags, setTags] = useState<string[]>(link.tags);
  const [folderId, setFolderId] = useState(link.folder_id ?? '');
  const [expiresAt, setExpiresAt] = useState(link.expires_at ? toLocalInput(link.expires_at) : '');
  const [maxClicks, setMaxClicks] = useState(link.max_clicks?.toString() ?? '');
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [redirectType, setRedirectType] = useState<301 | 302>(link.redirect_type);
  const [ogTitle, setOgTitle] = useState(link.og.title ?? '');
  const [ogDescription, setOgDescription] = useState(link.og.description ?? '');
  const [ogImage, setOgImage] = useState(link.og.image ?? '');

  const slugInvalid = slug.trim() !== '' && !SLUG_RE.test(slug.trim());

  function changeUrl(value: string) {
    setUrl(value);
    setUtm(utmDrafts(value));
  }

  function changeUtm(field: UtmField, value: string) {
    setUtm((prev) => ({ ...prev, [field]: value }));
    setUrl((prev) => syncUtm(prev, { [field]: value }).url);
  }

  function applyUtm(draft: UtmDraft) {
    setUtm(draft);
    setUrl((prev) => syncUtm(prev, draft).url);
  }

  async function save(): Promise<string | void> {
    if (slugInvalid) return t('errors.invalid_slug');

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
      forwardParams,
      expiredUrl: expiredUrl.trim() || null,
    };
    if (slug.trim() && slug.trim() !== link.slug) payload.slug = slug.trim();
    if ((folderId || null) !== link.folder_id) payload.folderId = folderId || null;
    if (clearPassword) payload.password = '';
    else if (password) payload.password = password;

    try {
      const res = await fetch(`/api/links/${link.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        return data?.error && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('errors.generic');
      }
    } catch {
      return t('errors.generic');
    }
    setPassword('');
    setClearPassword(false);
    router.refresh();
  }

  return (
    <FormSection
      title={t('detail.settingsTitle')}
      titleHidden
      description={t('detail.settingsDesc')}
      onSubmit={save}
      submitLabel={t('detail.saveChanges')}
      className="lk-form"
    >
      <div className="ui-field">
        <label className="label" htmlFor="el-url">
          {t('detail.urlLabel')}
        </label>
        <input id="el-url" className="input" type="text" inputMode="url" required value={url} onChange={(e) => changeUrl(e.target.value)} />
      </div>

      <div className="ui-fields-2">
        <div className="ui-field">
          <label className="label" htmlFor="el-slug">
            {t('detail.slugLabel')}
          </label>
          <input
            id="el-slug"
            className="input mono"
            type="text"
            required
            value={slug}
            maxLength={32}
            onChange={(e) => setSlug(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={slugInvalid || undefined}
            aria-describedby="el-slug-help"
          />
          <p id="el-slug-help" className={slugInvalid ? 'ui-error' : 'ui-help'}>
            {slugInvalid ? t('new.slugInvalid') : t('detail.slugHelp')}
          </p>
        </div>
        <div className="ui-field">
          <label className="label" htmlFor="el-title">
            {t('detail.titleLabel')} <span className="ui-optional">{t('common.optional')}</span>
          </label>
          <input id="el-title" className="input" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>

      <div className="ui-field">
        <span className="label" id="el-tags-label">
          {t('detail.tagsLabel')} <span className="ui-optional">{t('common.optional')}</span>
        </span>
        <TagsInput tags={tags} onChange={setTags} labelledBy="el-tags-label" />
      </div>

      {folders.length > 0 && <FolderSelect id="el-folder" value={folderId} onChange={setFolderId} folders={folders} />}

      <AdvancedSection storageKey="link.edit" hint={t('detail.advancedHint')}>
        <fieldset className="lk-fieldset">
          <legend className="label">{t('new.utmTitle')}</legend>
          <p className="ui-help">{t('new.utmSyncHelp')}</p>
          <UtmFields idPrefix="el" value={utm} onChange={changeUtm} onApply={applyUtm} disabled={!url.trim()} />
        </fieldset>

        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="el-redirect">
              {t('detail.redirectTypeLabel')}
            </label>
            <select
              id="el-redirect"
              className="select"
              value={redirectType}
              onChange={(e) => setRedirectType(Number(e.target.value) as 301 | 302)}
            >
              <option value={302}>{t('detail.redirect302')}</option>
              <option value={301}>{t('detail.redirect301')}</option>
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="el-exp">
              {t('detail.expiresLabel')}
            </label>
            <input id="el-exp" className="input mono" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="el-max">
              {t('detail.maxClicksLabel')}
            </label>
            <input
              id="el-max"
              className="input mono lk-ph-ui"
              type="number"
              min={1}
              inputMode="numeric"
              value={maxClicks}
              onChange={(e) => setMaxClicks(e.target.value)}
              placeholder={t('new.maxClicksPlaceholder')}
            />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="el-pw">
              {t('detail.passwordLabel')}
            </label>
            <input
              id="el-pw"
              className="input"
              type="password"
              value={password}
              maxLength={100}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={link.has_password ? t('detail.passwordKeep') : ''}
              autoComplete="new-password"
              disabled={clearPassword}
            />
            {link.has_password && (
              <label className="ui-check">
                <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
                {t('detail.passwordClear')}
              </label>
            )}
          </div>
        </div>

        <div className="ui-field">
          <label className="label" htmlFor="el-expired-url">
            {t('new.expiredUrlLabel')}
          </label>
          <input
            id="el-expired-url"
            className="input mono"
            type="text"
            inputMode="url"
            maxLength={2000}
            value={expiredUrl}
            onChange={(e) => setExpiredUrl(e.target.value)}
            placeholder={t('new.expiredUrlPlaceholder')}
            aria-describedby="el-expired-url-help"
          />
          <p id="el-expired-url-help" className="ui-help">
            {t('new.expiredUrlHelp')}
          </p>
        </div>

        <div className="ui-field">
          <label className="ui-check">
            <input
              type="checkbox"
              checked={forwardParams}
              onChange={(e) => setForwardParams(e.target.checked)}
              aria-describedby="el-forward-help"
            />
            {t('new.forwardParamsLabel')}
          </label>
          <p id="el-forward-help" className="ui-help">
            {t('new.forwardParamsHelp')}
          </p>
        </div>

        <fieldset className="lk-fieldset">
          <legend className="label">{t('detail.ogTitle')}</legend>
          <p className="ui-help">{t('new.ogHelp')}</p>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="el-og-title">
                {t('detail.ogTitleLabel')}
              </label>
              <input
                id="el-og-title"
                className="input"
                type="text"
                maxLength={200}
                value={ogTitle}
                onChange={(e) => setOgTitle(e.target.value)}
                placeholder={t('detail.ogTitlePlaceholder')}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="el-og-img">
                {t('detail.ogImageLabel')}
              </label>
              <input
                id="el-og-img"
                className="input mono"
                type="text"
                inputMode="url"
                maxLength={500}
                value={ogImage}
                onChange={(e) => setOgImage(e.target.value)}
                placeholder={t('detail.ogImagePlaceholder')}
              />
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="el-og-desc">
              {t('detail.ogDescriptionLabel')}
            </label>
            <input
              id="el-og-desc"
              className="input"
              type="text"
              maxLength={500}
              value={ogDescription}
              onChange={(e) => setOgDescription(e.target.value)}
              placeholder={t('detail.ogDescriptionPlaceholder')}
            />
          </div>
        </fieldset>
      </AdvancedSection>
    </FormSection>
  );
}
