import { headers } from 'next/headers';
import { editorLocations } from '@/lib/calendar-locations';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getEventType, getOrCreateCalendarUser, getWorkspaceBrand, listAvailability, listEventHosts } from '@/lib/calendar';
import { ensureDefaultSchedule, listSchedules, type ScheduleRule } from '@/lib/calendar-schedules';
import { getPaymentSettings } from '@/lib/calendar-payments';
import { listWorkflowSteps } from '@/lib/calendar-workflows';
import { listMembers } from '@/lib/teams';
import EventTypeEditor from '@/components/calendar/EventTypeEditor';
import { parseQuestions } from '@/lib/calendar-questions';
import { parseOneOffTimes } from '@/lib/calendar';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

/** Horas por día (lunes primero), para mostrar un horario de un vistazo. */
function scheduleSummary(rules: ScheduleRule[], dayName: (d: number) => string) {
  return [1, 2, 3, 4, 5, 6, 0]
    .map((d) => ({
      day: dayName(d),
      ranges: rules
        .filter((r) => r.dayOfWeek === d)
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((r) => `${r.startTime}–${r.endTime}`)
        .join(', '),
    }))
    .filter((l) => l.ranges);
}


export default async function EventTypeDetailPage(props: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, id } = await props.params;
  const { tab } = await props.searchParams;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'calendar' });
  const eventType = await getEventType(user.id, id);
  if (!eventType) notFound();
  const config = await getOrCreateCalendarUser(user.id);
  await ensureDefaultSchedule(user.id, config.timezone);
  const [availability, schedules, payments, workflowSteps, hosts, workspaceBrand] = await Promise.all([
    listAvailability(id),
    listSchedules(user.id),
    getPaymentSettings(user.id),
    listWorkflowSteps(user.id, id),
    listEventHosts(id),
    getWorkspaceBrand(user.id),
  ]);

  // Pool de hosts: members del team del event type o del team activo.
  const hostTeamId = eventType.team_id ?? user.team?.id ?? null;
  const teamMembers = hostTeamId ? await listMembers(hostTeamId) : undefined;
  const origin = publicOrigin((await headers()).get('host'));

  return (
    <EventTypeEditor
      initialTab={tab}
      eventType={{
        id: eventType.id,
        slug: eventType.slug,
        title: eventType.title,
        durationMin: eventType.duration_min,
        location: eventType.location ?? '',
        description: eventType.description ?? '',
        color: /^#[0-9a-f]{6}$/i.test(eventType.color) ? eventType.color : '#111111',
        active: eventType.active === 1,
        bookingRules: eventType.bookingRulesParsed ?? {},
        fields: parseQuestions(eventType.fieldsParsed),
        brandColor: eventType.brand_color,
        welcomeMessage: eventType.welcome_message ?? '',
        logoUrl: eventType.logo_url ?? '',
        singleUse: eventType.single_use === 1,
        used: !!eventType.used_at,
        scheduleId: eventType.schedule_id,
        priceCents: eventType.price_cents,
        currency: eventType.currency,
        oneOffTimes: parseOneOffTimes(eventType.one_off_times)?.map((d) => d.toISOString()) ?? null,
        locations: editorLocations(eventType.locations, eventType.location),
        scheduling: eventType.scheduling === 'collective' ? 'collective' : 'round_robin',
        seats: eventType.seats ?? 0,
      }}
      schedules={schedules.map((s) => ({
        id: s.id,
        name: s.name,
        timezone: s.timezone,
        summary: scheduleSummary(s.rules, (d) => t(`availability.day.${d}`)),
      }))}
      workspaceBrand={workspaceBrand}
      customRules={availability.map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time }))}
      defaults={{
        bufferBeforeMin: config.buffer_before_min,
        bufferAfterMin: config.buffer_after_min,
        minNoticeHours: config.min_notice_hours,
        maxFutureDays: config.max_booking_days,
      }}
      payments={{ configured: payments.configured, ready: payments.configured && payments.hasWebhookSecret }}
      workflowSteps={workflowSteps ?? []}
      teamMembers={teamMembers}
      teamId={hostTeamId}
      hostIds={hosts.map((h) => h.user_id)}
      handle={user.handle ?? ''}
      origin={origin}
      bookBase={`${origin}/${locale}/book`}
    />
  );
}
