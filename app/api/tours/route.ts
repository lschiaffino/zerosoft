import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';
import { TOUR_KEYS } from '@/lib/tours';
import { getTours, resetTours, saveTourProgress, setTourAudience, setToursOff } from '@/lib/tours/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const progressSchema = z.object({
  kind: z.literal('progress'),
  tour: z.enum(TOUR_KEYS),
  status: z.enum(['active', 'done', 'exited']),
  step: z.string().max(40).optional(),
});
const offSchema = z.object({ kind: z.literal('off'), off: z.boolean() });
const audienceSchema = z.object({ kind: z.literal('audience'), audience: z.enum(['team', 'solo']) });
const resetSchema = z.object({ kind: z.literal('reset') });
const bodySchema = z.discriminatedUnion('kind', [progressSchema, offSchema, audienceSchema, resetSchema]);

/** GET: el estado de los tours de la persona (users.profile.tours). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ tours: await getTours(realUserId(user)) });
}

/**
 * POST: guarda lo que pasó en un tour. Siempre sobre la persona real (no el owner del workspace).
 * - { kind: 'progress', tour, status: 'active' | 'done' | 'exited', step? }
 * - { kind: 'off', off }: "No mostrar más tours" (o volver a mostrarlos).
 * - { kind: 'audience', audience: 'team' | 'solo' }: la respuesta a "¿sola o con tu equipo?".
 * - { kind: 'reset' }: todos los tours de nuevo desde el principio.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const me = realUserId(user);
  const limit = await rateLimit(`tours:${me}`, 240, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const body = parsed.data;
  if (body.kind === 'progress') await saveTourProgress(me, body.tour, body.status, body.step);
  else if (body.kind === 'off') await setToursOff(me, body.off);
  else if (body.kind === 'audience') await setTourAudience(me, body.audience);
  else await resetTours(me);
  return NextResponse.json({ ok: true });
}
