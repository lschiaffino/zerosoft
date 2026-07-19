import { notFound } from 'next/navigation';
import { getEventTypeBySlug, getCalendarUser } from '@/lib/calendar';
import PublicBookingPage from '@/components/calendar/PublicBookingPage';

export const dynamic = 'force-dynamic';

export default async function BookPage({
  params: { slug, locale },
}: {
  params: { slug: string; locale: string };
}) {
  const eventType = await getEventTypeBySlug(slug);
  if (!eventType) notFound();

  const calendarUser = await getCalendarUser(eventType.user_id);

  return (
    <PublicBookingPage
      eventType={eventType}
      locale={locale}
      weekStart={calendarUser?.week_start ?? 1}
    />
  );
}
