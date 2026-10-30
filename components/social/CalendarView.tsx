'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { PostDto } from '@/lib/social';
import { zonedTime } from '@/lib/groups-recurrence';
import { api, useErrorText, useToast } from './shared';

const MOVABLE = new Set(['draft', 'scheduled', 'pending_approval', 'rejected']);

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

function minutesOfDay(iso: string, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const when = (p: PostDto) => p.publishedAt ?? p.scheduledAt ?? p.createdAt;

/**
 * Calendario de publicaciones (mes o semana, lunes primero). Se arrastra una
 * publicación a otro día para reprogramarla (misma hora); Enter sobre una
 * tarjeta la abre. Las horas van en la zona de la persona.
 */
export default function CalendarView({ posts, view, anchor, tz, today }: { posts: PostDto[]; view: 'month' | 'week'; anchor: string; tz: string; today: string }) {
  const t = useTranslations('social.calendar');
  const locale = useLocale();
  const router = useRouter();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [moving, setMoving] = useState<Record<string, string>>({});

  const [y, m] = anchor.split('-').map(Number);
  const days = useMemo(() => {
    const first = view === 'month' ? `${y}-${String(m).padStart(2, '0')}-01` : anchor;
    const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
    const start = addDays(first, -((dow + 6) % 7));
    return Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => addDays(start, i));
  }, [anchor, view, y, m]);

  const byDay = useMemo(() => {
    const map = new Map<string, PostDto[]>();
    for (const p of posts) {
      const key = moving[p.id] ?? dayKey(when(p), tz);
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => when(a).localeCompare(when(b)));
    return map;
  }, [posts, tz, moving]);

  const title = new Intl.DateTimeFormat(locale, view === 'month' ? { month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${view === 'month' ? `${y}-${String(m).padStart(2, '0')}-15` : days[0]}T12:00:00Z`));
  const prev = view === 'month' ? addDays(`${y}-${String(m).padStart(2, '0')}-01`, -1).slice(0, 8) + '01' : addDays(anchor, -7);
  const next = view === 'month' ? addDays(`${y}-${String(m).padStart(2, '0')}-28`, 7).slice(0, 8) + '01' : addDays(anchor, 7);
  const href = (date: string, v = view) => `/app/social?view=${v}&date=${date}`;
  const weekdays = days.slice(0, 7).map((d) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)));
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso));

  async function move(post: PostDto, day: string) {
    const from = dayKey(when(post), tz);
    if (from === day) return;
    const [yy, mm, dd] = day.split('-').map(Number);
    const at = zonedTime(yy, mm, dd, minutesOfDay(when(post), tz), tz);
    setMoving((s) => ({ ...s, [post.id]: day }));
    try {
      await api(`/posts/${post.id}`, { method: 'PATCH', json: { scheduledAt: at.toISOString() } });
      showToast(t('moved', { when: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(at) }));
      router.refresh();
    } catch (err) {
      setMoving((s) => {
        const { [post.id]: _drop, ...rest } = s;
        void _drop;
        return rest;
      });
      showToast(errorText(err), true);
    }
  }

  return (
    <div className="sc-page">
      <div className="sc-cal-bar">
        <Link className="btn btn-sm" href={href(today)}>
          {t('today')}
        </Link>
        <Link className="btn btn-sm btn-icon" href={href(prev)} aria-label={t('previous')}>
          ‹
        </Link>
        <Link className="btn btn-sm btn-icon" href={href(next)} aria-label={t('next')}>
          ›
        </Link>
        <h2 className="sc-cal-title sc-grow" aria-live="polite">
          {title}
        </h2>
        <nav className="ui-tabs" aria-label={t('views')}>
          <Link className="ui-tab" href={href(anchor, 'month')} aria-current={view === 'month' ? 'page' : undefined}>
            {t('month')}
          </Link>
          <Link className="ui-tab" href={href(anchor, 'week')} aria-current={view === 'week' ? 'page' : undefined}>
            {t('week')}
          </Link>
          <Link className="ui-tab" href="/app/social/posts">
            {t('list')}
          </Link>
        </nav>
      </div>
      <div className={`sc-cal${view === 'week' ? ' sc-week' : ''}`} role="grid" aria-label={title} data-testid="social-calendar">
        {weekdays.map((w, i) => (
          <div key={i} className="sc-cal-head" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const out = view === 'month' && Number(d.slice(5, 7)) !== m;
          return (
            <div
              key={d}
              className="sc-day"
              role="gridcell"
              data-day={d}
              data-out={out}
              data-today={d === today}
              data-drop={dropDay === d}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-social-post')) {
                  e.preventDefault();
                  setDropDay(d);
                }
              }}
              onDragLeave={() => setDropDay((cur) => (cur === d ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDropDay(null);
                const id = e.dataTransfer.getData('application/x-social-post');
                const post = posts.find((p) => p.id === id);
                if (post) void move(post, d);
              }}
            >
              <div className="sc-day-head">
                <span className="sc-day-num">{Number(d.slice(8))}</span>
                {d >= today && (
                  <Link className="sc-day-add" href={`/app/social/posts/new?date=${d}`} aria-label={t('newOn', { date: d })}>
                    +
                  </Link>
                )}
              </div>
              {(view === 'month' ? list.slice(0, 4) : list).map((p) => (
                <Link
                  key={p.id}
                  href={`/app/social/posts/${p.id}`}
                  className="sc-chip"
                  data-s={p.status}
                  data-testid="calendar-post"
                  draggable={p.canEdit && MOVABLE.has(p.status)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-social-post', p.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  title={p.text}
                >
                  <span className="sc-chip-time">{time(when(p))}</span>
                  {p.text.split('\n')[0] || t('mediaOnly')}
                </Link>
              ))}
              {view === 'month' && list.length > 4 && (
                <Link className="sc-more" href={href(d, 'week')}>
                  {t('more', { n: list.length - 4 })}
                </Link>
              )}
            </div>
          );
        })}
      </div>
      <p className="sc-muted sc-small">{t('dragHint', { tz })}</p>
      {toast}
    </div>
  );
}
