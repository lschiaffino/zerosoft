import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getEventType, getOrCreateCalendarUser, listAvailability, listEventHosts } from '@/lib/calendar';
import { ensureDefaultSchedule, listSchedules, type ScheduleRule } from '@/lib/calendar-schedules';
import { getPaymentSettings } from '@/lib/calendar-payments';
import { listWorkflowSteps } from '@/lib/calendar-workflows';
import { listMembers } from '@/lib/teams';
import EventTypeForm from '@/components/calendar/EventTypeForm';
import EventSchedulePanel from '@/components/calendar/EventSchedulePanel';
import EventPaymentPanel from '@/components/calendar/EventPaymentPanel';
import WorkflowEditor from '@/components/calendar/WorkflowEditor';
import CopyButton from '@/components/link/CopyButton';
import CalEmbedCode from '@/components/calendar/CalEmbedCode';
import CalDeleteButton from '@/components/calendar/CalDeleteButton';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

/** "Lunes 09:00–17:00" por día (lunes primero), para mostrar un horario de un vistazo. */
function scheduleSummary(rules: ScheduleRule[], dayName: (d: number) => string): string[] {
  return [1, 2, 3, 4, 5, 6, 0]
    .map((d) => {
      const ranges = rules
        .filter((r) => r.dayOfWeek === d)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((r) => `${r.startTime}–${r.endTime}`);
      return ranges.length ? `${dayName(d)} ${ranges.join(', ')}` : '';
    })
    .filter(Boolean);
}

export default async function EventTypeDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventType = await getEventType(user.id, id);
  if (!eventType) notFound();
  const availability = await listAvailability(id);
  const config = await getOrCreateCalendarUser(user.id);
  await ensureDefaultSchedule(user.id, config.timezone);
  const schedules = await listSchedules(user.id);
  const payments = await getPaymentSettings(user.id);
  const workflowSteps = await listWorkflowSteps(user.id, id);

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
          <EventSchedulePanel
            eventTypeId={id}
            schedules={schedules.map((s) => ({
              id: s.id,
              name: s.name,
              timezone: s.timezone,
              summary: scheduleSummary(s.rules, (d) => t(`availability.day.${d}`)),
            }))}
            scheduleId={eventType.schedule_id}
            customRules={availability}
          />
          <EventPaymentPanel
            eventTypeId={id}
            priceCents={eventType.price_cents}
            currency={eventType.currency}
            paymentsConfigured={payments.configured}
            paymentsReady={payments.configured && payments.hasWebhookSecret}
          />
          <WorkflowEditor eventTypeId={id} initial={workflowSteps ?? []} />
          <CalEmbedCode publicUrl={publicUrl} origin={origin} />
        </div>
      </div>
    </div>
  );
}
