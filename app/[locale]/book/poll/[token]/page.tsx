import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPollByToken } from '@/lib/calendar-polls';
import { getWorkspaceBrand } from '@/lib/calendar';
import { resolveBrand } from '@/components/calendar/cal-utils';
import PublicPoll from '@/components/calendar/PublicPoll';
import PublicPageExtras from '@/components/calendar/PublicPageExtras';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

// El link es la invitación: no se indexa.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Encuesta de horario pública: los participantes votan sin cuenta. */
export default async function PublicPollPage(props: { params: Promise<{ token: string; locale: string }> }) {
  const { token } = await props.params;
  const poll = await getPollByToken(token);
  if (!poll) notFound();
  const brand = resolveBrand(await getWorkspaceBrand(poll.user_id));
  return (
    <>
      <PublicPageExtras workspaceId={poll.user_id} />
      <PublicPoll
        token={token}
        brand={{ color: brand.color, on: brand.on, name: brand.name }}
        initial={{
          title: poll.title,
          description: poll.description,
          durationMin: poll.duration_min,
          location: poll.location,
          status: poll.status,
          options: poll.options,
          votes: poll.votes.map((v) => ({ id: v.id, name: v.name, optionIds: v.optionIds })),
        }}
      />
    </>
  );
}
