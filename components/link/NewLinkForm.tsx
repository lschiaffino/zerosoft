'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';
import AdvancedSection from '@/components/ui/AdvancedSection';
import TagsInput from './TagsInput';
import { composeUtmUrl, SLUG_RE, useSlugCheck } from './slug-check';
import UtmFields, { EMPTY_UTM, type UtmDraft } from './UtmFields';
import { UTM_FIELDS } from '@/lib/link-url';
import FolderSelect from './FolderSelect';

const UTM_PAYLOAD = {
  source: 'utmSource',
  medium: 'utmMedium',
  campaign: 'utmCampaign',
  term: 'utmTerm',
  content: 'utmContent',
} as const;

interface NewLinkFormProps {
  /** Dominio por defecto (zerosoft). */
  domain: string;
  /** Dominios propios verificados del workspace. */
  customDomains?: Array<{ id: string; hostname: string }>;
  /** URL precargada (p. ej. desde "Más opciones" del modal rápido). */
  initialUrl?: string;
  /** Carpetas en las que quien mira puede crear links. */
  folders?: Array<{ id: string; name: string }>;
  /** Carpeta elegida de entrada (?folder= desde la tabla). */
  initialFolder?: string;
}

/**
 * Crear un link: el camino básico es la URL y, si querés, el slug (si no, se
 * genera solo). Título, tags, UTM, redirect, vencimiento, contraseña y vista
 * previa social viven en "Avanzado".
 */
export default function NewLinkForm({
  domain,
  customDomains = [],
  initialUrl = '',
  folders = [],
  initialFolder = '',
}: NewLinkFormProps) {
  const t = useTranslations('link');
  const router = useRouter();

  const [url, setUrl] = useState(initialUrl);
  const [slug, setSlug] = useState('');
  const [domainId, setDomainId] = useState<string>('');
  const [folderId, setFolderId] = useState(folders.some((f) => f.id === initialFolder) ? initialFolder : '');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [utm, setUtm] = useState<UtmDraft>(EMPTY_UTM);
  const [redirectType, setRedirectType] = useState<301 | 302>(302);
  const [expiresAt, setExpiresAt] = useState('');
  const [maxClicks, setMaxClicks] = useState('');
  const [password, setPassword] = useState('');
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [expiredUrl, setExpiredUrl] = useState('');
  const [forwardParams, setForwardParams] = useState(true);
  const [trackConversion, setTrackConversion] = useState(false);
  const slugState = useSlugCheck(slug, domainId);

  // Con ?url= el foco va al slug (la URL ya está); si no, a la URL.
  useEffect(() => {
    document.getElementById(initialUrl ? 'nl-slug' : 'nl-url')?.focus();
  }, [initialUrl]);

  const finalUrl = useMemo(() => composeUtmUrl(url, utm), [url, utm]);
  const hasUtm = UTM_FIELDS.some((f) => utm[f].trim());

  const slugBad = slugState === 'taken' || slugState === 'invalid' || slugState === 'reserved';
  const slugMessage: Record<typeof slugState, string> = {
    idle: t('new.slugHelp'),
    checking: t('new.slugChecking'),
    available: t('new.slugAvailable'),
    taken: t('new.slugTaken'),
    invalid: t('new.slugInvalid'),
    reserved: t('new.slugReserved'),
  };

  async function create(): Promise<string | void> {
    if (!finalUrl) return t('errors.invalid_url');
    if (slug.trim() && !SLUG_RE.test(slug.trim())) return t('errors.invalid_slug');

    const payload: Record<string, unknown> = { url: url.trim(), tags, redirectType };
    if (slug.trim()) payload.slug = slug.trim();
    if (domainId) payload.domainId = domainId;
    if (folderId) payload.folderId = folderId;
    if (title.trim()) payload.title = title.trim();
    for (const f of UTM_FIELDS) if (utm[f].trim()) payload[UTM_PAYLOAD[f]] = utm[f].trim();
    if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
    if (maxClicks) payload.maxClicks = Number(maxClicks);
    if (password) payload.password = password;
    if (ogTitle.trim()) payload.ogTitle = ogTitle.trim();
    if (ogDescription.trim()) payload.ogDescription = ogDescription.trim();
    if (ogImage.trim()) payload.ogImage = ogImage.trim();
    if (expiredUrl.trim()) payload.expiredUrl = expiredUrl.trim();
    if (!forwardParams) payload.forwardParams = false;
    if (trackConversion) payload.trackConversion = true;

    try {
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
      return code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
    } catch {
      return t('errors.generic');
    }
  }

  return (
    <FormSection
      title={t('new.formTitle')}
      description={t('new.formDesc')}
      onSubmit={create}
      submitLabel={t('new.create')}
      disabled={slugBad}
      note={t('new.formNote')}
      className="lk-form"
    >
      <div className="ui-field">
        <label className="label" htmlFor="nl-url">
          {t('new.urlLabel')}
        </label>
        <input
          id="nl-url"
          className="input"
          type="text"
          inputMode="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('new.urlPlaceholder')}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="ui-field">
        <label className="label" htmlFor="nl-slug">
          {t('new.slugLabel')} <span className="ui-optional">{t('common.optional')}</span>
        </label>
        <div className="ui-input-group">
          {customDomains.length > 0 ? (
            <select
              className="select mono lk-domain-select"
              value={domainId}
              onChange={(e) => setDomainId(e.target.value)}
              aria-label={t('domains.pick')}
            >
              <option value="">{domain}/</option>
              {customDomains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.hostname}/
                </option>
              ))}
            </select>
          ) : (
            <span className="ui-addon">{domain}/</span>
          )}
          <input
            id="nl-slug"
            className="input mono"
            type="text"
            value={slug}
            maxLength={32}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('new.slugPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={slugBad || undefined}
            aria-describedby="nl-slug-help"
          />
        </div>
        <p id="nl-slug-help" className={slugBad ? 'ui-error' : slugState === 'available' ? 'ui-help lk-ok' : 'ui-help'} aria-live="polite">
          {slugMessage[slugState]}
        </p>
      </div>

      {folders.length > 0 && <FolderSelect id="nl-folder" value={folderId} onChange={setFolderId} folders={folders} />}

      <AdvancedSection storageKey="link.new" hint={t('new.advancedHint')}>
        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="nl-title">
              {t('new.titleLabel')}
            </label>
            <input
              id="nl-title"
              className="input"
              type="text"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('new.titlePlaceholder')}
            />
          </div>
          <div className="ui-field">
            <span className="label" id="nl-tags-label">
              {t('new.tagsLabel')}
            </span>
            <TagsInput tags={tags} onChange={setTags} labelledBy="nl-tags-label" />
          </div>
        </div>

        <fieldset className="lk-fieldset">
          <legend className="label">{t('new.utmTitle')}</legend>
          <UtmFields
            idPrefix="nl"
            value={utm}
            onChange={(field, value) => setUtm((prev) => ({ ...prev, [field]: value }))}
            onApply={setUtm}
          />
          {hasUtm && finalUrl && (
            <p className="ui-help lk-utm-preview">
              {t('new.utmPreview')}: <span className="data">{finalUrl}</span>
            </p>
          )}
        </fieldset>

        <div className="ui-fields-2">
          <div className="ui-field">
            <label className="label" htmlFor="nl-redirect">
              {t('new.redirectTypeLabel')}
            </label>
            <select
              id="nl-redirect"
              className="select"
              value={redirectType}
              onChange={(e) => setRedirectType(Number(e.target.value) as 301 | 302)}
            >
              <option value={302}>{t('new.redirect302')}</option>
              <option value={301}>{t('new.redirect301')}</option>
            </select>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="nl-exp">
              {t('new.expiresLabel')}
            </label>
            <input id="nl-exp" className="input mono" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="nl-max">
              {t('new.maxClicksLabel')}
            </label>
            <input
              id="nl-max"
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
            <label className="label" htmlFor="nl-pw">
              {t('new.passwordLabel')}
            </label>
            <input
              id="nl-pw"
              className="input"
              type="password"
              value={password}
              maxLength={100}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        <div className="ui-field">
          <label className="label" htmlFor="nl-expired-url">
            {t('new.expiredUrlLabel')}
          </label>
          <input
            id="nl-expired-url"
            className="input mono"
            type="text"
            inputMode="url"
            maxLength={2000}
            value={expiredUrl}
            onChange={(e) => setExpiredUrl(e.target.value)}
            placeholder={t('new.expiredUrlPlaceholder')}
            aria-describedby="nl-expired-url-help"
          />
          <p id="nl-expired-url-help" className="ui-help">
            {t('new.expiredUrlHelp')}
          </p>
        </div>

        <div className="ui-field">
          <label className="ui-check">
            <input
              type="checkbox"
              checked={forwardParams}
              onChange={(e) => setForwardParams(e.target.checked)}
              aria-describedby="nl-forward-help"
            />
            {t('new.forwardParamsLabel')}
          </label>
          <p id="nl-forward-help" className="ui-help">
            {t('new.forwardParamsHelp')}
          </p>
        </div>

        <div className="ui-field">
          <label className="ui-check">
            <input
              type="checkbox"
              checked={trackConversion}
              onChange={(e) => setTrackConversion(e.target.checked)}
              aria-describedby="nl-conv-help"
              data-testid="nl-track-conversion"
            />
            {t('conversions.toggle')}
          </label>
          <p id="nl-conv-help" className="ui-help">
            {t('conversions.toggleHelp')}
          </p>
        </div>

        <fieldset className="lk-fieldset">
          <legend className="label">{t('new.ogTitle')}</legend>
          <p className="ui-help">{t('new.ogHelp')}</p>
          <div className="ui-fields-2">
            <div className="ui-field">
              <label className="label" htmlFor="nl-og-title">
                {t('new.ogTitleLabel')}
              </label>
              <input
                id="nl-og-title"
                className="input"
                type="text"
                value={ogTitle}
                maxLength={200}
                onChange={(e) => setOgTitle(e.target.value)}
                placeholder={t('new.ogTitlePlaceholder')}
              />
            </div>
            <div className="ui-field">
              <label className="label" htmlFor="nl-og-img">
                {t('new.ogImageLabel')}
              </label>
              <input
                id="nl-og-img"
                className="input mono"
                type="text"
                inputMode="url"
                value={ogImage}
                maxLength={500}
                onChange={(e) => setOgImage(e.target.value)}
                placeholder={t('new.ogImagePlaceholder')}
              />
            </div>
          </div>
          <div className="ui-field">
            <label className="label" htmlFor="nl-og-desc">
              {t('new.ogDescriptionLabel')}
            </label>
            <input
              id="nl-og-desc"
              className="input"
              type="text"
              value={ogDescription}
              maxLength={500}
              onChange={(e) => setOgDescription(e.target.value)}
              placeholder={t('new.ogDescriptionPlaceholder')}
            />
          </div>
        </fieldset>
      </AdvancedSection>
    </FormSection>
  );
}
