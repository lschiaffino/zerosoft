import { NextResponse } from 'next/server';
import { groupsError, groupsSession, readJson, sessionViewer } from '@/lib/groups-http';
import { briefDismissed, briefEmailOn, briefKey, cleanDay, cleanDayEnd, dismissBrief, linesBrief, restoreBrief } from '@/lib/daily-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * El resumen del día de Lines de quien pide (lib/daily-brief.ts), con lo que ve. ?day=<AAAA-MM-DD> (su día local)
 * y ?end=<ISO> (el fin de ese día): si ya la cerró hoy en este workspace, `dismissed`.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const sp = new URL(req.url).searchParams;
  const day = cleanDay(sp.get('day'));
  if (!day) return groupsError(400, 'invalid_input');
  const dismissed = await briefDismissed(s.me, briefKey('lines', s.ws), day);
  // Cerrada por hoy: no hace falta armarla.
  if (dismissed) return NextResponse.json({ day, dismissed, email: false, brief: null }, { headers: NO_STORE });
  const [brief, email] = await Promise.all([linesBrief(await sessionViewer(s), new Date(), { dayEnd: cleanDayEnd(sp.get('end')) }), briefEmailOn(s.me)]);
  return NextResponse.json({ day, dismissed, email, brief }, { headers: NO_STORE });
}

/** { action: 'dismiss', day }: cerrar la tarjeta por hoy (vuelve mañana); { action: 'restore' }: deshacerlo. */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  if (b.action === 'restore') {
    await restoreBrief(s.me, briefKey('lines', s.ws));
    return NextResponse.json({ ok: true, dismissed: false }, { headers: NO_STORE });
  }
  const day = cleanDay(b.day);
  if (b.action !== 'dismiss' || !day) return groupsError(400, 'invalid_input');
  await dismissBrief(s.me, briefKey('lines', s.ws), day);
  return NextResponse.json({ ok: true, day, dismissed: true }, { headers: NO_STORE });
}
