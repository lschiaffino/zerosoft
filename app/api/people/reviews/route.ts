import { NextRequest } from 'next/server';
import { listReviews } from '@/lib/people-perf';
import { pjson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?cycleId=&subjectId=&mine=1: evaluaciones visibles (mine=1: las que quien mira tiene que escribir). */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => {
    const sp = req.nextUrl.searchParams;
    return pjson({ reviews: await listReviews(ctx, { cycleId: sp.get('cycleId') ?? undefined, subjectId: sp.get('subjectId') ?? undefined, mineToWrite: sp.get('mine') === '1' }) });
  });
}
