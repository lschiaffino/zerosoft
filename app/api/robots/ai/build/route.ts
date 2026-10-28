import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { snapshotPage } from '@/lib/robots';
import { AiError, buildRobot, robotFromDetection } from '@/lib/robots-ai';
import { aiErrorCode, canEditRobots, forbidden, robotError, unauthorized } from '@/lib/robots-http';
import { requestLocale } from '@/lib/request-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Abrir la página en el navegador aislado (hasta 45 s) + la IA.
export const maxDuration = 120;

const body = z.object({
  url: z.string().trim().min(1).max(2000),
  goal: z.string().max(2000).optional().default(''),
  country: z.string().regex(/^([a-z]{2})?$/).optional(),
});

/**
 * "Armar con IA": abre la URL, detecta las listas y la IA elige la lista y
 * las columnas según lo pedido. No crea el robot: devuelve los pasos y una
 * muestra para que la persona confirme. Si la IA está apagada (o sin cuota),
 * responde el error y además la lista detectada sin IA (`detected`).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditRobots(user)) return forbidden();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return robotError(400, 'invalid_input');
  let url = parsed.data.url;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const snap = await snapshotPage(user.id, url, parsed.data.country);
  if (!snap.ok)
    return robotError(
      snap.error === 'rate_limited' || snap.error === 'quota_exceeded' ? 429 : snap.error === 'runner_unavailable' ? 503 : snap.error === 'busy' ? 409 : 400,
      snap.error,
    );
  const detected = robotFromDetection(url, snap.snapshot);
  const locale = requestLocale(req.cookies.get('NEXT_LOCALE')?.value, req.headers.get('accept-language'));
  try {
    const robot = await buildRobot(user.id, url, parsed.data.goal, snap.snapshot, locale);
    return NextResponse.json({ robot, detected });
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: aiErrorCode(err.code), detected }, { status: 200 });
    return NextResponse.json({ error: 'generic', detected }, { status: 200 });
  }
}
