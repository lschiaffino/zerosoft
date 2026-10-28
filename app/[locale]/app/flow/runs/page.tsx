import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { flowStats } from '@/lib/flow-monitor';
import { RUN_FILTER_STATUSES, RUN_RANGES } from '@/lib/flow-monitor-shared';
import RunsHistory from '@/components/flow/RunsHistory';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Historial de corridas de todos los flows, con tablero de uso y exportación. */
export default async function FlowRunsPage(props: Props) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const days = (RUN_RANGES as readonly number[]).includes(Number(one('days'))) ? Number(one('days')) : 7;
  const [flows, stats] = await Promise.all([
    getDb().prepare('SELECT id, name FROM flow_flows WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(user.id) as Promise<
      Array<{ id: string; name: string }>
    >,
    flowStats(user.id, days),
  ]);
  return (
    <RunsHistory
      flows={flows}
      initialStats={stats}
      initial={{
        status: (RUN_FILTER_STATUSES as readonly string[]).includes(one('status')) ? one('status') : '',
        flow: one('flow'),
        q: one('q').slice(0, 200),
        days,
      }}
    />
  );
}
