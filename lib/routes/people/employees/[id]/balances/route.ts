import { NextRequest } from 'next/server';
import { adjustBalance, balancesFor } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => pjson({ balances: await balancesFor(ctx, (await params).id) }));
}

/** POST { policyId, days, note, date }: ajuste manual (HR). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    await adjustBalance(ctx, id, await readJson(req));
    return pjson({ balances: await balancesFor(ctx, id) });
  });
}
