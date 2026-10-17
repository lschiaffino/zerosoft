'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import CalIcon from './cal-icons';
import { slugify } from './cal-utils';

export interface RoutingFormListItem {
  id: string;
  title: string;
  slug: string;
  active: boolean;
  questions: number;
  rules: number;
}

interface RoutingFormsViewProps {
  items: RoutingFormListItem[];
  handle: string;
  openNew?: boolean;
}

/**
 * Lista de routing forms + alta rápida (modal / tecla C): solo el nombre, la
 * URL sale de ahí. Al crear se abre el editor en el paso Preguntas.
 */
export default function RoutingFormsView({ items, handle, openNew }: RoutingFormsViewProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [open, setOpen] = useState(!!openNew);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyShortcut('c', () => setOpen(true), !open);
  const slug = slugify(title);

  function close() {
    setOpen(false);
    setError(null);
    if (openNew) router.replace('/app/calendar/routing');
  }

  async function submit() {
    if (!title.trim() || !slug) return;
    setBusy(true);
    setError(null);
    // Si la URL ya existe, se prueba con un sufijo corto en vez de pedirla.
    for (const candidate of [slug, `${slug}-${Math.random().toString(36).slice(2, 6)}`]) {
      const res = await fetch('/api/calendar/routing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), slug: candidate, active: true }),
      }).catch(() => null);
      if (res && res.status === 201) {
        const data = (await res.json()) as { id: string };
        router.push(`/app/calendar/routing/${data.id}`);
        return;
      }
      const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : undefined;
      if (code === 'slug_taken') continue;
      setError(code && ['invalid_slug', 'invalid_input'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
      setBusy(false);
      return;
    }
    setError(t('errors.slug_taken'));
    setBusy(false);
  }

  return (
    <div className="ui-page">
      <PageHeader
        title={t('routing.title')}
        description={t('routing.lead')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} title={t('list.shortcut')}>
            {t('routing.newCta')}
            <span className="kbd" aria-hidden="true">
              C
            </span>
          </button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={t('routing.emptyTitle')}
          body={t('routing.emptySub')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              {t('routing.emptyCta')}
            </button>
          }
        />
      ) : (
        <ul className="cal-list">
          {items.map((form) => (
            <li key={form.id} className={`cal-row${form.active ? '' : ' is-off'}`}>
              <Link href={`/app/calendar/routing/${form.id}`} className="cal-row-main">
                <span className="cal-row-title">{form.title}</span>
                <span className="cal-row-meta">
                  <span className="data">/r/{handle}/{form.slug}</span>
                  <span>{t('routing.counts', { q: form.questions, r: form.rules })}</span>
                  {!form.active && <span className="badge">{t('routing.inactive')}</span>}
                </span>
              </Link>
              <CalIcon name="next" />
            </li>
          ))}
        </ul>
      )}

      <QuickModal
        open={open}
        onClose={close}
        crumb={t('quick.routingCrumb')}
        showCrumb={false}
        onSubmit={submit}
        submitLabel={t('quick.routingCreate')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!title.trim() || !slug}
        busy={busy}
        error={error}
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
        <p className="cal-qm-note">{t('quick.routingNote')}</p>
      </QuickModal>
    </div>
  );
}
