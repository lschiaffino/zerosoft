import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { crmError, unauthorized } from '@/lib/crm-http';
import { crmLiveCheck, parseCrmLiveWatch } from '@/lib/crm-live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CRM en vivo: ¿cambió algo de lo que muestra esta pantalla desde `since`?
 * `w` = entidades (tabla, tablero), `r` = `<entidad>:<id>` (ficha). Responde
 * { rev, changed, gone }, sin ids ni datos (lib/crm-live.ts).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const watch = parseCrmLiveWatch(sp);
  const since = Number(sp.get('since') ?? '0');
  if (!watch || !Number.isFinite(since) || since < 0) return crmError(400, 'invalid_input');
  const state = await crmLiveCheck(user.id, Math.floor(since), watch);
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
