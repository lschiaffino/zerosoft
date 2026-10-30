import { NextRequest, NextResponse } from 'next/server';
import { withSocial } from '@/lib/social-http';
import { nextQueueTime, visibleAccountIds } from '@/lib/social';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Próximo horario libre de la cola para estas cuentas (?accounts=a,b). null si no tienen horarios. */
export async function GET(req: NextRequest) {
  return withSocial(async ({ actor }) => {
    const visible = new Set(await visibleAccountIds(actor));
    const ids = (req.nextUrl.searchParams.get('accounts') ?? '').split(',').filter((id) => visible.has(id)).slice(0, 50);
    const next = await nextQueueTime(actor.workspaceId, ids);
    return NextResponse.json({ next: next?.toISOString() ?? null });
  });
}
