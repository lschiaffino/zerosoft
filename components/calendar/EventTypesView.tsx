'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';

export interface EventTypeListItem {
  id: string;
  title: string;
  slug: string;
  durationMin: number;
  color: string;
  active: boolean;
}

interface EventTypesViewProps {
  /** Título de la página (h1). */
  title: string;
  items: EventTypeListItem[];
  handle: string;
  /** Base pública, p. ej. https://zerosoft.ai/en/book */
  bookBase: string;
  /** Abre el modal de creación al montar (deep link ?new=1). */
  openNew?: boolean;
  /** Vista resumida (overview): sección con "Ver todo". */
  summary?: { label: string; viewAll: string };
  /** Contenido extra debajo de la cabecera (p. ej. stats). */
  children?: React.ReactNode;
}

const DURATIONS = [15, 30, 45, 60];

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Lunes a viernes, 9 a 17: disponibilidad inicial de un event type nuevo. */
export const DEFAULT_HOURS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '09:00',
  endTime: '17:00',
}));

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/**
 * Lista de event types con acciones en línea (activar/apagar, copiar link,
 * abrir, editar, eliminar) y creación rápida en modal (botón o tecla C).
 */
export default function EventTypesView({ title, items, handle, bookBase, openNew, summary, children }: EventTypesViewProps) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [modalOpen, setModalOpen] = useState(!!openNew);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRows(items), [items]);
  useKeyShortcut('c', () => setModalOpen(true), !modalOpen);

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
      setError(t('errors.generic'));
    }
  }

  async function remove(row: EventTypeListItem) {
    if (!confirm(t('list.deleteConfirm', { title: row.title }))) return;
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== row.id));
    const res = await fetch(`/api/calendar/event-types/${row.id}`, { method: 'DELETE' }).catch(() => null);
    if (!res || res.status !== 204) {
      setRows(prev);
      setError(t('errors.generic'));
      return;
    }
    router.refresh();
  }

  async function copy(row: EventTypeListItem) {
    await copyText(publicUrl(row.slug));
    setCopied(row.id);
    setTimeout(() => setCopied((c) => (c === row.id ? null : c)), 1500);
  }

  const newButton = (
    <button type="button" className="btn btn-solid btn-small" onClick={() => setModalOpen(true)} title={t('list.shortcut')}>
      {t('eventTypes.newCta')}
      <span className="kbd-hint" aria-hidden>
        C
      </span>
    </button>
  );

  const list =
    rows.length === 0 ? (
      <div className="cal-empty">
        <p className="empty-zeros mono" aria-hidden>
          0 0 0
        </p>
        <h2>{t('eventTypes.emptyTitle')}</h2>
        <p className="muted">{t('eventTypes.emptySub')}</p>
        <button type="button" className="btn btn-solid btn-small" onClick={() => setModalOpen(true)}>
          {t('eventTypes.emptyCta')}
        </button>
      </div>
    ) : (
      <ul className="cal-list" data-testid="cal-event-list">
        {rows.map((et) => (
          <li key={et.id} className={`cal-row${et.active ? '' : ' is-off'}`}>
            <span className="calendar-event-dot" style={{ backgroundColor: et.color }} aria-hidden />
            <Link href={`/app/calendar/event-types/${et.id}`} className="cal-row-main">
              <span className="calendar-event-title">{et.title}</span>
              <span className="cal-row-meta mono">
                {et.durationMin} {t('eventTypes.minutes')} · /{handle}/{et.slug}
              </span>
            </Link>
            <div className="cal-row-actions">
              <button
                type="button"
                className="cal-icon-btn"
                onClick={() => copy(et)}
                title={t('list.copyLink')}
                aria-label={t('list.copyLink')}
              >
                {copied === et.id ? t('list.copied') : t('list.copyLink')}
              </button>
              <a
                className="cal-icon-btn"
                href={publicUrl(et.slug)}
                target="_blank"
                rel="noreferrer"
                title={t('list.open')}
                aria-label={t('list.open')}
              >
                ↗
              </a>
              <button
                type="button"
                className="cal-icon-btn cal-icon-danger"
                onClick={() => remove(et)}
                title={t('list.delete')}
                aria-label={`${t('list.delete')} ${et.title}`}
              >
                ×
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={et.active}
                className={`cal-switch${et.active ? ' is-on' : ''}`}
                onClick={() => toggle(et)}
                title={et.active ? t('list.toggleOn') : t('list.toggleOff')}
                aria-label={et.active ? t('list.toggleOn') : t('list.toggleOff')}
              >
                <span />
              </button>
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <div className="page-head">
        <h1 className="app-title">{title}</h1>
        {newButton}
      </div>
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {summary ? (
        <div className="cal-section">
          <div className="cal-section-head">
            <p className="section-label">{summary.label}</p>
            <Link href="/app/calendar/event-types" className="mono panel-more">
              {summary.viewAll} →
            </Link>
          </div>
          {list}
        </div>
      ) : (
        list
      )}
      <NewEventTypeModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          if (openNew) router.replace('/app/calendar/event-types');
        }}
        handle={handle}
        onCreated={(item, openAfter) => {
          setRows((prev) => [item, ...prev.filter((r) => r.id !== item.id)]);
          if (openAfter) router.push(`/app/calendar/event-types/${item.id}`);
          else router.refresh();
        }}
      />
    </>
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
  onCreated: (item: EventTypeListItem, openAfter: boolean) => void;
}) {
  const t = useTranslations('calendar');
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [duration, setDuration] = useState(30);
  const [location, setLocation] = useState('');
  const [openAfter, setOpenAfter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugTouched ? slug : slugify(title);

  function reset() {
    setTitle('');
    setSlug('');
    setSlugTouched(false);
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
      // Disponibilidad inicial: sin reglas el link no tendría horarios.
      await fetch(`/api/calendar/event-types/${et.id}/availability`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: DEFAULT_HOURS }),
      }).catch(() => null);
      setBusy(false);
      reset();
      onClose();
      onCreated(
        { id: et.id, title: et.title, slug: et.slug, durationMin: et.duration_min, color: et.color, active: true },
        openAfter,
      );
      return;
    }
    const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    const code = data?.error ?? 'generic';
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
      footExtra={
        <label className="qm-check">
          <input type="checkbox" checked={openAfter} onChange={(e) => setOpenAfter(e.target.checked)} />
          {t('quick.moreOptions')}
        </label>
      }
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
      <label className="qm-field">
        <span>{t('quick.slug')}</span>
        <div className="qm-prefix">
          <span>/{handle}/</span>
          <input
            className="mono"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
            }}
            placeholder="intro-call"
          />
        </div>
      </label>
      <div className="qm-field">
        <span>{t('quick.duration')}</span>
        <div className="cal-seg" role="radiogroup" aria-label={t('quick.duration')}>
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={duration === d}
              className={duration === d ? 'is-on' : ''}
              onClick={() => setDuration(d)}
            >
              {d} {t('eventTypes.minutes')}
            </button>
          ))}
          <input
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
      <p className="cal-qm-note muted">{t('quick.defaultHours')}</p>
    </QuickModal>
  );
}
