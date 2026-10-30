import { NextRequest } from 'next/server';
import { createRequest, listRequests } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?scope=mine|approvals|all&employeeId=: pedidos que quien mira puede ver. */
export async function GET(req: NextRequest) {
  return withPeople(async (ctx) => {
    const sp = req.nextUrl.searchParams;
    const scope = sp.get('scope');
    return pjson({
      requests: await listRequests(ctx, {
        employeeId: sp.get('employeeId') ?? undefined,
        scope: scope === 'mine' || scope === 'approvals' ? scope : 'all',
      }),
    });
  });
}

export async function POST(req: NextRequest) {
  return withPeople(async (ctx) => pjson({ request: await createRequest(ctx, (await readJson(req)) as never) }, 201));
}
