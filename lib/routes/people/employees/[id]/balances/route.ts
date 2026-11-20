import { NextRequest } from 'next/server';
import { adjustBalance, balancesFor, deleteAdjustment, listAdjustments } from '@/lib/people-timeoff';
import { pjson, readJson, withPeople } from '@/lib/people-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Saldos por política y el historial de ajustes manuales. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    return pjson({ balances: await balancesFor(ctx, id), adjustments: await listAdjustments(ctx, id) });
  });
}

/** POST { policyId, days, note, date }: ajuste manual (HR). */
export async function POST(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    await adjustBalance(ctx, id, await readJson(req));
    return pjson({ balances: await balancesFor(ctx, id), adjustments: await listAdjustments(ctx, id) });
  });
}

/** DELETE ?adjustment=<id>: borrar un ajuste cargado por error (HR). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withPeople(async (ctx) => {
    const id = (await params).id;
    await deleteAdjustment(ctx, id, req.nextUrl.searchParams.get('adjustment') ?? '');
    return pjson({ balances: await balancesFor(ctx, id), adjustments: await listAdjustments(ctx, id) });
  });
}
