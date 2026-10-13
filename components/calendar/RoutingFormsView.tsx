'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

export interface RoutingFormListItem {
  id: string;
  title: string;
  slug: string;
  active: boolean;
}

interface RoutingFormsViewProps {
  items: RoutingFormListItem[];
  openNew?: boolean;
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Lista de routing forms + creación rápida (modal / tecla C). Al crear se
 * abre el editor para sumar preguntas y reglas.
 */
export default function RoutingFormsView({ items, openNew }: RoutingFormsViewProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [open, setOpen] = useState(!!openNew);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyShortcut('c', () => setOpen(true), !open);
  const effectiveSlug = slugTouched ? slug : slugify(title);

  function close() {
    setOpen(false);
    setError(null);
    if (openNew) router.replace('/app/calendar/routing');
  }

  async function submit() {
    if (!title.trim() || !effectiveSlug) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/routing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), slug: effectiveSlug, active: true }),
    }).catch(() => null);
    if (res && res.status === 201) {
      const data = (await res.json()) as { id: string };
      router.push(`/app/calendar/routing/${data.id}`);
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    setError(['invalid_slug', 'slug_taken', 'invalid_input'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    setBusy(false);
  }

  const openModal = () => setOpen(true);

  return (
    <>
      <div className="page-head">
        <h1 className="app-title">{t('routing.title')}</h1>
        <button type="button" className="btn btn-solid btn-small" onClick={openModal} title={t('list.shortcut')}>
          {t('routing.newCta')}
          <span className="kbd-hint" aria-hidden>
            C
          </span>
        </button>
      </div>

      {items.length === 0 ? (
        <div className="cal-empty">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0
          </p>
          <h2>{t('routing.emptyTitle')}</h2>
          <p className="muted">{t('routing.emptySub')}</p>
          <button type="button" className="btn btn-solid btn-small" onClick={openModal}>
            {t('routing.emptyCta')}
          </button>
        </div>
      ) : (
        <ul className="cal-list">
          {items.map((form) => (
            <li key={form.id} className={`cal-row${form.active ? '' : ' is-off'}`}>
              <Link href={`/app/calendar/routing/${form.id}`} className="cal-row-main">
                <span className="calendar-event-title">{form.title}</span>
                <span className="cal-row-meta mono">/r/{form.slug}</span>
              </Link>
              {!form.active && <span className="badge">{t('routing.inactive')}</span>}
            </li>
          ))}
        </ul>
      )}

      <QuickModal
        open={open}
        onClose={close}
        crumb={t('quick.routingCrumb')}
        onSubmit={submit}
        submitLabel={t('quick.routingCreate')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!title.trim() || !effectiveSlug}
        busy={busy}
        error={error}
        hint={t('quick.hint')}
      >
        <input
          className="qm-title"
          data-autofocus
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('quick.routingTitlePlaceholder')}
          aria-label={t('form.title')}
        />
        <label className="qm-field">
          <span>{t('quick.slug')}</span>
          <div className="qm-prefix">
            <span>/r/</span>
            <input
              className="mono"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
              }}
              placeholder="sales-or-support"
            />
          </div>
        </label>
      </QuickModal>
    </>
  );
}
