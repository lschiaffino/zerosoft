'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { VoiceCalendarEvent } from '@/lib/voice-types';

const POLL_MS = 5 * 60_000;
const TICK_MS = 15_000;
/** Una reunión que empezó hace menos de esto todavía avisa. */
const LATE_MS = 5 * 60_000;
export const REMINDED_KEY_PREFIX = 'zs-voice-reminded';

function storeKey(owner: string): string {
  return `${REMINDED_KEY_PREFIX}:${owner}`;
}

function loadReminded(owner: string): string[] {
  try {
    const raw = localStorage.getItem(storeKey(owner));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(-200) : [];
  } catch {
    return [];
  }
}

function saveReminded(owner: string, list: string[]) {
  try {
    localStorage.setItem(storeKey(owner), JSON.stringify(list.slice(-200)));
  } catch {
    /* sin storage: el aviso puede repetirse al recargar */
  }
}

/**
 * Aviso antes de cada reunión del calendario (como Granola): mientras
 * zerosoft está abierto, unos minutos antes aparece un aviso para tomar
 * notas (y una notificación del navegador si la persona la permitió). Lo
 * avisado se recuerda por persona y workspace en este navegador; al cerrar
 * sesión se borra (lib/offline-queue clearOfflineData).
 */
export default function MeetingReminders({ owner }: { owner: string }) {
  const t = useTranslations('voice.reminders');
  const pathname = usePathname();
  const router = useRouter();
  const [events, setEvents] = useState<VoiceCalendarEvent[]>([]);
  const [cfg, setCfg] = useState<{ on: boolean; minutes: number }>({ on: false, minutes: 2 });
  const [due, setDue] = useState<VoiceCalendarEvent | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reminded = useRef<string[]>([]);

  useEffect(() => {
    reminded.current = loadReminded(owner);
  }, [owner]);

  const load = useCallback(async () => {
    if (document.visibilityState === 'hidden' && events.length) return;
    const res = await fetch('/api/voice/events').catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json().catch(() => null)) as { events?: VoiceCalendarEvent[]; reminders?: boolean; reminderMinutes?: number } | null;
    if (!data) return;
    setEvents(data.events ?? []);
    setCfg({ on: data.reminders !== false, minutes: data.reminderMinutes ?? 2 });
  }, [events.length]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const onSettings = () => void load();
    window.addEventListener('zs:voice-settings', onSettings);
    return () => {
      clearInterval(poll);
      window.removeEventListener('zs:voice-settings', onSettings);
    };
    // Solo al montar: load cambia con la cantidad de eventos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!cfg.on || due) return;
    const next = events.find((e) => {
      const starts = Date.parse(e.startsAt);
      const id = `${e.key}@${e.startsAt}`;
      return starts - now <= cfg.minutes * 60_000 && now - starts <= LATE_MS && !reminded.current.includes(id);
    });
    if (!next) return;
    // En la página de esa reunión no hace falta avisar.
    if (next.sessionId && pathname.startsWith(`/app/voice/meetings/${next.sessionId}`)) return;
    reminded.current = [...reminded.current, `${next.key}@${next.startsAt}`];
    saveReminded(owner, reminded.current);
    setDue(next);
    const href = next.sessionId ? `/app/voice/meetings/${next.sessionId}` : `/app/voice?event=${encodeURIComponent(next.key)}`;
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
        const n = new Notification(next.title || t('untitled'), { body: t('notifyBody'), tag: `zs-voice-${next.key}` });
        n.onclick = () => {
          window.focus();
          router.push(href);
          n.close();
        };
      }
    } catch {
      /* sin notificaciones del navegador: queda el aviso en la página */
    }
  }, [events, now, cfg, due, owner, pathname, router, t]);

  if (!due) return null;
  const mins = Math.max(0, Math.round((Date.parse(due.startsAt) - now) / 60_000));
  const href = due.sessionId ? `/app/voice/meetings/${due.sessionId}` : `/app/voice?event=${encodeURIComponent(due.key)}`;
  return (
    <div className="vc-reminder" role="status" aria-live="polite" data-testid="voice-reminder">
      <p className="vc-reminder-text">
        <strong>{due.title || t('untitled')}</strong>
        <span className="vc-muted">{mins > 0 ? t('startsIn', { minutes: mins }) : t('startsNow')}</span>
      </p>
      <div className="vc-send-row">
        <Link className="btn btn-primary btn-sm" href={href} onClick={() => setDue(null)}>
          {due.sessionId ? t('open') : t('takeNotes')}
        </Link>
        {due.meetingUrl && (
          <a className="btn btn-sm" href={due.meetingUrl} target="_blank" rel="noreferrer">
            {t('join')}
          </a>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDue(null)}>
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}
