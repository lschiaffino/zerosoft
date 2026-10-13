'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import QuickModal from '@/components/app/QuickModal';

const KNOWN_ERRORS = new Set(['invalid_slug', 'slug_taken', 'missing_name', 'invalid_input']);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/**
 * "Nuevo proyecto" en un modal (nombre, slug, ícono, descripción) sin salir
 * del overview; al crear navega al proyecto. El form completo sigue en
 * /app/track/projects/new.
 */
export default function QuickProjectButton({
  className = 'btn btn-solid',
  testId = 'track-new-project',
  listenParam = false,
}: {
  className?: string;
  testId?: string;
  /** Abre el modal con ?newProject=1 (lo usa el menú ⌘K). */
  listenParam?: boolean;
}) {
  const t = useTranslations('track');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!listenParam || searchParams.get('newProject') !== '1') return;
    setOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('newProject');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [listenParam, searchParams, pathname, router]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState('◆');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/track/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        slug: effectiveSlug || slugify(name) || 'project',
        description: description.trim(),
        icon: icon.trim() || undefined,
        color: '#000000',
      }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { id?: string; error?: string } | null) : null;
    if (res?.ok && data?.id) {
      router.push(`/app/track/projects/${data.id}`);
      return;
    }
    setBusy(false);
    const code = data?.error ?? 'generic';
    setError(t(KNOWN_ERRORS.has(code) ? `errors.${code}` : 'errors.generic'));
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-testid={testId}>
        {t('projects.newCta')}
      </button>
      <QuickModal
        open={open}
        onClose={() => setOpen(false)}
        crumb={`Track › ${t('projects.newTitle')}`}
        onSubmit={submit}
        submitLabel={busy ? t('common.saving') : t('common.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!name.trim()}
        busy={busy}
        error={error}
      >
        <div className="qm-row">
          <input
            className="qm-title"
            style={{ maxWidth: 64, textAlign: 'center' }}
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            aria-label={t('projects.form.icon')}
            maxLength={8}
          />
          <input
            data-autofocus
            className="qm-title"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('projects.form.namePlaceholder')}
            aria-label={t('projects.form.name')}
            maxLength={200}
          />
        </div>
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('projects.form.slug')}</span>
            <input
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder={t('projects.form.slugPlaceholder')}
              maxLength={64}
            />
          </label>
        </div>
        <label className="qm-field">
          <span>{t('projects.form.description')}</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} />
        </label>
      </QuickModal>
    </>
  );
}
