'use client';

import LocalText from '@/components/ui/LocalText';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { VoiceAttendee, VoiceCalendarEvent } from '@/lib/voice-types';
import { attendeeGroups, currentCalendarEvent, isFreshMeeting, localDayWindow } from '@/lib/voice-people';
import Pop from './Pop';
import { voiceErrorKey } from './voice-ui';

interface Person {
  name: string;
  email: string;
}

export interface LinkResult {
  title?: string;
  eventKey: string | null;
  calBookingId?: string | null;
  attendees?: VoiceAttendee[];
  contact?: { id: string; name: string; email: string } | null;
}

/**
 * Chip "Hoy · Yo" de la reunión (como Granola): abre el evento del calendario
 * de hoy (elige solo el que está pasando en una reunión nueva), los asistentes
 * agrupados por empresa y "Agregar asistentes…" con la gente del workspace y
 * los contactos del CRM.
 */
export default function MeetingPeople({
  sessionId,
  startedAt,
  attendees,
  eventKey,
  canAutoLink,
  onAttendees,
  onLinked,
}: {
  sessionId: string;
  startedAt: string;
  attendees: VoiceAttendee[];
  eventKey: string | null;
  /** Reunión recién creada sin evento: puede tomar el que está pasando. */
  canAutoLink: boolean;
  onAttendees: (next: VoiceAttendee[]) => void;
  onLinked: (r: LinkResult) => void;
}) {
  const t = useTranslations('voice.people');
  const tErr = useTranslations('voice.errors');
  const format = useFormatter();
  const [events, setEvents] = useState<VoiceCalendarEvent[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [members, setMembers] = useState<Person[]>([]);
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<Person[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const loaded = useRef(false);
  const autoTried = useRef(false);

  const load = useCallback(async () => {
    if (loaded.current) return;
    loaded.current = true;
    const { from, to } = localDayWindow(new Date());
    const [ev, share] = await Promise.all([
      fetch(`/api/voice/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ events: VoiceCalendarEvent[]; calendarConnected?: boolean }>) : null))
        .catch(() => null),
      fetch(`/api/voice/sessions/${sessionId}/share`)
        .then((r) => (r.ok ? (r.json() as Promise<{ members: Array<{ name: string | null; email: string }> }>) : null))
        .catch(() => null),
    ]);
    setEvents(ev?.events ?? []);
    setConnected(ev?.calendarConnected ?? false);
    setMembers((share?.members ?? []).map((m) => ({ name: m.name ?? '', email: m.email.toLowerCase() })));
    return ev?.events ?? [];
  }, [sessionId]);

  const link = useCallback(
    async (key: string | null) => {
      setBusy(key ?? 'unlink');
      setError(null);
      const res = await fetch(`/api/voice/sessions/${sessionId}/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventKey: key }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as (LinkResult & { error?: string }) | null;
      setBusy(null);
      if (!res?.ok || !data) {
        setError(data?.error ?? 'network');
        return;
      }
      setEvents((list) => list?.map((e) => ({ ...e, sessionId: e.key === key ? sessionId : e.sessionId === sessionId ? null : e.sessionId })) ?? list);
      onLinked(data);
    },
    [sessionId, onLinked],
  );

  // Reunión nueva: el evento que está pasando ahora se elige solo.
  useEffect(() => {
    if (!canAutoLink || autoTried.current || !isFreshMeeting(startedAt)) return;
    autoTried.current = true;
    void load().then((list) => {
      const now = list ? currentCalendarEvent(list, new Date()) : null;
      if (now) void link(now.key);
    });
  }, [canAutoLink, startedAt, load, link]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setContacts([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/crm/contacts?q=${encodeURIComponent(term)}&pageSize=6`, { signal: ctrl.signal }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { rows?: Array<{ first_name: string; last_name: string; email: string }> } | null;
      if (ctrl.signal.aborted) return;
      setContacts((data?.rows ?? []).filter((r) => r.email).map((r) => ({ name: `${r.first_name} ${r.last_name}`.trim(), email: r.email.toLowerCase() })));
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  const memberEmails = useMemo(() => new Set(members.map((m) => m.email)), [members]);
  const taken = useMemo(() => new Set(attendees.map((a) => a.email)), [attendees]);
  const needle = q.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const pool = [...members, ...contacts];
    const seen = new Set<string>();
    return pool
      .filter((p) => {
        if (!p.email || taken.has(p.email) || seen.has(p.email)) return false;
        seen.add(p.email);
        return !needle || p.email.includes(needle) || p.name.toLowerCase().includes(needle);
      })
      .slice(0, 6);
  }, [members, contacts, taken, needle]);
  const typedEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(needle) && !taken.has(needle) ? needle : null;
  const options: Person[] = [...suggestions, ...(typedEmail && !suggestions.some((s) => s.email === typedEmail) ? [{ name: '', email: typedEmail }] : [])];

  function add(p: Person) {
    if (!p.email || taken.has(p.email)) return;
    onAttendees([...attendees, { name: p.name, email: p.email }]);
    setQ('');
    setActive(0);
  }

  const groups = attendeeGroups(attendees, memberEmails);
  const linked = events?.find((e) => e.key === eventKey) ?? null;
  const day = dayLabel(new Date(startedAt), { today: t('today'), yesterday: t('yesterday') }, (d, o) => format.dateTime(d, o));
  const people = attendees.length ? t('meAnd', { count: attendees.length }) : t('me');
  const timeOf = (iso: string) => format.dateTime(new Date(iso), { hour: 'numeric', minute: '2-digit' });

  return (
    <Pop
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void load();
      }}
      panelLabel={t('panel')}
      panelClass="vc-people"
      testId="voice-people-chip"
      label={
        <>
          <CalIcon />
          <span suppressHydrationWarning>
            <LocalText>{day}</LocalText>
          </span>
          <span aria-hidden="true" className="vc-chip-dot">
            ·
          </span>
          <span>{people}</span>
        </>
      }
    >
      {() => (
        <>
          <section className="vc-people-sec" aria-labelledby="vc-people-cal">
            <h3 id="vc-people-cal" className="vc-pop-title">
              {t('eventTitle')}
            </h3>
            {events === null ? (
              <p className="vc-muted" role="status">
                {t('loading')}
              </p>
            ) : events.length === 0 ? (
              <p className="vc-muted">
                {connected ? t('noEvents') : t('connectHelp')}{' '}
                {!connected && <Link href="/app/calendar/settings">{t('connect')}</Link>}
              </p>
            ) : (
              <ul className="vc-pick-list">
                {events.map((e) => {
                  const on = e.key === eventKey;
                  const elsewhere = !!e.sessionId && e.sessionId !== sessionId;
                  return (
                    <li key={e.key}>
                      <button
                        type="button"
                        className={`vc-pick${on ? ' is-on' : ''}`}
                        aria-pressed={on}
                        disabled={busy !== null || on}
                        onClick={() => void link(e.key)}
                      >
                        <span className="vc-pick-time data" suppressHydrationWarning>
                          <LocalText>{timeOf(e.startsAt)}</LocalText>
                        </span>
                        <span className="vc-pick-main">
                          <span className="vc-pick-title">{e.title || t('untitledEvent')}</span>
                          {(e.attendees.length > 0 || elsewhere) && (
                            <span className="vc-muted vc-pick-meta">
                              {elsewhere ? t('hasNotes') : e.attendees.map((a) => a.name || a.email).slice(0, 3).join(', ')}
                            </span>
                          )}
                        </span>
                        {on && <CheckIcon />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {eventKey && (
              <button type="button" className="btn btn-ghost btn-sm vc-people-unlink" disabled={busy !== null} onClick={() => void link(null)}>
                {linked ? t('unlinkNamed', { title: linked.title || t('untitledEvent') }) : t('unlink')}
              </button>
            )}
          </section>

          <section className="vc-people-sec" aria-labelledby="vc-people-att">
            <h3 id="vc-people-att" className="vc-pop-title">
              {t('attendees')}
            </h3>
            <div className="vc-combo">
              <input
                className="input"
                value={q}
                placeholder={t('add')}
                aria-label={t('add')}
                role="combobox"
                aria-expanded={!!needle && options.length > 0}
                aria-controls="vc-people-options"
                aria-autocomplete="list"
                aria-activedescendant={needle && options[active] ? `vc-people-opt-${active}` : undefined}
                maxLength={254}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const pick = options[active] ?? (typedEmail ? { name: '', email: typedEmail } : null);
                    if (pick) add(pick);
                  }
                }}
              />
              {(needle ? options : suggestions.slice(0, 4)).length > 0 && (
                <ul className="vc-combo-list" role="listbox" id="vc-people-options" aria-label={t('suggestions')}>
                  {(needle ? options : suggestions.slice(0, 4)).map((p, i) => (
                    <li
                      key={p.email}
                      id={`vc-people-opt-${i}`}
                      role="option"
                      aria-selected={!!needle && i === active}
                      className={`vc-combo-opt${needle && i === active ? ' is-active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => add(p)}
                    >
                      <Avatar label={p.name || p.email} />
                      <span className="vc-combo-text">
                        <span>{p.name || p.email}</span>
                        {p.name && <span className="vc-muted">{p.email}</span>}
                      </span>
                      {memberEmails.has(p.email) && <span className="vc-muted vc-combo-tag">{t('teamTag')}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {groups.length === 0 ? (
              <p className="vc-muted">{t('empty')}</p>
            ) : (
              groups.map((g) => (
                <div key={g.key} className="vc-people-group">
                  <p className="vc-people-company">{g.kind === 'team' ? t('team') : g.kind === 'personal' ? t('personal') : g.label}</p>
                  <ul className="vc-people-list">
                    {g.people.map((a) => (
                      <li key={a.email || a.name}>
                        <Avatar label={a.name || a.email} />
                        <span className="vc-people-name">
                          <span>{a.name || a.email}</span>
                          {a.name && a.email && <span className="vc-muted">{a.email}</span>}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          aria-label={t('remove', { name: a.name || a.email })}
                          onClick={() => onAttendees(attendees.filter((x) => x !== a))}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
          {error && (
            <p className="ui-error" role="alert">
              {tErr(voiceErrorKey(error))}
            </p>
          )}
        </>
      )}
    </Pop>
  );
}

function dayLabel(d: Date, words: { today: string; yesterday: string }, fmt: (d: Date, o: { month: 'short'; day: 'numeric'; year?: 'numeric' }) => string): string {
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return words.today;
  if (diff === 1) return words.yesterday;
  return fmt(d, d.getFullYear() !== now.getFullYear() ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
}

function Avatar({ label }: { label: string }) {
  return (
    <span className="vc-avatar" aria-hidden="true">
      {(label.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="vc-pick-check">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
