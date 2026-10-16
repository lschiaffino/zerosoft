'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import EmptyState from '@/components/ui/EmptyState';
import CalIcon from './cal-icons';
import { copyText } from './CalCopyButton';
import { slugify } from './cal-utils';

export interface EventTypeListItem {
  id: string;
  title: string;
  slug: string;
  durationMin: number;
  color: string;
  active: boolean;
}

interface EventTypesViewProps {
  items: EventTypeListItem[];
  handle: string;
  /** Base pública, p. ej. https://zerosoft.ai/en/book */
  bookBase: string;
  /** Abre el modal de creación al montar (deep link ?new=1). */
  openNew?: boolean;
  /** Cuántas filas mostrar (resumen); el resto queda en la página de la lista. */
  limit?: number;
}

const DURATIONS = [15, 30, 45, 60];

/**
 * Lista de event types con acciones en línea (copiar link, abrir, apagar,
 * eliminar) y alta rápida en un modal (botón o tecla C): título, duración y
 * ubicación; la URL sale del título.
 */
export default function EventTypesView({ items, handle, bookBase, openNew, limit }: EventTypesViewProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [modalOpen, setModalOpen] = useState(!!openNew);
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; id?: string; tone?: 'error' } | null>(null);

  useEffect(() => setRows(items), [items]);
  useKeyShortcut('c', () => setModalOpen(true), !modalOpen);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Botones de "Crear" de la página (cabecera, estado vacío) abren el mismo modal.
  useEffect(() => {
    const open = () => setModalOpen(true);
    window.addEventListener('zs-cal:new-event-type', open);
    return () => window.removeEventListener('zs-cal:new-event-type', open);
  }, []);

  const publicUrl = (slug: string) => `${bookBase}/${handle}/${slug}`;

  async function toggle(row: EventTypeListItem) {
    const next = !row.active;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: next } : r)));
    const res = await fetch(`/api/calendar/event-types/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: next }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: row.active } : r)));
      setToast({ text: t('errors.generic'), tone: 'error' });
    }
  }

  async function remove(row: EventTypeListItem) {
    if (!confirm(t('list.deleteConfirm', { title: row.title }))) return;
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== row.id));
    const res = await fetch(`/api/calendar/event-types/${row.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res || res.status !== 204) {
      setRows(prev);
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
      setToast({ text: code === 'has_upcoming_bookings' ? t('errors.has_upcoming_bookings') : t('errors.generic'), tone: 'error' });
      return;
    }
    router.refresh();
  }

  async function copy(row: EventTypeListItem) {
    await copyText(publicUrl(row.slug));
    setCopied(row.id);
    setTimeout(() => setCopied((c) => (c === row.id ? null : c)), 1600);
  }

  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState
          title={t('eventTypes.emptyTitle')}
          body={t('eventTypes.emptySub')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}>
              {t('eventTypes.emptyCta')}
            </button>
          }
          secondary={t('eventTypes.emptyAlt')}
        />
      ) : (
        <ul className="cal-list" data-testid="cal-event-list">
          {shown.map((et) => (
            <li key={et.id} className={`cal-row${et.active ? '' : ' is-off'}`}>
              <span className="cal-swatch" style={{ background: et.color }} aria-hidden="true" />
              <Link href={`/app/calendar/event-types/${et.id}`} className="cal-row-main">
                <span className="cal-row-title">{et.title}</span>
                <span className="cal-row-meta">
                  <span>{t('editor.minutes', { n: et.durationMin })}</span>
                  <span className="data">
                    /{handle}/{et.slug}
                  </span>
                  {!et.active && <span className="badge">{t('eventTypes.inactive')}</span>}
                </span>
              </Link>
              <div className="cal-row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(et)}>
                  <CalIcon name={copied === et.id ? 'check' : 'copy'} />
                  <span aria-live="polite">{copied === et.id ? t('list.copied') : t('list.copyLink')}</span>
                </button>
                <a
                  className="btn btn-ghost btn-icon btn-sm"
                  href={publicUrl(et.slug)}
                  target="_blank"
                  rel="noreferrer"
                  title={t('list.open')}
                  aria-label={`${t('list.open')}: ${et.title}`}
                >
                  <CalIcon name="external" />
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm cal-danger-icon"
                  onClick={() => remove(et)}
                  title={t('list.delete')}
                  aria-label={`${t('list.delete')} ${et.title}`}
                >
                  <CalIcon name="trash" />
                </button>
                <label className="ui-switch cal-row-switch" title={et.active ? t('list.toggleOn') : t('list.toggleOff')}>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={et.active}
                    aria-checked={et.active}
                    aria-label={`${t('editor.acceptsBookings')}: ${et.title}`}
                    onChange={() => toggle(et)}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      {limit && rows.length > limit && (
        <Link href="/app/calendar/event-types" className="cal-more">
          {t('overview.allEventTypes', { n: rows.length })}
        </Link>
      )}

      {toast && (
        <div className="ui-toasts" role="status" aria-live="polite">
          <div className="ui-toast" data-tone={toast.tone}>
            <span>{toast.text}</span>
            {toast.id && (
              <Link href={`/app/calendar/event-types/${toast.id}`} className="ui-toast-action">
                {t('quick.openEditor')}
              </Link>
            )}
          </div>
        </div>
      )}

      <NewEventTypeModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          if (openNew) router.replace('/app/calendar/event-types');
        }}
        handle={handle}
        onCreated={(item) => {
          setRows((prev) => [item, ...prev.filter((r) => r.id !== item.id)]);
          setToast({ text: t('quick.created', { title: item.title }), id: item.id });
          router.refresh();
        }}
      />
    </>
  );
}

/** Botón "Crear tipo de evento" para la cabecera de la página: abre el modal de la lista. */
export function NewEventTypeButton() {
  const t = useTranslations('calendar');
  return (
    <button
      type="button"
      className="btn btn-primary"
      title={t('list.shortcut')}
      onClick={() => window.dispatchEvent(new Event('zs-cal:new-event-type'))}
    >
      {t('eventTypes.newCta')}
      <span className="kbd" aria-hidden="true">
        C
      </span>
    </button>
  );
}

function NewEventTypeModal({
  open,
  onClose,
  handle,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;
  onCreated: (item: EventTypeListItem) => void;
}) {
  const t = useTranslations('calendar');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [editingSlug, setEditingSlug] = useState(false);
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = editingSlug ? slug : slugify(title);

  function reset() {
    setTitle('');
    setSlug('');
    setEditingSlug(false);
    setDuration(30);
    setLocation('');
    setError(null);
  }

  async function submit() {
    if (!title.trim() || !effectiveSlug) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/event-types', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        slug: effectiveSlug,
        durationMin: duration,
        location: location.trim() || undefined,
        active: true,
      }),
    }).catch(() => null);
    if (res && res.status === 201) {
      const et = (await res.json()) as { id: string; title: string; slug: string; duration_min: number; color: string };
      // La disponibilidad inicial es el horario por defecto del workspace (el
      // servidor lo asigna al crear y lo crea, lunes a viernes 9 a 17, si no hay).
      setBusy(false);
      reset();
      onClose();
      onCreated({ id: et.id, title: et.title, slug: et.slug, durationMin: et.duration_min, color: et.color, active: true });
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
    if (code === 'slug_taken' || code === 'invalid_slug') {
      // La URL derivada choca con otra: se abre el campo para cambiarla.
      setSlug(effectiveSlug);
      setEditingSlug(true);
    }
    setError(['invalid_slug', 'slug_taken', 'invalid_input'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    setBusy(false);
  }

  return (
    <QuickModal
      open={open}
      onClose={onClose}
      crumb={t('quick.eventCrumb')}
      onSubmit={submit}
      submitLabel={t('quick.create')}
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
        placeholder={t('quick.titlePlaceholder')}
        aria-label={t('form.title')}
      />
      <div className="qm-field">
        <span id="cal-qm-duration">{t('quick.duration')}</span>
        <div className="btn-group cal-durations" role="radiogroup" aria-labelledby="cal-qm-duration">
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={duration === d}
              className="btn btn-sm"
              onClick={() => setDuration(d)}
            >
              {d} min
            </button>
          ))}
          <input
            className="input data cal-duration-other"
            type="number"
            min={1}
            max={720}
            aria-label={t('quick.custom')}
            placeholder={t('quick.custom')}
            value={DURATIONS.includes(duration) ? '' : duration}
            onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 30))}
          />
        </div>
      </div>
      <label className="qm-field">
        <span>{t('quick.location')}</span>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('form.locationPlaceholder')} />
      </label>
      <div className="cal-qm-url">
        {editingSlug ? (
          <label className="qm-field">
            <span>{t('quick.slug')}</span>
            <div className="qm-prefix">
              <span>/{handle}/</span>
              <input
                className="data"
                value={slug}
                autoFocus
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="intro-call"
              />
            </div>
          </label>
        ) : (
          <p className="cal-qm-note">
            <span className="data">
              /{handle}/{effectiveSlug || '…'}
            </span>{' '}
            <button type="button" className="cal-inline-link" onClick={() => {
              setSlug(effectiveSlug);
              setEditingSlug(true);
            }}>
              {t('quick.editUrl')}
            </button>
          </p>
        )}
        <p className="cal-qm-note">{t('quick.defaultHours')}</p>
      </div>
    </QuickModal>
  );
}
