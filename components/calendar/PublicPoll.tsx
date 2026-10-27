'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

async function errorCode(res: Response | null): Promise<string> {
  const data = res ? ((await res.json().catch(() => null)) as { error?: string | { code?: string } } | null) : null;
  return (typeof data?.error === 'string' ? data.error : data?.error?.code) ?? 'generic';
}

interface PublicPollData {
  title: string;
  description: string;
  durationMin: number;
  location: string;
  status: 'open' | 'booked' | 'closed';
  options: Array<{ id: string; startsAt: string }>;
  votes: Array<{ id: string; name: string; optionIds: string[] }>;
}

/** Página pública de la encuesta: cada participante marca los horarios que le sirven. */
export default function PublicPoll({ token, initial, brand }: { token: string; initial: PublicPollData; brand: { color: string; on: string; name: string } }) {
  const t = useTranslations('calendar');
  const locale = useLocale();
  const id = useId();
  const [poll, setPoll] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voted, setVoted] = useState(false);
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
  const [mounted, setMounted] = useState(false);
  const storeKey = `zs-poll-${token}`;
  useEffect(() => {
    setMounted(true);
    // El voto anterior de este navegador: se puede cambiar con su token.
    try {
      const saved = JSON.parse(window.localStorage.getItem(storeKey) || 'null') as { name?: string; email?: string } | null;
      if (saved?.email) setEmail(saved.email);
      if (saved?.name) setName(saved.name);
    } catch {
      // Sin localStorage: se vota de cero.
    }
  }, [storeKey]);

  function savedToken(forEmail: string): string | undefined {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storeKey) || 'null') as { email?: string; editToken?: string } | null;
      return saved?.email?.toLowerCase() === forEmail.toLowerCase() ? saved.editToken : undefined;
    } catch {
      return undefined;
    }
  }
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: mounted ? tz : 'UTC' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: mounted ? tz : 'UTC' });
  const count = (optionId: string) => poll.votes.filter((v) => v.optionIds.includes(optionId)).length;
  const valid = !!name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && picked.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/calendar/poll-votes/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        optionIds: picked,
        timezone: tz,
        editToken: savedToken(email.trim()),
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      const data = (await res.json()) as PublicPollData & { editToken?: string };
      setPoll(data);
      try {
        window.localStorage.setItem(storeKey, JSON.stringify({ name: name.trim(), email: email.trim(), editToken: data.editToken }));
      } catch {
        // Sin localStorage: el voto queda igual.
      }
      setVoted(true);
      return;
    }
    const code = await errorCode(res);
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  return (
    <div className="bk" style={{ '--bk': brand.color, '--bk-on': brand.on } as React.CSSProperties}>
      <div className="bk-card bk-poll">
        <div className="bk-main">
          <header className="bk-poll-head">
            <p className="bk-muted">{brand.name}</p>
            <h1 className="bk-title">{poll.title}</h1>
            <p className="bk-muted">
              {t('booking.minutes', { n: poll.durationMin })}
              {poll.location ? ` · ${poll.location}` : ''}
            </p>
            {poll.description && <p>{poll.description}</p>}
          </header>
          {poll.status !== 'open' ? (
            <p className="bk-status" role="status">
              {poll.status === 'booked' ? t('polls.publicBooked') : t('polls.publicClosed')}
            </p>
          ) : voted ? (
            <section className="bk-done" aria-live="polite">
              <h2 className="bk-h2">{t('polls.thanks')}</h2>
              <p className="bk-muted">{t('polls.thanksSub')}</p>
              <button type="button" className="btn btn-ghost" onClick={() => setVoted(false)}>
                {t('polls.changeVote')}
              </button>
            </section>
          ) : (
            <form className="bk-form" onSubmit={submit}>
              <fieldset className="bk-poll-options">
                <legend className="bk-h2">{t('polls.pickTimes')}</legend>
                <p className="bk-muted data">{mounted ? tz : ''}</p>
                {poll.options.map((o) => {
                  const d = new Date(o.startsAt);
                  const checked = picked.includes(o.id);
                  return (
                    <label key={o.id} className={`bk-poll-option${checked ? ' is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)))}
                      />
                      <span className="bk-poll-when">
                        <strong>{day.format(d)}</strong>
                        <span className="data">{time.format(d)}</span>
                      </span>
                      <span className="bk-muted data">{t('polls.voteCount', { n: count(o.id) })}</span>
                    </label>
                  );
                })}
              </fieldset>
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-name`}>
                  {t('booking.name')}
                </label>
                <input id={`${id}-name`} className="input" value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="ui-field">
                <label className="label" htmlFor={`${id}-email`}>
                  {t('booking.email')}
                </label>
                <input
                  id={`${id}-email`}
                  className="input"
                  type="email"
                  value={email}
                  maxLength={320}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <p className="ui-help">{t('polls.emailHelp')}</p>
              </div>
              {error && (
                <p className="ui-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn bk-cta" disabled={!valid} aria-busy={busy || undefined}>
                {t('polls.submitVote')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
