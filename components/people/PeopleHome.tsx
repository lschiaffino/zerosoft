'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Celebration } from '@/lib/people-extras';
import { Avatar, useDay } from './people-ui';

export interface PeopleInbox {
  approvals: number;
  tasks: number;
  reviews: number;
  documents: number;
  surveys: number;
  changes: number;
  exits: number;
}

/** Arriba del directorio: lo que espera a esta persona y los cumpleaños y aniversarios que vienen. Sin nada de eso, no ocupa lugar. */
export default function PeopleHome({ inbox, celebrations }: { inbox: PeopleInbox; celebrations: Celebration[] }) {
  const t = useTranslations('people');
  const day = useDay();
  const items: Array<{ key: keyof PeopleInbox; href: string }> = [
    { key: 'approvals', href: '/app/people/time-off?tab=approvals' },
    { key: 'changes', href: '/app/people/settings?tab=changes' },
    { key: 'exits', href: '/app/people?status=offboarding' },
    { key: 'tasks', href: '/app/people/onboarding' },
    { key: 'reviews', href: '/app/people/reviews' },
    { key: 'surveys', href: '/app/people/reviews#surveys' },
    { key: 'documents', href: '/app/people/welcome' },
  ];
  const pending = items.filter((i) => inbox[i.key] > 0);
  if (!pending.length && !celebrations.length) return null;
  return (
    <div className={`ppl-home${pending.length && celebrations.length ? ' ppl-home-two' : ''}`}>
      {pending.length > 0 && (
        <section className="ppl-panel" aria-labelledby="ppl-inbox-title" data-testid="people-inbox">
          <h2 id="ppl-inbox-title" className="ppl-panel-title">
            {t('home.inbox')}
          </h2>
          <ul className="ppl-home-list">
            {pending.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="ppl-home-row">
                  <span>{t(`home.items.${i.key}`)}</span>
                  <span className="badge badge-outline">{inbox[i.key]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {celebrations.length > 0 && (
        <section className="ppl-panel" aria-labelledby="ppl-celebrations-title" data-testid="people-celebrations">
          <h2 id="ppl-celebrations-title" className="ppl-panel-title">
            {t('home.celebrations')}
          </h2>
          <ul className="ppl-home-list">
            {celebrations.slice(0, 6).map((c) => (
              <li key={`${c.kind}-${c.employeeId}`}>
                <Link href={`/app/people/${c.employeeId}`} className="ppl-home-row">
                  <span className="ppl-home-person">
                    <Avatar name={c.name} photo={c.photo} size={24} />
                    <span className="ppl-ellipsis">{c.name}</span>
                  </span>
                  <span className="ppl-muted ppl-home-when">
                    {c.kind === 'birthday' ? t('home.birthday') : t('home.anniversary', { years: c.years ?? 1 })} · {day(c.date, { month: 'short', day: 'numeric' })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
