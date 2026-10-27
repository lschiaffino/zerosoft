'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CalIcon from './cal-icons';
import CalCopyButton from './CalCopyButton';

export interface PollListView {
  id: string;
  title: string;
  status: 'open' | 'booked' | 'closed';
  durationMin: number;
  optionCount: number;
  voteCount: number;
  token: string;
}

export interface PollDetailView {
  id: string;
  title: string;
  description: string;
  durationMin: number;
  location: string;
  status: 'open' | 'booked' | 'closed';
  token: string;
  bookingId: string | null;
  options: Array<{ id: string; startsAt: string }>;
  votes: Array<{ id: string; name: string; email?: string; optionIds: string[] }>;
}

const DURATIONS = [15, 30, 45, 60] as const;

function localInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultTime(i: number): string {
  const d = new Date(Date.now() + 86_400_000 * (1 + Math.floor(i / 2)));
  d.setHours(i % 2 === 0 ? 10 : 15, 0, 0, 0);
  return localInput(d);
}

function statusBadge(status: PollListView['status']): string {
  return status === 'booked' ? 'badge badge-ok' : status === 'closed' ? 'badge' : 'badge badge-outline';
}

async function errorCode(res: Response | null): Promise<string> {
  const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
  return (typeof data?.error === 'string' ? data.error : data?.error?.code) ?? 'generic';
}

/** Lista de encuestas de horario y alta rápida (botón o tecla C). */
export function PollsList({ items, pollBase, openNew }: { items: PollListView[]; pollBase: string; openNew?: boolean }) {
  const t = useTranslations('calendar');
  const router = useRouter();
  const [open, setOpen] = useState(!!openNew);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState<number>(30);
  const [location, setLocation] = useState('');
  const [times, setTimes] = useState<string[]>(() => [defaultTime(0), defaultTime(1), defaultTime(2)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useKeyShortcut('c', () => setOpen(true), !open);
  const valid = times.map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > Date.now());

  async function submit() {
    if (!title.trim() || valid.length < 2) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/calendar/polls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        durationMin: duration,
        location: location.trim() || undefined,
        times: valid.map((d) => d.toISOString()),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const poll = (await res.json()) as { id: string };
      router.push(`/app/calendar/polls/${poll.id}`);
      return;
    }
    const code = await errorCode(res);
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  return (
    <div className="ui-page">
      <PageHeader
        title={t('polls.title')}
        description={t('polls.lead')}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} title={t('list.shortcut')}>
            {t('polls.new')}
            <span className="kbd" aria-hidden="true">
              C
            </span>
          </button>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title={t('polls.emptyTitle')}
          body={t('polls.emptyBody')}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              {t('polls.new')}
            </button>
          }
        />
      ) : (
        <ul className="cal-list">
          {items.map((p) => (
            <li key={p.id} className={`cal-row${p.status === 'closed' ? ' is-off' : ''}`}>
              <Link href={`/app/calendar/polls/${p.id}`} className="cal-row-main">
                <span className="cal-row-title">{p.title}</span>
                <span className="cal-row-meta">
                  <span>{t('editor.minutes', { n: p.durationMin })}</span>
                  <span>{t('polls.counts', { options: p.optionCount, votes: p.voteCount })}</span>
                  <span className={statusBadge(p.status)}>{t(`polls.status.${p.status}`)}</span>
                </span>
              </Link>
              {p.status === 'open' && <CalCopyButton text={`${pollBase}/${p.token}`} iconOnly />}
              <CalIcon name="next" />
            </li>
          ))}
        </ul>
      )}

      <QuickModal
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
          if (openNew) router.replace('/app/calendar/polls');
        }}
        crumb={t('polls.new')}
        showCrumb={false}
        onSubmit={submit}
        submitLabel={t('polls.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!title.trim() || valid.length < 2}
        busy={busy}
        error={error}
      >
        <input
          className="qm-title"
          data-autofocus
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('polls.titlePlaceholder')}
          aria-label={t('form.title')}
        />
        <div className="qm-field">
          <span id="cal-poll-duration">{t('quick.duration')}</span>
          <div className="btn-group cal-durations" role="radiogroup" aria-labelledby="cal-poll-duration">
            {DURATIONS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={duration === d} className="btn btn-sm" onClick={() => setDuration(d)}>
                {d} min
              </button>
            ))}
          </div>
        </div>
        <label className="qm-field">
          <span>{t('quick.location')}</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t('form.locationPlaceholder')} />
        </label>
        <div className="qm-field">
          <span>{t('polls.timesTitle')}</span>
          <ul className="cal-oneoff-list">
            {times.map((v, i) => (
              <li key={i} className="cal-oneoff-row">
                <input
                  className="input data"
                  type="datetime-local"
                  value={v}
                  aria-label={t('oneOff.timeN', { n: i + 1 })}
                  onChange={(e) => setTimes((prev) => prev.map((x, k) => (k === i ? e.target.value : x)))}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={t('oneOff.removeTime', { n: i + 1 })}
                  onClick={() => setTimes((prev) => prev.filter((_, k) => k !== i))}
                  disabled={times.length <= 2}
                >
                  <CalIcon name="trash" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={times.length >= 20}
            onClick={() => setTimes((prev) => [...prev, defaultTime(prev.length)])}
          >
            <CalIcon name="plus" />
            {t('oneOff.addTime')}
          </button>
        </div>
        <p className="cal-qm-note">{t('polls.note')}</p>
      </QuickModal>
    </div>
  );
}

/** Detalle de una encuesta para quien la organiza: grilla de votos, reservar, renombrar, cerrar y borrar. */
export function PollDetail({ poll: initial, pollUrl }: { poll: PollDetailView; pollUrl: string }) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [poll, setPoll] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmBook, setConfirmBook] = useState<string | null>(null);
  const tally = useMemo(() => {
    const m = new Map(poll.options.map((o) => [o.id, 0]));
    for (const v of poll.votes) for (const o of v.optionIds) if (m.has(o)) m.set(o, (m.get(o) ?? 0) + 1);
    return m;
  }, [poll]);
  const best = Math.max(0, ...tally.values());
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

  async function patch(body: Record<string, unknown>) {
    setBusy('patch');
    setError(null);
    const res = await fetch(`/api/calendar/polls/${poll.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError(t('errors.generic'));
      return false;
    }
    const next = (await res.json()) as { title: string; status: PollDetailView['status'] };
    setPoll((p) => ({ ...p, title: next.title, status: next.status }));
    router.refresh();
    return true;
  }

  async function book(optionId: string) {
    setBusy(optionId);
    setError(null);
    const res = await fetch(`/api/calendar/polls/${poll.id}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ optionId, locale }),
    }).catch(() => null);
    setBusy(null);
    setConfirmBook(null);
    if (res?.ok) {
      const data = (await res.json()) as { booking: { id: string } };
      setPoll((p) => ({ ...p, status: 'booked', bookingId: data.booking.id }));
      setNotice(t('polls.booked'));
      router.refresh();
      return;
    }
    const code = await errorCode(res);
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  async function remove() {
    setBusy('delete');
    const res = await fetch(`/api/calendar/polls/${poll.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.status === 204) {
      router.push('/app/calendar/polls');
      router.refresh();
      return;
    }
    setConfirmDelete(false);
    setError(t('errors.generic'));
  }

  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/calendar/polls', label: t('polls.title') }}
        title={
          editing ? (
            <form
              className="cal-inline-rename"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) void patch({ title: title.trim() }).then((ok) => ok && setEditing(false));
              }}
            >
              <input
                className="input"
                aria-label={t('polls.rename')}
                value={title}
                maxLength={200}
                autoFocus
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setTitle(poll.title);
                    setEditing(false);
                  }
                }}
              />
              <button type="submit" className="btn btn-sm btn-primary" aria-busy={busy === 'patch' || undefined}>
                {t('common.save')}
              </button>
            </form>
          ) : (
            <span className="cal-title-row">
              {poll.title}
              <span className={statusBadge(poll.status)}>{t(`polls.status.${poll.status}`)}</span>
            </span>
          )
        }
        description={
          <span className="cal-head-meta">
            <span className="cal-num">{t('editor.minutes', { n: poll.durationMin })}</span>
            {poll.location && <span>{poll.location}</span>}
          </span>
        }
        actions={
          <>
            {poll.status === 'open' && <CalCopyButton text={pollUrl} />}
            {!editing && (
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                {t('polls.rename')}
              </button>
            )}
            {poll.status !== 'booked' && (
              <button type="button" className="btn btn-sm" onClick={() => void patch({ status: poll.status === 'open' ? 'closed' : 'open' })}>
                {poll.status === 'open' ? t('polls.close') : t('polls.reopen')}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
              <CalIcon name="trash" />
              {t('common.delete')}
            </button>
          </>
        }
      />

      {notice && (
        <p className="cal-callout cal-callout-ok" role="status">
          {notice}{' '}
          <Link href="/app/calendar/bookings" className="cal-inline-link">
            {t('polls.seeBooking')}
          </Link>
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}

      <section className="ui-section" aria-labelledby={`${id}-grid`}>
        <div className="ui-section-head">
          <h2 id={`${id}-grid`} className="ui-section-title">
            {t('polls.results')}
          </h2>
          <p className="ui-section-desc">
            {poll.status === 'open' ? t('polls.resultsLead') : poll.status === 'booked' ? t('polls.bookedLead') : t('polls.closedLead')}
          </p>
        </div>
        <div className="ui-section-body">
          {poll.status === 'open' && (
            <div className="cal-share-url">
              <span className="data">{pollUrl}</span>
              <CalCopyButton text={pollUrl} />
            </div>
          )}
          <div className="table-wrap">
            <table className="table cal-poll-grid">
              <thead>
                <tr>
                  <th scope="col">{t('polls.time')}</th>
                  <th scope="col" className="num">
                    {t('polls.votes')}
                  </th>
                  <th scope="col">{t('polls.who')}</th>
                  {poll.status === 'open' && (
                    <th scope="col">
                      <span className="sr-only">{t('polls.book')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {poll.options.map((o) => {
                  const n = tally.get(o.id) ?? 0;
                  const names = poll.votes.filter((v) => v.optionIds.includes(o.id)).map((v) => v.name);
                  const d = new Date(o.startsAt);
                  return (
                    <tr key={o.id} className={n > 0 && n === best ? 'cal-poll-best' : undefined}>
                      <td className="data">
                        {day.format(d)} · {time.format(d)}
                      </td>
                      <td className="num data" data-label={t('polls.votes')}>
                        {n}
                        {n > 0 && n === best && <span className="sr-only"> {t('polls.mostVotes')}</span>}
                      </td>
                      <td className="cal-wrap" data-label={t('polls.who')}>
                        {names.join(', ') || <span className="cal-muted">–</span>}
                      </td>
                      {poll.status === 'open' && (
                        <td>
                          <button
                            type="button"
                            className={`btn btn-sm${n > 0 && n === best ? ' btn-primary' : ''}`}
                            disabled={poll.votes.length === 0 || d.getTime() <= Date.now() || !!busy}
                            aria-busy={busy === o.id || undefined}
                            onClick={() => setConfirmBook(o.id)}
                          >
                            {t('polls.book')}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {poll.votes.length === 0 ? (
            <p className="cal-muted">{t('polls.noVotes')}</p>
          ) : (
            <p className="ui-help">{t('polls.participants', { n: poll.votes.length, names: poll.votes.map((v) => v.name).join(', ') })}</p>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!confirmBook}
        title={t('polls.bookConfirmTitle')}
        body={t('polls.bookConfirmBody', { n: poll.votes.length })}
        confirmLabel={t('polls.book')}
        cancelLabel={t('common.cancel')}
        busy={!!busy}
        onConfirm={() => confirmBook && void book(confirmBook)}
        onCancel={() => setConfirmBook(null)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={t('polls.deleteTitle')}
        body={t('polls.deleteBody', { title: poll.title })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
