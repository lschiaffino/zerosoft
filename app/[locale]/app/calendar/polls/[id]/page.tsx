import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getPoll } from '@/lib/calendar-polls';
import { PollDetail } from '@/components/calendar/PollsView';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function PollDetailPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const poll = await getPoll(user.id, id);
  if (!poll) notFound();
  const origin = publicOrigin((await headers()).get('host'));
  return (
    <PollDetail
      pollUrl={`${origin}/${locale}/book/poll/${poll.token}`}
      poll={{
        id: poll.id,
        title: poll.title,
        description: poll.description,
        durationMin: poll.duration_min,
        location: poll.location,
        status: poll.status,
        token: poll.token,
        bookingId: poll.booking_id,
        options: poll.options,
        votes: poll.votes.map((v) => ({ id: v.id, name: v.name, email: v.email, optionIds: v.optionIds })),
      }}
    />
  );
}
