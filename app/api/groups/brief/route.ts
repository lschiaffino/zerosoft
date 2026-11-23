import { NextResponse } from 'next/server';
import { groupsError, groupsSession, readJson, sessionViewer } from '@/lib/groups-http';
import { briefDismissed, briefEmailOn, cleanDay, dismissBrief, linesBrief } from '@/lib/daily-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * El resumen del día de Lines de quien pide (lib/daily-brief.ts), con lo que ve. ?day=<AAAA-MM-DD> (su día local):
 * si ya la cerró hoy, `dismissed`.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const day = cleanDay(new URL(req.url).searchParams.get('day'));
  if (!day) return groupsError(400, 'invalid_input');
  const [brief, dismissed, email] = await Promise.all([linesBrief(await sessionViewer(s)), briefDismissed(s.me, 'lines', day), briefEmailOn(s.me)]);
  return NextResponse.json({ day, dismissed, email, brief }, { headers: NO_STORE });
}

/** { action: 'dismiss', day }: cerrar la tarjeta por hoy (vuelve mañana). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const day = cleanDay(b.day);
  if (b.action !== 'dismiss' || !day) return groupsError(400, 'invalid_input');
  await dismissBrief(s.me, 'lines', day);
  return NextResponse.json({ ok: true, day, dismissed: true }, { headers: NO_STORE });
}
