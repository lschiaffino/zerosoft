'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';
import TagsInput from './TagsInput';

const SLUG_RE = /^[A-Za-z0-9_-]{2,32}$/;

type SlugState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved';

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
 * Crear un link sin salir de la lista (como Bitly/Dub): URL, slug opcional,
 * título y tags. El resto (UTM, vencimiento, contraseña, OG) queda en el
 * formulario completo, a un click desde "More options".
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
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [slugState, setSlugState] = useState<SlugState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
        const res = await fetch(
          `/api/links/check-slug?slug=${encodeURIComponent(value)}${domainId ? `&domainId=${encodeURIComponent(domainId)}` : ''}`,
        );
        const data = (await res.json()) as { available: boolean; valid: boolean };
        // El formato ya se validó acá: si el server dice inválido es una palabra reservada.
        setSlugState(!data.valid ? 'reserved' : data.available ? 'available' : 'taken');
      } catch {
        setSlugState('idle');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [slug, domainId]);

  const slugHint: Record<SlugState, string | null> = {
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
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { url: url.trim(), tags };
      if (slug.trim()) payload.slug = slug.trim();
      if (domainId) payload.domainId = domainId;
      if (title.trim()) payload.title = title.trim();
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

  const fullFormHref = url.trim() ? `/app/links/new?url=${encodeURIComponent(url.trim())}` : '/app/links/new';

  return (
    <QuickModal
      open
      onClose={onClose}
      crumb={`Link › ${t('new.title')}`}
      onSubmit={submit}
      submitLabel={busy ? t('new.creating') : t('new.create')}
      cancelLabel={t('quick.cancel')}
      submitDisabled={!url.trim() || slugState === 'taken' || slugState === 'invalid' || slugState === 'reserved'}
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
      <div className="qm-row">
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
          {slugHint[slugState] && (
            <em className={`qm-slug-hint slug-${slugState}`}>{slugHint[slugState]}</em>
          )}
        </label>
        <label className="qm-field">
          <span>{t('quick.title')}</span>
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('new.titlePlaceholder')}
          />
        </label>
      </div>
      <div className="qm-field">
        <span>{t('quick.tags')}</span>
        <TagsInput tags={tags} onChange={setTags} />
      </div>
    </QuickModal>
  );
}
