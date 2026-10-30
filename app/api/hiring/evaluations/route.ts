import { myPendingEvaluations } from '@/lib/hiring/evaluation';
import { hiringActor, hJson } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: mis scorecards pendientes. */
export async function GET() {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  return hJson({ pending: await myPendingEvaluations(a.actor) });
}
