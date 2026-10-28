'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { speakerKey, type VoiceAttendee, type VoiceChatMessage, type VoiceSegment } from '@/lib/voice-types';
import type { LinkableBooking } from '@/lib/voice-integrations';
import { voiceErrorKey } from './voice-ui';
import RecipeInput, { type RecipeOption } from './RecipeInput';

function mmss(ms: number): string {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** Transcripción en vivo con hablantes; tocar un nombre lo renombra en toda la reunión. */
export function TranscriptPanel({
  segments,
  speakers,
  onRenameSpeaker,
  recording,
  deletedAt,
}: {
  segments: VoiceSegment[];
  speakers: Record<string, string>;
  onRenameSpeaker: (key: string, name: string) => void;
  recording: boolean;
  /** La transcripción se borró sola por la retención. */
  deletedAt?: string | null;
}) {
  const t = useTranslations('voice.transcript');
  const format = useFormatter();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ segId: string; key: string; name: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Solo se desplaza el panel (no la página: la persona puede estar escribiendo sus notas).
    const panel = endRef.current?.closest('.vc-panel');
    if (recording && panel) panel.scrollTop = panel.scrollHeight;
  }, [segments.length, recording]);

  const name = (s: VoiceSegment) => {
    const key = speakerKey(s.source, s.speaker);
    if (speakers[key]) return speakers[key];
    if (s.source === 'me') return t('me');
    if (s.speaker) {
      const n = (Number(s.speaker) || 0) + 1;
      return s.source === 'them' ? `${t('them')} ${n}` : t('speakerN', { n });
    }
    return s.source === 'them' ? t('them') : t('speaker');
  };
  const needle = filter.trim().toLowerCase();
  const shown = needle ? segments.filter((s) => s.text.toLowerCase().includes(needle) || name(s).toLowerCase().includes(needle)) : segments;

  return (
    <div className="vc-transcript">
      {deletedAt && segments.length === 0 && (
        <p className="vc-notice" role="note" suppressHydrationWarning>
          {t('deleted', { date: format.dateTime(new Date(deletedAt), { dateStyle: 'medium' }) })}
        </p>
      )}
      <input
        type="search"
        className="input"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('search')}
        aria-label={t('search')}
      />
      {segments.length === 0 ? (
        <p className="vc-muted vc-transcript-empty">{recording ? t('waiting') : t('empty')}</p>
      ) : shown.length === 0 ? (
        <p className="vc-muted">{t('noMatches')}</p>
      ) : (
        <ol className="vc-segments" aria-live={recording ? 'polite' : undefined}>
          {shown.map((s) => {
            const key = speakerKey(s.source, s.speaker);
            return (
              <li key={s.id} className={`vc-seg is-${s.source}`}>
                <span className="vc-seg-time data">{mmss(s.startMs)}</span>
                {editing?.segId === s.id ? (
                  <input
                    className="input vc-speaker-input"
                    value={editing.name}
                    autoFocus
                    maxLength={80}
                    aria-label={t('renameSpeaker')}
                    onChange={(e) => setEditing({ segId: s.id, key, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    onBlur={() => {
                      onRenameSpeaker(key, editing.name.trim());
                      setEditing(null);
                    }}
                  />
                ) : (
                  <button type="button" className="vc-speaker" title={t('renameSpeaker')} onClick={() => setEditing({ segId: s.id, key, name: speakers[key] ?? name(s) })}>
                    {name(s)}
                  </button>
                )}
                <span className="vc-seg-text">{s.text}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div ref={endRef} />
    </div>
  );
}

/** Chat sobre la reunión ("¿qué dijo Ana del precio?"). */
export function ChatPanel({ sessionId, initial, ai }: { sessionId: string; initial: VoiceChatMessage[]; ai: boolean }) {
  const t = useTranslations('voice.chat');
  const tErr = useTranslations('voice.errors');
  const locale = useLocale();
  const [messages, setMessages] = useState(initial);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string, recipe?: RecipeOption) {
    if ((!question && !recipe) || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: 'user', text: recipe ? `/${recipe.name}` : question, at: new Date().toISOString() }]);
    setQ('');
    const res = await fetch(`/api/voice/sessions/${sessionId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(recipe ? { recipeId: recipe.id, locale } : { question, locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { chat?: VoiceChatMessage[]; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.chat) {
      setMessages((m) => m.slice(0, -1));
      setQ(recipe ? `/${recipe.name}` : question);
      setError(data?.error ?? 'network');
      return;
    }
    setMessages(data.chat);
  }

  return (
    <div className="vc-chat">
      {!ai && <p className="vc-notice">{tErr('ai_disabled')}</p>}
      {messages.length === 0 ? (
        <p className="vc-muted">{t('empty')}</p>
      ) : (
        <ol className="vc-chat-list" aria-live="polite">
          {messages.map((m, i) => (
            <li key={i} className={`vc-msg is-${m.role}`}>
              <span className="sr-only">{m.role === 'user' ? t('you') : t('assistant')}: </span>
              {m.text}
            </li>
          ))}
        </ol>
      )}
      {busy && (
        <p className="vc-muted" role="status">
          {t('thinking')}
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
      <RecipeInput
        value={q}
        onChange={setQ}
        onAsk={(question) => void send(question)}
        onRecipe={(r) => void send('', r)}
        placeholder={t('placeholder')}
        label={t('placeholder')}
        busy={busy}
        submitLabel={t('send')}
      />
      <p className="vc-muted vc-hint">{t('recipesHint')}</p>
    </div>
  );
}

/** Asistentes de la reunión (salen del calendario o se cargan a mano): con ellos se arman el brief y el email. */
function AttendeesSection({ attendees, onChange }: { attendees: VoiceAttendee[]; onChange: (next: VoiceAttendee[]) => void }) {
  const t = useTranslations('voice.details');
  const [email, setEmail] = useState('');
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <section>
      <h3 className="vc-h3">{t('attendees')}</h3>
      {attendees.length === 0 ? (
        <p className="vc-muted">{t('attendeesEmpty')}</p>
      ) : (
        <ul className="vc-attendees">
          {attendees.map((a) => (
            <li key={a.email || a.name}>
              <span>
                {a.name || a.email}
                {a.name && a.email && <span className="vc-muted"> · {a.email}</span>}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={t('attendeesRemove', { email: a.email || a.name })} onClick={() => onChange(attendees.filter((x) => x !== a))}>
                {t('remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="vc-send-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const clean = email.trim().toLowerCase();
          if (!attendees.some((a) => a.email === clean)) onChange([...attendees, { name: '', email: clean }]);
          setEmail('');
        }}
      >
        <input type="email" className="input" value={email} maxLength={254} placeholder={t('attendeesAdd')} aria-label={t('attendeesAdd')} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={!valid}>
          {t('attendeesAddBtn')}
        </button>
      </form>
    </section>
  );
}

interface ContactOption {
  id: string;
  name: string;
  email: string;
}

/** Vínculos: reserva de Cal, contacto del CRM (timeline) y a dónde se mandó la nota. */
export function DetailsPanel({
  sessionId,
  calBookingId,
  contact,
  crmActivityId,
  docsPageId,
  noteId,
  attendees,
  onAttendees,
  onLinked,
}: {
  sessionId: string;
  calBookingId: string | null;
  contact: ContactOption | null;
  crmActivityId: string | null;
  docsPageId: string | null;
  noteId: string | null;
  attendees: VoiceAttendee[];
  onAttendees: (next: VoiceAttendee[]) => void;
  onLinked: (patch: { title?: string; contact?: ContactOption | null; calBookingId?: string | null; crmActivityId?: string | null }) => void;
}) {
  const t = useTranslations('voice.details');
  const tErr = useTranslations('voice.errors');
  const format = useFormatter();
  const locale = useLocale();
  const [bookings, setBookings] = useState<LinkableBooking[] | null>(null);
  const [contactQ, setContactQ] = useState('');
  const [contactResults, setContactResults] = useState<ContactOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch('/api/voice/bookings')
      .then((r) => (r.ok ? r.json() : { bookings: [] }))
      .then((d: { bookings: LinkableBooking[] }) => alive && setBookings(d.bookings))
      .catch(() => alive && setBookings([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const q = contactQ.trim();
    if (q.length < 2) {
      setContactResults([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/crm/contacts?q=${encodeURIComponent(q)}&pageSize=8`, { signal: ctrl.signal }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { rows?: Array<{ id: string; first_name: string; last_name: string; email: string }> } | null;
      if (ctrl.signal.aborted) return;
      setContactResults((data?.rows ?? []).map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`.trim() || r.email, email: r.email })));
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [contactQ]);

  async function linkBooking(bookingId: string) {
    if (!bookingId) return;
    setBusy('booking');
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingId }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { title?: string; contact?: ContactOption | null; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data) {
      setError(data?.error ?? 'network');
      return;
    }
    onLinked({ title: data.title, calBookingId: bookingId, ...(data.contact ? { contact: data.contact } : {}) });
  }

  async function setContact(c: ContactOption | null) {
    setBusy('contact');
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: c?.id ?? null }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? 'network');
      return;
    }
    setContactQ('');
    setContactResults([]);
    setLogged(false);
    onLinked({ contact: c, crmActivityId: null });
  }

  async function logToContact() {
    setBusy('log');
    setError(null);
    const res = await fetch(`/api/voice/sessions/${sessionId}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'contact', locale }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { activityId?: string; error?: string } | null;
    setBusy(null);
    if (!res?.ok || !data?.activityId) {
      setError(data?.error ?? 'network');
      return;
    }
    setLogged(true);
    onLinked({ crmActivityId: data.activityId });
  }

  const linked = bookings?.find((b) => b.id === calBookingId);

  return (
    <div className="vc-details">
      <AttendeesSection attendees={attendees} onChange={onAttendees} />
      <section>
        <h3 className="vc-h3">{t('calTitle')}</h3>
        {calBookingId && (
          <p>
            {linked ? `${linked.title} · ${linked.inviteeName}` : t('calLinked')}{' '}
            <Link href="/app/calendar/bookings">{t('openCal')}</Link>
          </p>
        )}
        {bookings === null ? (
          <p className="vc-muted">{t('loading')}</p>
        ) : bookings.length === 0 ? (
          <p className="vc-muted">{t('calEmpty')}</p>
        ) : (
          <select
            className="select"
            value=""
            disabled={busy !== null}
            aria-label={t('calPick')}
            onChange={(e) => void linkBooking(e.target.value)}
          >
            <option value="">{calBookingId ? t('calChange') : t('calPick')}</option>
            {bookings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title} · {b.inviteeName} · {format.dateTime(new Date(b.startsAt), { dateStyle: 'short', timeStyle: 'short' })}
              </option>
            ))}
          </select>
        )}
      </section>

      <section>
        <h3 className="vc-h3">{t('crmTitle')}</h3>
        {contact ? (
          <>
            <p>
              <Link href={`/app/crm/contacts/${contact.id}`}>{contact.name}</Link>
              {contact.email && <span className="vc-muted"> · {contact.email}</span>}
            </p>
            <div className="vc-send-row">
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} aria-busy={busy === 'log' || undefined} onClick={() => void logToContact()}>
                {crmActivityId ? t('crmUpdate') : t('crmLog')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void setContact(null)}>
                {t('crmUnlink')}
              </button>
            </div>
            {(logged || crmActivityId) && <p className="vc-muted">{t('crmLogged')}</p>}
          </>
        ) : (
          <>
            <input
              type="search"
              className="input"
              value={contactQ}
              onChange={(e) => setContactQ(e.target.value)}
              placeholder={t('crmSearch')}
              aria-label={t('crmSearch')}
            />
            {contactResults.length > 0 && (
              <ul className="vc-picker">
                {contactResults.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void setContact(c)}>
                      {c.name}
                      {c.email && <span className="vc-muted"> · {c.email}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="vc-muted">{t('crmHelp')}</p>
          </>
        )}
      </section>

      {(docsPageId || noteId) && (
        <section>
          <h3 className="vc-h3">{t('sentTitle')}</h3>
          <ul className="vc-points">
            {docsPageId && (
              <li>
                <Link href={`/app/docs/${docsPageId}`}>{t('openDocs')}</Link>
              </li>
            )}
            {noteId && (
              <li>
                <Link href={`/app/notes?note=${noteId}`}>{t('openNotes')}</Link>
              </li>
            )}
          </ul>
        </section>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {tErr(voiceErrorKey(error))}
        </p>
      )}
    </div>
  );
}
