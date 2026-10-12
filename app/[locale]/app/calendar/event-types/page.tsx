import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listEventTypes } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export default async function EventTypesPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventTypes = await listEventTypes(user.id);

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('eventTypes.title')}</h1>
        <Link href="/app/calendar/event-types/new" className="btn btn-solid btn-small">
          {t('eventTypes.newCta')}
        </Link>
      </div>

      {eventTypes.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0
          </p>
          <h2>{t('eventTypes.emptyTitle')}</h2>
          <p className="muted">{t('eventTypes.emptySub')}</p>
          <Link href="/app/calendar/event-types/new" className="btn btn-solid btn-small">
            {t('eventTypes.emptyCta')}
          </Link>
        </div>
      ) : (
        <section className="panel">
          <ul className="calendar-event-list">
            {eventTypes.map((et) => (
              <li key={et.id}>
                <Link href={`/app/calendar/event-types/${et.id}`} className="calendar-event-row">
                  <span
                    className="calendar-event-dot"
                    style={{ backgroundColor: et.color }}
                    aria-hidden
                  />
                  <span className="calendar-event-title">{et.title}</span>
                  <span className="mono calendar-event-slug">/{et.slug}</span>
                  <span className="muted">
                    {et.duration_min} {t('eventTypes.minutes')}
                  </span>
                  {!et.active && <span className="badge">{t('eventTypes.inactive')}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
