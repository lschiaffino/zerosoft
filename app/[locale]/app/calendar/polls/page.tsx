import { headers } from 'next/headers';
import { requireUser } from '@/lib/session';
import { listPolls } from '@/lib/calendar-polls';
import { PollsList } from '@/components/calendar/PollsView';
import { publicOrigin } from '@/components/calendar/event-type-items';

export const dynamic = 'force-dynamic';

export default async function PollsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const polls = await listPolls(user.id);
  const origin = publicOrigin((await headers()).get('host'));
  return (
    <PollsList
      pollBase={`${origin}/${locale}/book/poll`}
      openNew={sp.new === '1'}
      items={polls.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        durationMin: p.duration_min,
        optionCount: Number(p.optionCount),
        voteCount: Number(p.voteCount),
        token: p.token,
      }))}
    />
  );
}
