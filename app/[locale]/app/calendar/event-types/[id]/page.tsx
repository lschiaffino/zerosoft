import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getEventType, listAvailability, listEventHosts } from '@/lib/calendar';
import { listMembers } from '@/lib/teams';
import EventTypeForm from '@/components/calendar/EventTypeForm';
import AvailabilityEditor from '@/components/calendar/AvailabilityEditor';
import CopyButton from '@/components/link/CopyButton';
import CalEmbedCode from '@/components/calendar/CalEmbedCode';
import CalDeleteButton from '@/components/calendar/CalDeleteButton';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function EventTypeDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventType = await getEventType(user.id, id);
  if (!eventType) notFound();
  const availability = await listAvailability(id);

  // Pool de hosts: members del team del event type o del team activo.
  const hostTeamId = eventType.team_id ?? user.team?.id ?? null;
  const teamMembers = hostTeamId ? await listMembers(hostTeamId) : undefined;
  const hosts = await listEventHosts(id);
  const origin = publicOrigin((await headers()).get('host'));
  const publicUrl = `${origin}/${locale}/book/${user.handle}/${eventType.slug}`;

  return (
    <div className="app-page cal-page">
      <Link href="/app/calendar/event-types" className="mono back-link">
        {t('eventTypes.back')}
      </Link>

      <header className="cal-detail-head">
        <div className="detail-title-row">
          <span className="calendar-event-dot-large" style={{ backgroundColor: eventType.color }} aria-hidden />
          <h1 className="detail-title">{eventType.title}</h1>
          {!eventType.active && <span className="badge">{t('eventTypes.inactive')}</span>}
          <span className="cal-detail-spacer" />
          <a className="btn btn-small" href={publicUrl} target="_blank" rel="noreferrer">
            {t('list.open')} ↗
          </a>
          <CalDeleteButton
            url={`/api/calendar/event-types/${id}`}
            confirmText={t('list.deleteConfirm', { title: eventType.title })}
            redirectTo="/app/calendar/event-types"
          />
        </div>
        <div className="calendar-public-link">
          <span className="mono">{publicUrl}</span>
          <CopyButton text={publicUrl} />
        </div>
      </header>

      <div className="calendar-detail-grid">
        <div className="calendar-detail-col">
          <EventTypeForm
            initial={eventType}
            teamMembers={teamMembers}
            teamId={hostTeamId}
            initialHostIds={hosts.map((h) => h.user_id)}
          />
        </div>
        <div className="calendar-detail-col">
          <AvailabilityEditor eventTypeId={id} initialRules={availability} />
          <CalEmbedCode publicUrl={publicUrl} origin={origin} />
        </div>
      </div>
    </div>
  );
}
