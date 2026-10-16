'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import { composeUtmUrl, useSlugCheck } from './slug-check';

export interface CreatedLink {
  id: string;
  short_url: string;
}

interface QuickLinkModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (link: CreatedLink) => void;
  domain: string;
  customDomains?: Array<{ id: string; hostname: string }>;
  initialUrl?: string;
}

/**
 * Crear un link sin salir de la lista: el mismo camino básico que "Nuevo"
 * (URL y slug opcional). Lo demás está a un click en "Más opciones", que abre
 * el formulario completo con la URL precargada.
 */
export default function QuickLinkModal(props: QuickLinkModalProps) {
  if (!props.open) return null;
  return <QuickLinkModalBody {...props} />;
}

function QuickLinkModalBody({ onClose, onCreated, domain, customDomains = [], initialUrl = '' }: QuickLinkModalProps) {
  const t = useTranslations('link');
  const [url, setUrl] = useState(initialUrl);
  const [slug, setSlug] = useState('');
  const [domainId, setDomainId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slugState = useSlugCheck(slug, domainId);

  const slugHint: Record<typeof slugState, string | null> = {
    idle: null,
    checking: t('new.slugChecking'),
    available: t('new.slugAvailable'),
    taken: t('new.slugTaken'),
    invalid: t('new.slugInvalid'),
    reserved: t('new.slugReserved'),
  };

  async function submit() {
    setError(null);
    if (!url.trim()) return;
    if (!composeUtmUrl(url, '', '', '')) {
      setError(t('errors.invalid_url'));
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { url: url.trim() };
      if (slug.trim()) payload.slug = slug.trim();
      if (domainId) payload.domainId = domainId;
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        const link = (await res.json()) as CreatedLink;
        onCreated(link);
        onClose();
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      const code = data?.error;
      setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
    } catch {
      setError(t('errors.generic'));
    }
    setBusy(false);
  }

  const slugBad = slugState === 'taken' || slugState === 'invalid' || slugState === 'reserved';
  const fullFormHref = url.trim() ? `/app/links/new?url=${encodeURIComponent(url.trim())}` : '/app/links/new';

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={t('new.title')}
      showCrumb={false}
      onSubmit={submit}
      submitLabel={busy ? t('new.creating') : t('new.create')}
      cancelLabel={t('quick.cancel')}
      submitDisabled={!url.trim() || slugBad}
      busy={busy}
      error={error}
      hint={t('quick.hint')}
      footExtra={
        <Link href={fullFormHref} className="qm-link">
          {t('quick.more')}
        </Link>
      }
    >
      <input
        className="qm-title"
        type="text"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t('quick.urlPlaceholder')}
        aria-label={t('new.urlLabel')}
        autoComplete="off"
        spellCheck={false}
        data-autofocus
      />
      <label className="qm-field">
        <span>{t('quick.slug')}</span>
        <div className="qm-prefix">
          {customDomains.length > 0 ? (
            <select
              className="qm-domain mono"
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
            <span>{domain}/</span>
          )}
          <input
            className="mono"
            type="text"
            value={slug}
            maxLength={32}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('new.slugPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <span
          className={slugBad ? 'ui-error' : slugState === 'available' ? 'ui-help lk-ok' : 'ui-help'}
          aria-live="polite"
        >
          {slugHint[slugState] ?? t('new.slugHelp')}
        </span>
      </label>
    </QuickModal>
  );
}
