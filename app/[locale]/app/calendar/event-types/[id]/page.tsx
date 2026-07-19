import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getEventType, listAvailability } from '@/lib/calendar';
import EventTypeForm from '@/components/calendar/EventTypeForm';
import AvailabilityEditor from '@/components/calendar/AvailabilityEditor';

export const dynamic = 'force-dynamic';

export default async function EventTypeDetailPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventType = await getEventType(user.id, id);
  if (!eventType) notFound();
  const availability = await listAvailability(id);

  return (
    <div className="app-page">
      <Link href="/app/calendar/event-types" className="mono back-link">
        {t('eventTypes.back')}
      </Link>

      <header className="detail-header">
        <div className="detail-title-row">
          <span
            className="calendar-event-dot-large"
            style={{ backgroundColor: eventType.color }}
            aria-hidden
          />
          <h1 className="detail-title">{eventType.title}</h1>
          {!eventType.active && <span className="badge">{t('eventTypes.inactive')}</span>}
        </div>
        <div className="detail-meta">
          <span className="detail-meta-item mono">/{eventType.slug}</span>
          <span className="detail-meta-item muted">
            {eventType.duration_min} {t('eventTypes.minutes')}
          </span>
        </div>
      </header>

      <div className="calendar-detail-grid">
        <div className="calendar-detail-col">
          <EventTypeForm initial={eventType} />
        </div>
        <div className="calendar-detail-col">
          <AvailabilityEditor eventTypeId={id} initialRules={availability} />
        </div>
      </div>
    </div>
  );
}
